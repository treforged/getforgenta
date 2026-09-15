/**
 * `extractPdfText` against the REAL pdf.js build production loads.
 *
 * This file exists because ask 0d9f8fae recorded the upload half of the statement feature as
 * having ZERO automated coverage, on the measured grounds that neither pdf.js build would run in
 * this harness. That blocker is now refuted (see `src/test-setup.ts`): the browser build calls
 * `Uint8Array.prototype.toHex`, a real browser API node does not have, and polyfilling it lets the
 * PRODUCTION build parse under vitest in both environments.
 *
 * So these are not mock tests. `pdfjs-dist` is NOT stubbed - every case below drives real PDF
 * bytes through the real parser. That matters most for the error mapping, because each of those
 * strings is a sentence shown to a person holding their bank statement.
 *
 * WHAT IS STILL NOT COVERED, and both are stated rather than implied:
 *   1. The PasswordException branch. Triggering it needs a genuinely ENCRYPTED PDF, and a
 *      hand-bolted `/Encrypt` entry is NOT one - pdf.js ignored it and parsed the file happily,
 *      so that test passed for the wrong reason until it was checked. The corrupt-file case
 *      below pins one direction of the discrimination; the password branch itself is UNTESTED.
 *   2. The worker. `GlobalWorkerOptions.workerSrc` is set from
 * `import.meta.url`, and under vitest pdf.js falls back to parsing on the main thread, so nothing
 * here proves the worker resolves as a local asset in a real build. That is a bundling fact and it
 * needs a browser; it is the one claim in this module a green run here does not support.
 */
import { describe, it, expect, vi } from 'vitest';
import { extractPdfText, PdfReadError, MAX_PDF_BYTES } from '../pdf-text';

/** A real, minimal, single-page PDF carrying the given lines. Built byte by byte rather than
 *  transcribed, so the fixture is the format rather than somebody's idea of it. */
function pdfBytes(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const lines of pages) {
    const content = `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i ? 'T*' : ''}(${l}) Tj`).join(' ')} ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objs.length + 2} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Array.from(out, c => c.charCodeAt(0) & 0xff));
}

function fileOf(bytes: Uint8Array, name = 'statement.pdf'): File {
  return new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' });
}

describe('extractPdfText', () => {
  it('returns the text of a single page', async () => {
    const text = await extractPdfText(fileOf(pdfBytes([['ACME BANK STATEMENT', 'DEPOSIT 1,234.56']])));
    expect(text).toContain('ACME BANK STATEMENT');
    expect(text).toContain('1,234.56');
  }, 30000);

  it('joins pages with a newline, so a caption cannot run across a page break', async () => {
    const text = await extractPdfText(fileOf(pdfBytes([['PAGE ONE TOTAL'], ['PAGE TWO TOTAL']])));
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('PAGE ONE');
    expect(lines[1]).toContain('PAGE TWO');
  }, 30000);

  it('stops at MAX_PAGES rather than grinding through a mis-picked document', async () => {
    // 15 pages against a cap of 12. Asserting the CAP, not merely "it returned something":
    // without the cap this is 15 lines, so the number is what discriminates.
    const many = Array.from({ length: 15 }, (_, i) => [`PAGE ${i + 1} MARKER`]);
    const text = await extractPdfText(fileOf(pdfBytes(many)));
    expect(text.split('\n')).toHaveLength(12);
    expect(text).toContain('PAGE 12 MARKER');
    expect(text).not.toContain('PAGE 13 MARKER');
  }, 60000);

  it('refuses an oversized file BEFORE decoding it', async () => {
    const big = { size: MAX_PDF_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
    await expect(extractPdfText(big)).rejects.toThrow(PdfReadError);
    // The point of the guard is that nothing is read. If arrayBuffer ran, the refusal happened
    // after decoding and the guard is decorative.
    expect((big as unknown as { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).not.toHaveBeenCalled();
  });

  it('maps a corrupt file to a sentence a person can act on', async () => {
    const junk = new Uint8Array(Array.from('this is not a pdf at all', c => c.charCodeAt(0)));
    await expect(extractPdfText(fileOf(junk))).rejects.toThrow(PdfReadError);
    await expect(extractPdfText(fileOf(junk))).rejects.toThrow('That file could not be read as a PDF.');
  }, 30000);

  it('a corrupt file gets the generic sentence and NOT the password one', async () => {
    // The two strings are the point: telling someone their statement is unreadable when it is
    // merely password protected sends them to the wrong fix. This pins one direction of that
    // discrimination - a change that collapsed both branches onto the password sentence fails here.
    const junk = new Uint8Array(Array.from('this is not a pdf at all', c => c.charCodeAt(0)));
    await expect(extractPdfText(fileOf(junk))).rejects.toThrow('That file could not be read as a PDF.');
    await expect(extractPdfText(fileOf(junk))).rejects.not.toThrow('password protected');
  }, 30000);
});
