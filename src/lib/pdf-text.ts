// Pull the text out of a PDF, in the browser, without sending it anywhere.
//
// Tre, 2026-09-12: "make a feature where users can add or upload a statement that can be auto
// scanned..." — the "upload" half. The parsing half is `@/lib/statement-parse`, and this deliberately
// does no parsing of its own: it turns a file into text and stops. Upload is a different way IN to
// the same parser, not a second feature with its own idea of what a statement says.
//
// ⚠️ THE IMPORT IS DYNAMIC, AND THAT IS THE WHOLE REASON THIS WAS AFFORDABLE. pdf.js is ~350KB in an
// app that shipped no PDF dependency, and I refused to add it to the main bundle for a feature most
// people will never open. `await import()` means Vite emits it as its OWN chunk, fetched the first
// time somebody actually picks a file — so the cost is paid by the people using it and by nobody
// else. If this ever becomes a static import at the top of the file, that trade is silently undone.
//
// ⚠️ IT NEVER LEAVES THE DEVICE. pdf.js decodes locally; there is no upload, no endpoint, and no
// third party. A bank statement is the most sensitive document this app will ever touch, and the
// copy in the dialog promises exactly this — so the promise and the mechanism have to stay
// together.

/** Pages beyond this are ignored. A statement's figures are on the first page or two; a 200-page
 *  document is a mis-pick, and grinding through it would freeze the tab rather than fail. */
const MAX_PAGES = 12;

/** Bigger than any real statement. Refused before decoding rather than after. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export class PdfReadError extends Error {}

/**
 * The text of a PDF, page by page, joined with newlines.
 *
 * Throws `PdfReadError` with a sentence fit to show a person. Every failure here is something they
 * can act on — wrong file, encrypted, corrupt — so none of them is swallowed.
 */
export async function extractPdfText(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfReadError('That file is too large to read here.');
  }

  let pdfjs: typeof import('pdfjs-dist');
  try {
    pdfjs = await import('pdfjs-dist');
  } catch {
    throw new PdfReadError('Could not load the PDF reader. Paste the text instead.');
  }

  // ⚠️ THE WORKER IS RESOLVED THROUGH `import.meta.url`, NOT FROM A CDN. A `workerSrc` pointing at
  // somebody else's host would mean a bank statement is decoded by a script fetched at runtime from
  // a third party — which is the one thing the copy in this feature promises does not happen. This
  // form makes Vite bundle the worker as a local asset.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const bytes = new Uint8Array(await file.arrayBuffer());

  // ⚠️ THE LOADING TASK IS KEPT, NOT DISCARDED. `destroy()` lives on the TASK and not on the
  // document — a first version called `doc.destroy()`, which does not exist and which TypeScript
  // caught. It is what tears the worker down, so losing the handle leaks a worker port per read.
  const task = pdfjs.getDocument({ data: bytes });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'PasswordException') {
      throw new PdfReadError('That PDF is password protected. Open it and paste the text instead.');
    }
    throw new PdfReadError('That file could not be read as a PDF.');
  }

  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Items carry their own `str`; joining with spaces preserves the caption/figure adjacency the
      // parser matches on, and a newline per page keeps captions from running across a page break.
      const line = content.items
        .map(item => (typeof (item as { str?: unknown }).str === 'string' ? (item as { str: string }).str : ''))
        .join(' ');
      pages.push(line);
    }
    return pages.join('\n');
  } finally {
    // Released whether or not the loop threw: each read holds a worker port, and leaking one per
    // failed attempt would quietly accumulate across retries.
    void task.destroy();
  }
}
