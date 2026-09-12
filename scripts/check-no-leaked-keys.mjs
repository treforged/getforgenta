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
 * Exit 2  could not look: no dist, no files, or no key of any kind found (which for
 *         a Supabase app means the scan was pointed at the wrong place).
 *
 * NOTE the 1-vs-2 split is a DELIBERATE divergence from the sibling
 * `check-no-debug-console.mjs`, which returns 1 for both. "I looked and it is broken"
 * and "I could not look" must never share an exit code: a broken path would otherwise
 * read as a finding, and a CI log would say the wrong thing about the machine.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  // Nothing to look at, or a Supabase bundle with no key of any kind in it: either way
  // this run is evidence about nothing and must not read as a pass.
  if (result.textScanned === 0) return 2;
  if (result.publishable === 0 && result.jwts.length === 0) return 2;
  return 0;
}

function main() {
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
  else if (code === 2) console.error('[leaked-keys] COULD NOT LOOK - nothing scanned, or no key of any kind found. Wrong directory, or an unbuilt tree. This is NOT a pass.');
  else console.log('[leaked-keys] OK - no non-publishable credential in the bundle.');

  process.exit(code);
}

// Only run as a CLI. Importing this file for tests must not scan or exit.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-no-leaked-keys.mjs')) {
  main();
}
