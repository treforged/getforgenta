import fs from 'node:fs';
import path from 'node:path';

const kb = n => (n / 1024).toFixed(1);

function preloads(root, label) {
  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  const dir = path.join(root, 'dist', 'assets');
  const refs = new Set(
    [...html.matchAll(/(?:href|src)="\/assets\/([^"]+\.js)"/g)].map(m => m[1]),
  );
  let total = 0;
  const rows = [];
  for (const f of refs) {
    const size = fs.statSync(path.join(dir, f)).size;
    total += size;
    rows.push({ f, size });
  }
  rows.sort((a, b) => b.size - a.size);
  console.log(`\n=== ${label}: ${refs.size} preloaded chunks, ${kb(total)} kB ===`);
  rows.slice(0, 10).forEach(r => console.log(`${kb(r.size).padStart(9)} kB  ${r.f}`));
  return rows;
}

preloads('C:/Users/tvonh/Desktop/gf-before', 'BEFORE');
preloads('C:/Users/tvonh/Desktop/getforgenta', 'AFTER');

// Who pulls in the big index chunk?
for (const [label, root] of [
  ['BEFORE', 'C:/Users/tvonh/Desktop/gf-before'],
  ['AFTER', 'C:/Users/tvonh/Desktop/getforgenta'],
]) {
  const dir = path.join(root, 'dist', 'assets');
  const big = fs.readdirSync(dir).filter(f => /^index-DBZcL9Cp/.test(f) && f.endsWith('.js'))[0];
  const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
  console.log(`\n${label} big-index chunk: ${big} | referenced by index.html: ${html.includes(big)}`);
  // find which other chunks import it
  const importers = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    if (f === big) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (src.includes(big)) importers.push(f);
  }
  console.log(`  imported by ${importers.length} chunk(s): ${importers.slice(0, 6).join(', ')}`);
}
