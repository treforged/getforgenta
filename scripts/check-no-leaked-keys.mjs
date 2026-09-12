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
 * ⚠️ WHICH ARTEFACT THIS READS — AND THE TWO ARE NOT INTERCHANGEABLE.
 *   `check:leaked-keys`       reads the LOCAL `dist/`. `capacitor.config.ts` sets
 *                             `server.url = https://getforgenta.com`, so the native app
 *                             loads the hosted site and THIS BUNDLE IS NEVER EXECUTED ON
 *                             A DEVICE. It is a cheap pre-ship check that catches a key
 *                             accidentally inlined at build time. It is NOT coverage for
 *                             the code users run, and must never be reported as such.
 *   `check:leaked-keys:live`  reads the HOSTED deployment — index.html plus every
 *                             same-origin asset it references. That is the bundle both
 *                             the web app and the native app actually execute, and it is
 *                             the only mode with coverage meaning.
 * Every run prints `TARGET:` saying which it read. A gate whose scope is undocumented
 * gets trusted past it.
 *
 * Usage:  node scripts/check-no-leaked-keys.mjs [distDir]
 *         node scripts/check-no-leaked-keys.mjs --url https://getforgenta.com
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
 * The per-source scan, shared by every target so a local directory and the live
 * deployment cannot drift into judging the same bytes differently.
 * @param {string} name  what to print in a finding — a path, or a URL
 * @param {string} text  the whole source
 * @param {{findings:any[], jwts:any[], publishable:number}} acc  mutated in place
 */
function scanSource(name, text, acc) {
  text.split('\n').forEach((line, i) => {
    // The escape keys on THIS LINE. A file-wide exemption is not offered on purpose.
    if (line.includes(ALLOW_MARKER)) return;
    for (const [kind, re] of VALUE_RULES) {
      re.lastIndex = 0;
      if (re.test(line)) acc.findings.push({ file: name, line: i + 1, kind });
    }
    PUBLISHABLE.lastIndex = 0;
    acc.publishable += (line.match(PUBLISHABLE) ?? []).length;
    JWT.lastIndex = 0;
    for (const tok of line.match(JWT) ?? []) {
      const role = roleOf(tok);
      acc.jwts.push({ role, file: name });
      if (role !== 'anon') acc.findings.push({ file: name, line: i + 1, kind: `JWT with role=${role}` });
    }
  });
}

/**
 * @returns {{findings: {file:string,line:number,kind:string}[], publishable:number,
 *            jwts:{role:string,file:string}[], filesScanned:number, textScanned:number,
 *            target:string}}
 */
export function scanDir(dir) {
  const acc = { findings: [], jwts: [], publishable: 0 };
  let textScanned = 0;

  const files = existsSync(dir) ? walk(dir) : [];
  for (const file of files) {
    if (!TEXT_LIKE.test(file)) continue;
    textScanned++;
    scanSource(file, readFileSync(file, 'utf8'), acc);
  }
  return { ...acc, filesScanned: files.length, textScanned, target: `local build directory "${dir}"` };
}

/**
 * THE BUNDLE CUSTOMERS ACTUALLY EXECUTE.
 *
 * ⚠️ READ THIS BEFORE TRUSTING EITHER MODE. `capacitor.config.ts` sets
 * `server.url = https://getforgenta.com`, so the native app loads the HOSTED site and
 * the `dist/` the mobile workflows build is never executed on a device. scanDir() is a
 * cheap pre-ship check on an artefact nobody runs; THIS is the one with coverage
 * meaning. Neither substitutes for the other, and the run always prints which it read.
 *
 * Fetches the origin's index.html, then every same-origin asset it references, and
 * scans all of it with the same rules as a local scan.
 *
 * @param {string} origin e.g. https://getforgenta.com
 * @returns same shape as scanDir
 */
export async function scanUrl(origin) {
  const base = origin.replace(/\/+$/, '');
  const acc = { findings: [], jwts: [], publishable: 0 };
  let textScanned = 0;

  const get = async (url) => {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.text();
  };

  let fetchErrors = 0;

  let index;
  try {
    index = await get(`${base}/`);
  } catch (e) {
    // Unreachable is a COULD NOT LOOK, never a pass. Zero counts produce exit 2.
    console.error(`[leaked-keys] could not fetch ${base}/ — ${e.message}`);
    return { ...acc, filesScanned: 0, textScanned: 0, fetchErrors: 1, target: `live deployment ${base}` };
  }

  scanSource(`${base}/index.html`, index, acc);
  textScanned++;

  // Same-origin assets only: a third-party script is not this bundle and not ours to
  // judge. Relative paths only, which is what Vite emits.
  const refs = [...new Set([...index.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|mjs|css|json|webmanifest))"/g)].map(m => m[1]))];
  for (const ref of refs) {
    const url = `${base}${ref}`;
    try {
      scanSource(url, await get(url), acc);
      textScanned++;
    } catch (e) {
      // ⚠️ A PARTIAL READ MUST NOT READ AS A PASS. One unfetchable chunk is exactly
      // where a key would sit, so any failure forces COULD NOT LOOK rather than
      // letting the chunks that did load stand in for the whole bundle.
      fetchErrors++;
      console.error(`[leaked-keys] could not fetch ${url} — ${e.message}`);
    }
  }

  return { ...acc, filesScanned: refs.length + 1, textScanned, fetchErrors, target: `live deployment ${base}` };
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
  // A source that could not be read at all is a hole the size of a whole chunk, and a
  // key would sit in exactly one chunk. Only scanUrl() sets this; a local scan has no
  // such failure mode, so 0 is the truth there rather than a stand-in for "unknown".
  if ((result.fetchErrors ?? 0) > 0) return 2;
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

async function main() {
  if (!selfTest()) {
    console.error('[leaked-keys] SELF-TEST FAILED - the scanner cannot find a planted key, so a clean result proves nothing.');
    process.exit(2);
  }
  console.log('[leaked-keys] self-test: planted key found, scanner is live.');

  const args = process.argv.slice(2);
  const urlAt = args.indexOf('--url');
  const result = urlAt === -1
    ? scanDir(args[0] ?? 'dist')
    : await scanUrl(args[urlAt + 1] ?? 'https://getforgenta.com');
  const code = exitCodeFor(result);

  // ⚠️ SAY WHICH ARTEFACT WAS READ, ON EVERY RUN. A gate whose scope is undocumented
  // gets trusted past it, and these two targets are NOT interchangeable — see scanUrl.
  console.log(`[leaked-keys] TARGET: ${result.target}`);
  console.log(`[leaked-keys] ${result.filesScanned} files, ${result.textScanned} text-like scanned`);
  console.log(`[leaked-keys] publishable key occurrences: ${result.publishable} (expected)`);
  console.log(`[leaked-keys] JWTs: ${result.jwts.length}${result.jwts.length ? ` (roles: ${[...new Set(result.jwts.map(j => j.role))].join(', ')})` : ''}`);

  for (const f of result.findings) {
    console.error(`[leaked-keys] FOUND ${f.kind} at ${f.file}:${f.line}`);
  }

  if (code === 1) console.error(`[leaked-keys] FAIL - ${result.findings.length} credential(s) in the bundle.`);
  else if (code === 2) console.error('[leaked-keys] COULD NOT LOOK - nothing was read, or a source could not be fetched. Wrong directory, an unbuilt tree, or an unreachable deployment. This is NOT a pass.');
  else console.log(`[leaked-keys] OK - no non-publishable credential in ${result.target}.`);

  // ⚠️ `process.exit()` HERE CRASHED NODE ON WINDOWS AND REPORTED 127, NOT 1 — measured
  // 2026-09-12 against a planted key: the FOUND and FAIL lines printed correctly and the
  // process then died on `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` while
  // fetch's sockets were still closing. A gate that reports the wrong exit code on a
  // real finding is worse than no gate. Setting `exitCode` lets the loop drain and
  // preserves the verdict.
  process.exitCode = code;
}

// Only run as a CLI. Importing this file for tests must not scan or exit.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-no-leaked-keys.mjs')) {
  main().catch((e) => {
    // An unexpected throw is a COULD NOT LOOK, never an accidental pass.
    console.error(`[leaked-keys] COULD NOT LOOK - ${e?.stack ?? e}`);
    process.exitCode = 2;
  });
}
