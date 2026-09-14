// EVERY THEME MUST DECLARE `color-scheme`, OR THE OPERATING SYSTEM DRAWS THE WRONG CONTROLS.
//
// ⚠️ THE DEFECT THIS EXISTS FOR WAS LIVE IN PRODUCTION UNTIL 2026-09-14, and no gate in this repo
// could see it. `.light` declared `color-scheme: light`; the DEFAULT (dark) palette on `:root` and
// `.dark` declared nothing, so it fell back to `light`. Measured in Chrome on getforgenta.com: with
// `.dark` applied, `document.body` computed `rgb(5, 5, 5)` while `color-scheme` computed `light`.
//
// ⚠️ WHY CSS ON THE CONTROL CANNOT FIX IT, which is the part that makes this worth a gate. The open
// `<select>` list, the date picker, the number spinners, the scrollbars and Chrome's autofill
// repaint are drawn by the OS, not by the page. `background-color` on a `<select>` styles the
// closed control and does nothing whatever to the list it drops open. `color-scheme` is the only
// lever the page has. So the app could pass every visual review while closed and drop open a white
// list with a blue highlight on a near-black panel — which is exactly what Tre reported on
// treforged.com: "why is it a white box. then the drop down looks so shit."
//
// ⚠️ A SOURCE SCAN IS THE HONEST INSTRUMENT HERE, AND ITS LIMIT IS STATED RATHER THAN IMPLIED.
// jsdom returns '' for class-driven computed styles and has no OS control layer at all, so a
// computed-style assertion in this harness would pass against a page with the defect — green over
// nothing. This asserts the DECLARATION exists in the stylesheet. It cannot tell you the rendered
// popup looks right; only a real browser can, and that measurement is recorded in the commit.
//
// WHAT THIS DOES NOT CATCH: whether the declared value suits the palette, contrast inside a popup,
// controls created by a third-party embed, and any theme added in a file other than `src/index.css`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/**
 * Pull the body of a top-level theme selector out of the stylesheet by brace matching.
 *
 * Deliberately NOT a regex: these blocks contain nested rules and long comments with braces in
 * them, and a lazy `\{([^}]*)\}` stops at the first `}` inside a comment — which would read a
 * present declaration as absent and make this gate fail on correct code. A gate that is wrong on
 * ordinary work is one somebody switches off on the day it matters.
 */
function blockBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return '';
  let depth = 0;
  for (let i = at; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(at, i);
    }
  }
  return '';
}

/**
 * The themes, ENUMERATED rather than counted-by-exclusion. An inventory defined as "every selector
 * that is not X" grows silently as selectors are added; this list is what must be there, so a new
 * theme that nobody adds here is a gap a reader can see rather than one the gate hides.
 *
 * `:root` carries the dark palette in this app and is what applies BEFORE the theme script runs, so
 * omitting it there gives a flash of light-chrome controls on first paint.
 */
const THEMES: readonly { selector: string; expected: 'dark' | 'light' }[] = [
  { selector: ':root', expected: 'dark' },
  { selector: '.dark', expected: 'dark' },
  { selector: '.light', expected: 'light' },
];

describe('color-scheme is declared on every theme', () => {
  it.each(THEMES)('$selector declares color-scheme: $expected', ({ selector, expected }) => {
    const body = blockBody(selector);
    expect(body, `${selector} block not found in src/index.css`).not.toBe('');
    const m = body.match(/(?<!-)\bcolor-scheme\s*:\s*([a-z ]+);/);
    expect(m, `${selector} declares no color-scheme — OS-drawn popups will not follow this theme`).toBeTruthy();
    expect(m![1].trim()).toBe(expected);
  });

  it('the dark themes do not declare LIGHT — the regression that shipped', () => {
    for (const sel of [':root', '.dark']) {
      expect(blockBody(sel)).not.toMatch(/(?<!-)\bcolor-scheme\s*:\s*light\s*;/);
    }
  });

  it('every theme in the enumeration was actually found, so a rename cannot empty this gate', () => {
    // ⚠️ Without this, renaming `.dark` would make `blockBody` return '' for it, the `.each` case
    // would fail loudly — but a future refactor that also trimmed the THEMES list would leave a
    // passing suite that checks nothing. The count is the thing a reader can verify at a glance.
    expect(THEMES.length).toBe(3);
    for (const { selector } of THEMES) expect(blockBody(selector).length).toBeGreaterThan(50);
  });
});
