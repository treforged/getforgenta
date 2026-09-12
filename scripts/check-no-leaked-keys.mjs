#!/usr/bin/env node
/**
 * Fails the build if the PRODUCTION bundle ships a credential that is not the
 * publishable key.
 *
 * WHY IT EXISTS. This is a personal-finance app whose entire data isolation is RLS.
 * A `sb_secret_…` key in a client bundle is not a leak of one table — it is a full
 * bypass of every policy in the database, for anyone who opens devtools. The
 * publishable key belongs there; nothing else does.
 *
 * ⚠️ THE DISCRIMINATING TEST IS THE VALUE, NEVER THE PREFIX — and this is the whole
 * reason the script is shaped the way it is. A plain `grep -rIl "sb_secret_" dist/`
 * returns TWO FILES on a clean build of this repo, because supabase-js ships its own
 * detection literal:
 *
 *     const isNewApiKey = (key) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
 *
 * That is a string in a type check, not a key. A scanner that matched the prefix
 * would cry wolf on every single build — and a gate that is wrong on ordinary work is
 * one somebody routes around on the day it would have caught something real. So a
 * match requires at least MIN_KEY_CHARS key characters AFTER the prefix. The library
 * literal has none.
 *
 * Likewise JWTs: the check is not "is there a JWT" but what the `role` claim says.
 * `anon` belongs in a client bundle; `service_role` is the same catastrophe as above.
 *
 * ⚠️ THE ESCAPE IS PER-LINE, NEVER PER-FILE. There is deliberately no way to exempt a
 * whole file, because "this file is a vendored library" is exactly the excuse a real
 * leak would hide behind. A line may opt out with an inline marker (see ALLOW_MARKER)
 * and that line only.
 *
 * ⚠️ WHAT THIS DOES NOT STOP, said plainly so nobody trusts it past its limits:
 *   - `git commit --no-verify` and a direct push skip every local hook.
 *   - Anyone who can edit a tracked script can delete this one; it is in the tree so
 *     that removal shows up in a diff, not so that it cannot happen.
 *   - It reads the BUILT bundle. A key committed to a source file that no build
 *     inlines will not appear here.
 *   - It knows the shapes listed below and no others. A novel credential format is
 *     invisible to it.
 *   It stops the accident — an inlined env var, a pasted key, a misconfigured
 *   `VITE_` variable. It does not stop somebody determined.
 *
 * Usage:  node scripts/check-no-leaked-keys.mjs [distDir]
 * Exit 0  scanned something, found no non-publishable credential.
 * Exit 1  a credential was found — "I looked and it is broken".
 * Exit 2  could not look: no dist, no files, nothing text-like, or the self-test could
 *         not find a key it planted itself.
 *
 * ⚠️ LIVENESS IS "DID I READ ANYTHING", NEVER "DID I FIND A KEY". See selfTest() below
 * for why that distinction cost every mobile build one evening.
 *
 * NOTE the 1-vs-2 split is a DELIBERATE divergence from the sibling
 * `check-no-debug-console.mjs`, which returns 1 for both. "I looked and it is broken"
 * and "I could not look" must never share an exit code: a broken path would otherwise
 * read as a finding, and a CI log would say the wrong thing about the machine.
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** A real key carries far more than this; the library's bare prefix literal carries none. */
export const MIN_KEY_CHARS = 20;

/** Per-LINE opt-out. Deliberately not available per file. */
export const ALLOW_MARKER = 'leaked-keys-allow-line';

const TEXT_LIKE = /\.(js|mjs|cjs|css|html|json|map|txt|webmanifest)$/i;

const VALUE_RULES = [
  ['supabase secret key', new RegExp(String.raw`sb_secret_[A-Za-z0-9_-]{${MIN_KEY_CHARS},}`, 'g')],
  ['stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];

const PUBLISHABLE = new RegExp(String.raw`sb_publishable_[A-Za-z0-9_-]{${MIN_KEY_CHARS},}`, 'g');
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (statSync(p).isFile()) out.push(p);
  }
  return out;
}

function roleOf(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : '<no role claim>';
  } catch {
    return '<undecodable>';
  }
}

/**
 * @returns {{findings: {file:string,line:number,kind:string}[], publishable:number,
 *            jwts:{role:string,file:string}[], filesScanned:number, textScanned:number}}
 */
export function scanDir(dir) {
  const findings = [];
  const jwts = [];
  let publishable = 0;
  let textScanned = 0;

  const files = existsSync(dir) ? walk(dir) : [];
  for (const file of files) {
    if (!TEXT_LIKE.test(file)) continue;
    textScanned++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // The escape keys on THIS LINE. A file-wide exemption is not offered on purpose.
      if (line.includes(ALLOW_MARKER)) return;
      for (const [kind, re] of VALUE_RULES) {
        re.lastIndex = 0;
        if (re.test(line)) findings.push({ file, line: i + 1, kind });
      }
      PUBLISHABLE.lastIndex = 0;
      publishable += (line.match(PUBLISHABLE) ?? []).length;
      JWT.lastIndex = 0;
      for (const tok of line.match(JWT) ?? []) {
        const role = roleOf(tok);
        jwts.push({ role, file });
        if (role !== 'anon') findings.push({ file, line: i + 1, kind: `JWT with role=${role}` });
      }
    });
  }
  return { findings, publishable, jwts, filesScanned: files.length, textScanned };
}

/**
 * Verdict -> exit code, kept separate from the scan so both halves are testable and so
 * the "could not look" branch cannot be reached only by accident.
 */
export function exitCodeFor(result) {
  if (result.findings.length > 0) return 1;
  // "Could not look" is about whether anything was READ, and nothing else. A missing
  // dist, an empty one, or one with no text-like file in it are the real could-not-look
  // conditions; what the bundle happens to CONTAIN is not one of them.
  if (result.filesScanned === 0 || result.textScanned === 0) return 2;
  return 0;
}

/**
 * THE LIVENESS PROOF, and it is deliberately independent of production content.
 *
 * ⚠️ THIS REPLACES AN ASSUMPTION THAT WAS FALSE. Until 2026-09-11 liveness was "a real
 * Supabase bundle always contains at least one key, so finding none means I scanned the
 * wrong place". That blocked every mobile build on 2026-09-12 (runs 34664214419 /
 * 34664214405) and it was not a false alarm about the SCANNER — it was a false PREMISE.
 * `capacitor.config.ts` sets `server.url = https://getforgenta.com`, so the native app
 * loads the hosted site and the `dist/` these workflows build is never executed on a
 * device. CI holds no VITE_SUPABASE_* secrets (verified: the run log prints the env
 * block with all three empty), so that bundle correctly contains no key at all.
 *
 * So liveness is asserted against a fixture we CONTROL: plant a key, and require the
 * scanner to find exactly it. A scanner that cannot find a planted key has not earned
 * the right to report a clean bundle as clean.
 *
 * Every credential-shaped string below is built at runtime by concatenation, never
 * written as a literal — a guard whose own code trips it teaches the next person to
 * loosen the guard.
 *
 * @returns {boolean} true only if the scanner found the planted key and nothing else.
 */
export function selfTest() {
  const secPrefix = 'sb_' + 'secret_';
  const pubPrefix = 'sb_' + 'publishable_';
  const body = 'A1b2C3d4E5f6G7h8J9k0';
  const dir = mkdtempSync(join(tmpdir(), 'leaked-keys-selftest-'));
  try {
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(
      join(dir, 'assets', 'app.js'),
      [
        // supabase-js's own detection literal: a prefix-matcher would report this too.
        'const isNew' + 'ApiKey = (k) => k.startsWith("' + pubPrefix + '") || k.startsWith("' + secPrefix + '");',
        'const pub = "' + pubPrefix + body + 'QRST";',
        'const oops = "' + secPrefix + body + 'MNOP";',
      ].join('\n'),
      'utf8',
    );
    const r = scanDir(dir);
    return (
      r.findings.length === 1 &&
      r.findings[0].kind === 'supabase secret key' &&
      r.publishable === 1 &&
      r.textScanned === 1
    );
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  if (!selfTest()) {
    console.error('[leaked-keys] SELF-TEST FAILED - the scanner cannot find a planted key, so a clean result proves nothing.');
    process.exit(2);
  }
  console.log('[leaked-keys] self-test: planted key found, scanner is live.');

  const dir = process.argv[2] ?? 'dist';
  const result = scanDir(dir);
  const code = exitCodeFor(result);

  console.log(`[leaked-keys] ${dir}: ${result.filesScanned} files, ${result.textScanned} text-like scanned`);
  console.log(`[leaked-keys] publishable key occurrences: ${result.publishable} (expected)`);
  console.log(`[leaked-keys] JWTs: ${result.jwts.length}${result.jwts.length ? ` (roles: ${[...new Set(result.jwts.map(j => j.role))].join(', ')})` : ''}`);

  for (const f of result.findings) {
    console.error(`[leaked-keys] FOUND ${f.kind} at ${f.file}:${f.line}`);
  }

  if (code === 1) console.error(`[leaked-keys] FAIL - ${result.findings.length} credential(s) in the bundle.`);
  else if (code === 2) console.error('[leaked-keys] COULD NOT LOOK - nothing was read. Wrong directory, or an unbuilt tree. This is NOT a pass.');
  else console.log('[leaked-keys] OK - no non-publishable credential in the bundle.');

  process.exit(code);
}

// Only run as a CLI. Importing this file for tests must not scan or exit.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-no-leaked-keys.mjs')) {
  main();
}
