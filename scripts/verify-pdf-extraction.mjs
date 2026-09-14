#!/usr/bin/env node
// Is the pinned pdf.js extraction fixture still what pdf.js actually produces?
//
// `src/lib/__tests__/statement-parse.test.ts` pins REAL_PDF_EXTRACTION — the single-line, no-newline
// shape a statement PDF comes back as. That fixture caught a real defect (a promo regex anchored to
// a line start, which a caption-per-line reconstruction said worked and which found nothing on real
// extracted text), so it earns its place.
//
// ⚠️ BUT IT IS A HAND-TRANSCRIBED CONSTANT, WHICH MAKES IT A CLAIM ABOUT WHAT pdf.js DID ON
// 2026-09-14 AND NOT A CHECK ON WHAT IT DOES NOW. `pdfjs-dist` is depended on as `^6.3.289` — a
// caret, so the installed build floats. If an upgrade changed how text items are segmented, the
// pinned string would sit there agreeing with itself forever while the parser silently stopped
// reading real statements. This regenerates the document and compares.
//
// ⚠️ WHY THIS IS A SCRIPT AND NOT A VITEST TEST, stated because the gap is real. `extractPdfText`
// does `await import('pdfjs-dist')`, and NEITHER build runs under this repo's vitest harness: the
// main build reaches `hashOriginal.toHex` and `Uint8Array.prototype.toHex` is undefined on Node
// 24.14.0, and the legacy build (which self-polyfills, and which is what this script uses) fails
// under vite's transform. Three approaches were tried and none worked.
//
// SO SAY WHAT THIS DOES NOT COVER: it does not exercise `extractPdfText` itself — not its page
// loop, its MAX_PAGES cap, its error mapping, or its `task.destroy()`. Those remain WITHOUT
// AUTOMATED COVERAGE OF ANY KIND. What it does cover is the one thing that can drift underneath
// them: whether pdf.js still returns the shape the parser's fixtures assume. The item→string join
// below is copied from pdf-text.ts and a change there would not be caught here.
//
//   node scripts/verify-pdf-extraction.mjs        exit 0 pass · 1 mismatch · 2 could not check

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// Resolved by SEARCH rather than by counting `..`, so moving this file does not silently break it.
const PDFJS = resolve(HERE, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');

/** The exact string pinned in statement-parse.test.ts as REAL_PDF_EXTRACTION. */
const PINNED =
  'CHASE PRIME VISA STATEMENT New Balance $8,189.99 Interest Saving Balance $1,451.88 '
  + 'Minimum Payment Due $773.05 Total Plans Payment Due $198.83 Equal Pay Promo 0.00% '
  + 'Purchase APR 27.24%';

/** The same captions, one per line, as a statement is LAID OUT. */
const LINES = [
  'CHASE PRIME VISA STATEMENT',
  'New Balance $8,189.99',
  'Interest Saving Balance $1,451.88',
  'Minimum Payment Due $773.05',
  'Total Plans Payment Due $198.83',
  'Equal Pay Promo 0.00%',
  'Purchase APR 27.24%',
];

/**
 * A minimal single-page PDF carrying `lines` as real text operators.
 *
 * Hand-written rather than pulled in as a dependency: a PDF writer would be a second thing to
 * trust, and the subject here is pdf.js. `latin1` byte packing is required — a PDF's cross-reference
 * table is BYTE offsets, so UTF-8 encoding would shift every offset past the first non-ASCII byte.
 */
function makeStatementPdf(lines) {
  const esc = s => s.replace(/([\()])/g, String.raw`\$1`);
  let content = 'BT /F1 10 Tf 40 750 Td 14 TL\n';
  lines.forEach((line, i) => { content += (i ? 'T*' : '') + ` (${esc(line)}) Tj\n`; });
  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { out += String(o).padStart(10, '0') + ' 00000 n \n'; });
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

async function extract(pdfjs, bytes) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      // Copied from pdf-text.ts — see the header note about this duplication.
      pages.push(content.items.map(i => (typeof i.str === 'string' ? i.str : '')).join(' '));
    }
    return pages.join('\n');
  } finally { void task.destroy(); }
}

let pdfjs;
try {
  pdfjs = await import(pathToFileURL(PDFJS).href);
} catch (e) {
  console.error('COULD NOT CHECK — pdf.js failed to load:', e.message);
  console.error('Looked for:', PDFJS);
  process.exit(2);          // never 1: "could not check" must not read as "mismatch"
}

const actual = (await extract(pdfjs, makeStatementPdf(LINES))).trim();
const checks = [];
checks.push(['no newlines in a single-page extraction', !actual.includes('\n')]);
checks.push(['matches the pinned REAL_PDF_EXTRACTION fixture', actual === PINNED]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (!checks.length) { console.error('COULD NOT CHECK — zero checks ran'); process.exit(2); }

if (failed) {
  console.error('\npdf.js no longer returns the pinned shape.');
  console.error(`  pinned (${PINNED.length}): ${JSON.stringify(PINNED)}`);
  console.error(`  actual (${actual.length}): ${JSON.stringify(actual)}`);
  console.error('\nUpdate REAL_PDF_EXTRACTION in src/lib/__tests__/statement-parse.test.ts to the');
  console.error('actual string, then re-run the suite: the parser may need widening, and a promo');
  console.error('row silently going missing is the failure this exists to catch.');
  process.exit(1);
}
console.log(`\n${checks.length} checks passed — extraction is ${actual.length} chars, 0 newlines.`);
