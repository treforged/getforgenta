/**
 * Compares two built trees and reports the bundle delta in kB.
 *
 *   node scripts/measure-bundle-delta.mjs <before-root> <after-root>
 *
 * Both roots must already have been built (`npm run build`), so this measures
 * shipped artifacts rather than re-deriving them from the module graph.
 *
 * It reports three numbers, because "bundle size" alone hides the thing that
 * matters. TOTAL JS is every chunk, most of which a given visitor never
 * fetches. INITIAL LOAD is the entry plus everything `index.html` tells the
 * browser to modulepreload — the bytes standing between a visitor and first
 * paint, and the only figure a size budget should be argued against. Content
 * hashes are stripped from chunk names so the per-chunk table survives a
 * rebuild.
 *
 * `.map` files are excluded: they are emitted and served, but the browser only
 * fetches them when a devtools pane is open.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function measure(root) {
  const dir = path.join(root, 'dist', 'assets');
  if (!fs.existsSync(dir)) {
    throw new Error(`no built dist/assets in ${root} — run npm run build there first`);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  let raw = 0;
  let gz = 0;
  const per = {};
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    raw += buf.length;
    gz += zlib.gzipSync(buf).length;
    const name = f.replace(/-[A-Za-z0-9_-]{8,}\.js$/, '.js');
    per[name] = (per[name] || 0) + buf.length;
  }

  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  const preloaded = new Set(
    [...html.matchAll(/(?:href|src)="\/assets\/([^"]+\.js)"/g)].map(m => m[1]),
  );
  let initRaw = 0;
  let initGz = 0;
  for (const f of preloaded) {
    const buf = fs.readFileSync(path.join(dir, f));
    initRaw += buf.length;
    initGz += zlib.gzipSync(buf).length;
  }

  return { raw, gz, per, initRaw, initGz, initCount: preloaded.size, fileCount: files.length };
}

const kb = n => (n / 1024).toFixed(1);
const signed = n => `${n >= 0 ? '+' : ''}${kb(n)}`;

const [beforeRoot, afterRoot] = process.argv.slice(2);
if (!beforeRoot || !afterRoot) {
  console.error('usage: node scripts/measure-bundle-delta.mjs <before-root> <after-root>');
  process.exit(2);
}

const before = measure(beforeRoot);
const after = measure(afterRoot);

console.log('=== TOTAL JS (every chunk) ===');
console.log(`before: ${kb(before.raw)} kB raw / ${kb(before.gz)} kB gzip (${before.fileCount} files)`);
console.log(`after : ${kb(after.raw)} kB raw / ${kb(after.gz)} kB gzip (${after.fileCount} files)`);
console.log(`DELTA : ${signed(after.raw - before.raw)} kB raw / ${signed(after.gz - before.gz)} kB gzip`);

console.log('\n=== INITIAL LOAD (entry + modulepreload) ===');
console.log(`before: ${kb(before.initRaw)} kB raw / ${kb(before.initGz)} kB gzip (${before.initCount} chunks)`);
console.log(`after : ${kb(after.initRaw)} kB raw / ${kb(after.initGz)} kB gzip (${after.initCount} chunks)`);
console.log(`DELTA : ${signed(after.initRaw - before.initRaw)} kB raw / ${signed(after.initGz - before.initGz)} kB gzip`);

console.log('\n=== PER-CHUNK CHANGES OVER 0.5 kB ===');
const names = new Set([...Object.keys(before.per), ...Object.keys(after.per)]);
const rows = [];
for (const n of names) {
  const b = before.per[n] || 0;
  const a = after.per[n] || 0;
  if (Math.abs(a - b) > 512) rows.push({ n, b, a, d: a - b });
}
rows.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
for (const r of rows) {
  console.log(`${signed(r.d).padStart(8)} kB  ${r.n}  (${kb(r.b)} -> ${kb(r.a)})`);
}
if (rows.length === 0) console.log('(none)');
