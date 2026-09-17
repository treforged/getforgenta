// THE SEGMENTED CONTROL IS A PILL, AND NO CALL SITE MAY SAY OTHERWISE.
//
// Tre, 2026-08-18: *"ovals like copilot and monarch do."* And 2026-09-13, on a different
// control: *"consider design of other apps when thinking about our design always. and
// consistency across tabs."*
//
// ⚠️ THE DRIFT THIS CLOSES, measured 2026-09-15 rather than guessed. `@utility seg-item` sets
// `border-radius: 9999px`, and SEVENTEEN of the eighteen call sites then overrode it inline with
// `style={{ borderRadius: 'var(--radius)' }}`. So the pill in the utility was dead code
// everywhere except `Transactions.tsx`, which carried no override and was therefore the only
// surface that looked the way he asked for. Eighteen buttons, two different shapes, and the
// utility disagreeing with almost all of its own callers.
//
// ⚠️ THE ODD ONE OUT WAS THE CORRECT ONE, which is why the fix was to delete the overrides rather
// than add an eighteenth. The filed ask said "EVERY caller then overrides it" — one did not, and
// reading the count rather than the sentence is what turned "the utility is dead code" into "one
// surface disagrees with seventeen".
//
// ⚠️ AND IT IS NOT A TASTE CALL, it is arithmetic — `rules/common/corner-concentricity.md`.
// Measured on /demo at 1440: the track is 42px high with a 9999px radius and 4.5px of padding, so
// its effective corner radius is 21px and the gap to the child is 4.5px. 4.5 < 21, so the rule
// BINDS, and `r_inner = 21 - 4.5 = 16.5px`. The child is 31px high, so any radius at or above
// 15.5px renders as a pill — the concentric answer IS the oval. The override was rendering 12px,
// 4.5px short, which swells the gap at each corner: the "child floating loose inside a box that
// does not fit it" case the rule names.
//
// ⚠️ WHAT THIS GATE CANNOT SEE, said rather than implied: it reads SOURCE, so it cannot prove
// anything about the rendered corner. A source gate can only check that the mechanism is
// declared. The geometry was verified by rendered frames at deviceScaleFactor 2, before and
// after, and by reading `getComputedStyle(...).borderTopLeftRadius` off the live page — 12px
// before, 9999px after. It also cannot see a radius arriving through a variable, a `cn()` call,
// or a Tailwind `rounded-*` class, and it says nothing about colour, spacing or contrast.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');

/** Every .tsx/.ts under src/, walked — never enumerated. A hand-named file list passes the
 *  file nobody added to it, which is the same defect this gate exists to catch. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);

/** Built by concatenation so this file's own prose cannot match itself. */
const SEG_ITEM = new RegExp('seg' + '-item');

/** An inline border-radius on the same element. The attribute may be on the className line or on
 *  the next one, so the window is a short span of characters rather than a single line. */
const INLINE_RADIUS = /style=\{\{[^}]*borderRadius[^}]*\}\}/;

interface Site { file: string; line: number; text: string }

/** Every `seg-item` call site, with the small window after it that an inline style would sit in. */
function segItemSites(): { sites: Site[]; offenders: Site[] } {
  const sites: Site[] = [];
  const offenders: Site[] = [];
  for (const file of FILES) {
    const body = readFileSync(file, 'utf8');
    if (!SEG_ITEM.test(body)) continue;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      // A call site is a className that USES the utility, not a comment that mentions it.
      if (!SEG_ITEM.test(lines[i]) || !lines[i].includes('className')) continue;
      const site = { file: relative(SRC, file), line: i + 1, text: lines[i].trim().slice(0, 90) };
      sites.push(site);
      const window = lines.slice(i, i + 3).join('\n');
      if (INLINE_RADIUS.test(window)) offenders.push(site);
    }
  }
  return { sites, offenders };
}

describe('the segmented control keeps one shape', () => {
  // POSITIVE CONTROL. Every assertion below is an ABSENCE, and an absence is satisfied perfectly
  // by finding no call sites at all — a renamed utility, a broken walker, a matcher that cannot
  // cross a quote. "0 overrides" and "0 buttons examined" are the same zero.
  it('finds the seg-item call sites at all', () => {
    const { sites } = segItemSites();
    expect(FILES.length).toBeGreaterThan(100);
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('declares the pill exactly once, in the utility', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const start = css.indexOf('@utility seg' + '-item {');
    expect(start).toBeGreaterThan(-1);

    // ⚠️ READ TO THE CLOSING BRACE, NOT TO A MAGIC 600 CHARACTERS. This used to slice a fixed
    // window, and on 2026-09-16 a comment added INSIDE the utility pushed `border-radius` past
    // character 600 and turned a correct file red. A gate that extracts before it asserts is
    // only as good as its extraction, and an arbitrary constant silently decides what gets
    // asserted - the failure said "the radius is missing" when the radius had not moved.
    let depth = 0;
    let end = start;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const block = css.slice(start, end + 1);

    // A control on the EXTRACTION itself: an empty or runaway slice must not be able to pass or
    // to fail for the wrong reason. The utility is a few lines of CSS plus its comment, never
    // the whole stylesheet.
    expect(block.length).toBeGreaterThan(80);
    expect(block.length).toBeLessThan(css.length / 2);
    expect(block).toContain('@apply');

    expect(block).toContain('border-radius: 9999px');
  });

  it('no call site overrides the radius inline', () => {
    const { sites, offenders } = segItemSites();
    const detail = offenders.map(o => `${o.file}:${o.line}  ${o.text}`).join('\n');
    expect(
      offenders.length,
      `${offenders.length} of ${sites.length} seg-item call sites override the pill radius inline. ` +
        `The utility owns the shape; a call site that restates it is a second place for it to be ` +
        `wrong, and a var(--radius) child inside a pill track is not concentric with it.\n${detail}`,
    ).toBe(0);
  });
});
