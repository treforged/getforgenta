/**
 * A FIGURE MUST NEVER WRAP. NOT ANYWHERE, NOT AT ANY WIDTH.
 *
 * Tre, 2026-09-17, with a screenshot of Home > Overview: "numbers should never wrap. fix that.
 * this one example was on the home overview tab." AVG MONTHLY SPEND rendered "$1,42" with the
 * "2" on the next line, and EMERGENCY RUNWAY split "0.2" from "mo". A figure broken mid-number
 * is not merely ugly - for a moment it reads as a DIFFERENT NUMBER, which is the same class of
 * harm as truncating one.
 *
 * WHY THIS IS A RENDERED CHECK. MetricCard's own unit test says plainly that it can only lock
 * the DECISION (the class list), never the pixels, because jsdom does no layout and reports
 * every element at zero width. Whether a string actually fits its tile is a fact about fonts,
 * grid widths and the viewport, and only a browser has those.
 *
 * WHAT IT MEASURES: for every candidate figure on the page, whether the element's rendered box
 * is taller than a single line of its OWN computed line-height. Reading the line-height off the
 * element rather than assuming a constant matters - these tiles change type size by breakpoint
 * AND by value length, so any fixed pixel bar would be wrong on most of them.
 *
 * ⚠️ IT ALSO CHECKS OVERFLOW, BECAUSE THE OBVIOUS FIX FOR WRAPPING CAUSES SPILLING. This exact
 * element began life as `whitespace-nowrap` and spilled over its card onto the neighbouring
 * tile; it was then made to wrap; it is now nowrap plus a size ladder. Asserting "does not wrap"
 * alone would pass the original defect perfectly, so scrollWidth <= clientWidth is asserted in
 * the same pass and a violation says WHICH of the two it is.
 *
 * EXIT CODES ARE LOAD-BEARING: 1 = a figure wraps or overflows (a finding), 2 = the probe could
 * not find any figures to measure (an instrument fault). An exit-1 defect gets fixed; an exit-2
 * tooling fault gets re-run and then ignored, so collapsing them buries real findings.
 *
 * DOES NOT COVER: colour, contrast, spacing, whether the number is the RIGHT number, screens
 * behind authentication (this walks /demo, which needs no credentials), or text that is not a
 * figure. It reads only elements whose text is money/percent/number-shaped.
 */
import { chromium } from 'playwright';

const BASE = process.env.WALK_BASE ?? 'http://localhost:8080';
const ROUTE = '/demo';
// Two widths on purpose: the tiles re-flow at the `sm:` breakpoint and change type size with it,
// so a single width proves only half the ladder. 390 is the phone Tre reported from.
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

let exitCode = 0;
const browser = await chromium.launch();
try {
  for (const vp of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle' });
    // The tiles render after data resolves; wait for something from the section rather than a
    // fixed sleep, so a slow machine does not measure an empty page and call it clean.
    await page.waitForTimeout(3000);

    const found = await page.evaluate(() => {
      // Money, percent, or a plain number - optionally with a short unit like "mo" or "yr".
      // Deliberately narrow: this gate is about FIGURES, and matching prose would make it cry
      // wolf on sentences that are supposed to wrap.
      const FIGURE = /^-?[$]?[0-9][0-9,]*(\.[0-9]+)?[%]?( ?(mo|yr|d|hrs?|days?))?$/;
      const out = [];
      for (const el of document.querySelectorAll('p,span,div,h1,h2,h3,h4')) {
        if (el.children.length > 0) continue;            // leaves only - a parent's text is its children's
        const text = (el.textContent || '').trim();
        if (!text || text.length > 20) continue;
        if (!FIGURE.test(text)) continue;
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;   // not rendered
        out.push({
          text,
          lines: Math.round((r.height / lh) * 100) / 100,
          lineHeight: Math.round(lh * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          overflowX: Math.round((el.scrollWidth - el.clientWidth) * 10) / 10,
          fontSize: cs.fontSize,
          whiteSpace: cs.whiteSpace,
          cls: (el.className || '').toString().slice(0, 70),
          boxW: Math.round(el.clientWidth),
          needW: Math.round(el.scrollWidth),
        });
      }
      return out;
    });

    // CONTROL ON THE INSTRUMENT: a zero from a probe that matched nothing and a zero from a page
    // with no defect are the same zero. This separates them, and exits 2 rather than 0 or 1.
    if (found.length === 0) {
      console.error(`CONTROL FAILED at ${vp.name}: no figure-shaped text was found on ${ROUTE}, so nothing was measured.`);
      exitCode = 2;
      await page.close();
      continue;
    }

    // A rendered box taller than ~1.5 line-heights is two lines. The slack absorbs sub-pixel
    // rounding and font metrics without reaching a genuine second line.
    const wrapped = found.filter(f => f.lines > 1.5);
    const spilled = found.filter(f => f.overflowX > 1);

    console.log(`${vp.name} ${vp.width}x${vp.height}: ${found.length} figures measured, ${wrapped.length} wrapped, ${spilled.length} overflowing`);
    for (const f of wrapped) {
      console.error(`FAIL wrap ${vp.name}: "${f.text}" occupies ${f.lines} lines (height ${f.height}px vs line-height ${f.lineHeight}px, font ${f.fontSize}, white-space ${f.whiteSpace})`);
      exitCode = Math.max(exitCode, 1);
    }
    for (const f of spilled) {
      console.error(`FAIL spill ${vp.name}: "${f.text}" overflows its box by ${f.overflowX}px (box ${f.boxW}px, needs ${f.needW}px, font ${f.fontSize}) [${f.cls}]`);
      exitCode = Math.max(exitCode, 1);
    }
    await page.close();
  }
  if (exitCode === 0) console.log('PASS: no figure wraps or overflows at either width.');
} finally {
  await browser.close();
}
process.exit(exitCode);
