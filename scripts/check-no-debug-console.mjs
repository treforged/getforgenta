#!/usr/bin/env node
/**
 * Fails the build if the PRODUCTION bundle contains an in-page debug console.
 *
 * WHY THIS EXISTS, and why a runtime `if` is not enough:
 * Eruda and vConsole expose `localStorage` to anyone who opens the page. In this
 * app localStorage holds the SUPABASE AUTH SESSION JWT, so on a personal-finance
 * app that is account takeover, not a debug convenience.
 *
 * A guard like `if (import.meta.env.MODE !== 'production') await import('eruda')`
 * reads as correct and is correct - until someone converts it to a top-level
 * `import 'eruda'` in a refactor. A top-level import bundles the console
 * REGARDLESS of any guard below it, and that change is invisible in review.
 * Only a build-time failure survives a future refactor by someone who never saw
 * this conversation. That is this script.
 *
 * Usage:  node scripts/check-no-debug-console.mjs [distDir]
 * Exit 0  nothing found, and it says how much it actually looked at.
 * Exit 1  a marker was found, OR there was nothing to look at.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html']);
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * Word-ish boundaries on both sides, so an unrelated minified identifier like
 * `erudaX` does not cry wolf, while `eruda.init()`, `"eruda"`,
 * `require("vconsole")` and `new VConsole()` all match.
 */
const MARKERS = [
  { name: 'eruda', pattern: /(^|[^a-z0-9_$])eruda([^a-z0-9_$]|$)/gi },
  { name: 'vConsole', pattern: /(^|[^a-z0-9_$])v_?console([^a-z0-9_$]|$)/gi },
];

const EXCERPT_RADIUS = 60;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (SCANNED_EXTENSIONS.has(extname(entry).toLowerCase())) {
      out.push({ path: full, size: stat.size });
    }
  }
  return out;
}

function excerpt(text, index) {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + EXCERPT_RADIUS);
  const head = start > 0 ? '...' : '';
  const tail = end < text.length ? '...' : '';
  return head + text.slice(start, end).replace(/\s+/g, ' ') + tail;
}

function fail(message) {
  console.error('\ncheck-no-debug-console: FAILED\n' + message + '\n');
  process.exit(1);
}

// --- 1. There must be something to check. A check that examines zero files and
//        passes is worse than no check: it is a green light nobody earned.
if (!existsSync(DIST)) {
  fail(
    'No build output at "' + DIST + '".\n' +
      'Run `npm run build` first, or pass the output directory as argv[2].\n' +
      'Refusing to pass: a check that inspects nothing proves nothing.',
  );
}

const files = walk(DIST);
const jsFiles = files.filter((f) => JS_EXTENSIONS.has(extname(f.path).toLowerCase()));

if (files.length === 0) {
  fail('"' + DIST + '" contains no scannable files. The build did not produce output.');
}
if (jsFiles.length === 0) {
  fail(
    '"' + DIST + '" contains ' + files.length + ' file(s) but NOT ONE JavaScript bundle.\n' +
      'Either the build failed, or the output layout changed and this script is\n' +
      'now looking in the wrong place. Fix the script rather than deleting it.',
  );
}

// --- 2. The actual scan.
const hits = [];
let bytesScanned = 0;

for (const file of files) {
  const text = readFileSync(file.path, 'utf8');
  bytesScanned += file.size;
  for (const marker of MARKERS) {
    marker.pattern.lastIndex = 0;
    let match;
    let count = 0;
    let firstExcerpt = '';
    while ((match = marker.pattern.exec(text)) !== null) {
      if (count === 0) firstExcerpt = excerpt(text, match.index);
      count += 1;
      if (count > 500) break; // a runaway file needs no further proof
    }
    if (count > 0) hits.push({ file: file.path, marker: marker.name, count, firstExcerpt });
  }
}

if (hits.length > 0) {
  const lines = hits.map(
    (h) => '  ' + h.file + '\n    marker: ' + h.marker + '  hits: ' + h.count + '\n    ' + h.firstExcerpt,
  );
  fail(
    'A debug console reached the production bundle.\n\n' +
      lines.join('\n\n') + '\n\n' +
      'localStorage in this app holds the Supabase auth session JWT. An in-page\n' +
      'console exposes it to anyone who opens the page - that is account takeover.\n' +
      'The loader must stay a DYNAMIC import inside the dev/preview branch\n' +
      '(src/lib/debug-console.ts). A top-level import bundles it regardless of\n' +
      'any guard below it.',
  );
}

const mb = (bytesScanned / 1024 / 1024).toFixed(2);
console.log(
  'check-no-debug-console: clean - ' + files.length + ' files (' + jsFiles.length + ' JS, ' +
    mb + ' MB) in "' + DIST + '", no eruda/vConsole.',
);
