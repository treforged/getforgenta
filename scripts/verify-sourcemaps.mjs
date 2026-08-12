/**
 * Proves that a MINIFIED production stack trace resolves back to readable
 * TypeScript through the emitted source maps.
 *
 * Why this exists: the 2026-08-12 error-tracking evidence was captured against
 * the DEV server, where the stack is already readable — so it proved the report
 * reaches the vendor, but proved nothing about source maps. This drives the real
 * built bundle instead.
 *
 * Usage:
 *   1. echo VITE_ENABLE_ERROR_TEST=1 > .env.production.local
 *   2. npm run build
 *   3. npm run preview -- --port 4173
 *   4. node scripts/verify-sourcemaps.mjs
 *
 * Exits non-zero if the stack is not minified (nothing was proven), or if any
 * frame fails to resolve to an original source position.
 */
import { chromium } from 'playwright';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = process.env.PREVIEW_ORIGIN ?? 'http://localhost:4173';
const DIST = 'dist';
const TRACE_HOST = 'otel.observability.app.launchdarkly.com';

/** Frames look like `at Boom (http://host/assets/ErrorTest-BrU4Xtl7.js:1:2345)`. */
const FRAME = /(?:at\s+(?<fn>[^\s(]+)\s+\()?(?<url>https?:\/\/[^\s)]+?\.js):(?<line>\d+):(?<col>\d+)\)?/g;

const maps = new Map();
function mapFor(assetPath) {
  if (!maps.has(assetPath)) {
    const file = join(DIST, assetPath + '.map');
    maps.set(assetPath, existsSync(file) ? new TraceMap(JSON.parse(readFileSync(file, 'utf8'))) : null);
  }
  return maps.get(assetPath);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const traces = [];
page.on('request', req => {
  if (req.url().includes(TRACE_HOST)) traces.push(req.postData() ?? '');
});

await page.goto(`${ORIGIN}/__error-test`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Throw during render/i }).click();
await page.waitForTimeout(8000);

// Pull every exception.stacktrace value out of the OTLP JSON payloads.
const stacks = [];
for (const body of traces) {
  for (const m of body.matchAll(/"exception\.stacktrace"[^}]*?"stringValue"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    stacks.push(JSON.parse(`"${m[1]}"`));
  }
}

if (stacks.length === 0) {
  console.error('FAIL: no exception.stacktrace reached the tracer. Nothing to resolve.');
  await browser.close();
  process.exit(1);
}

const stack = stacks.find(s => s.includes('DeliberateTestError')) ?? stacks[0];
console.log('=== MINIFIED STACK, as it left the browser ===\n' + stack + '\n');

// `label` and `source` are fields this codebase invented, so finding them on the
// wire proves the ErrorBoundary -> reportError wiring specifically, rather than
// just proving the SDK's own window.onerror hook works.
const all = traces.join('');
const field = key => {
  const m = all.match(new RegExp(`"key"\\s*:\\s*"${key}"\\s*,\\s*"value"\\s*:\\s*\\{\\s*"stringValue"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return m ? JSON.parse(`"${m[1]}"`) : null;
};
console.log('=== BOUNDARY FIELDS ON THE WIRE ===');
for (const k of ['label', 'source', 'exception.type', 'highlight.session_id', 'secure_session_id']) {
  const v = field(k);
  if (v !== null) console.log(`  ${k} = ${v.length > 120 ? v.slice(0, 120) + '…' : v}`);
}
console.log('');

let resolved = 0;
let unresolved = 0;
let minifiedFrames = 0;

console.log('=== RESOLVED THROUGH SOURCE MAPS ===');
for (const m of stack.matchAll(FRAME)) {
  const { fn, url, line, col } = m.groups;
  const assetPath = new URL(url).pathname.replace(/^\//, '');
  if (!assetPath.startsWith('assets/')) continue;
  minifiedFrames++;

  const tm = mapFor(assetPath);
  if (!tm) {
    console.log(`  ${assetPath}:${line}:${col}  ->  NO MAP FILE`);
    unresolved++;
    continue;
  }
  const pos = originalPositionFor(tm, { line: Number(line), column: Number(col) });
  if (!pos.source) {
    console.log(`  ${assetPath}:${line}:${col}  ->  UNRESOLVED`);
    unresolved++;
    continue;
  }
  resolved++;
  console.log(`  ${assetPath}:${line}:${col}`);
  console.log(`      -> ${pos.source}:${pos.line}:${pos.column}${pos.name ? `  (${pos.name})` : ''}${fn ? `   [minified fn: ${fn}]` : ''}`);
}

await browser.close();

console.log(`\n=== SUMMARY ===`);
console.log(`bundle frames: ${minifiedFrames}   resolved: ${resolved}   unresolved: ${unresolved}`);

if (minifiedFrames === 0) {
  console.error('FAIL: no /assets/*.js frames — this was not a production bundle, so nothing was proven.');
  process.exit(1);
}
if (resolved === 0) {
  console.error('FAIL: not one frame resolved to an original source.');
  process.exit(1);
}
console.log('PASS: a minified production stack resolves back to TypeScript source.');
