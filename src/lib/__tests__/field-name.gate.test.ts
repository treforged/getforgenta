// EVERY FORM FIELD HAS AN ACCESSIBLE NAME - app-wide census.
//
// THE DEFECT. Most fields in this app sat under a SIBLING caption (<label>, <span>, <p>) with no
// htmlFor/id link, so the caption was visible but a screen reader announced only "edit text".
// Measured 2026-09-23: 117 of 138 input/select/textarea tags had no aria-label, no id and no
// wrapping <label>, including Email, Password and the verification code on the sign-in screen.
// All were named that day (the onboarding wizard's shared Input/Select now REQUIRE a `label` prop,
// so the typechecker finds any new caller that forgets it). This gate keeps the count at zero.
//
// Discovery is by the TAG, never by the name attribute, and comments are blanked before the scan
// (two JSDoc blocks mention `<select>` in prose and read as fields otherwise).
//
// WHAT THIS DOES NOT CATCH: a name that is WRONG, fields rendered by third-party components, and
// checkbox, radio, file and hidden inputs, which are excluded. A wrapping <label> is judged by a
// 400-character look-back, so a very long label body could hide an unnamed field.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/** Blank block comments, keeping every newline so line numbers stay true. */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function unnamedFields(raw: string): number[] {
  const src = blankComments(raw);
  const lines: number[] = [];
  const re = /<(input|select|textarea)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let q: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q && src.charCodeAt(i - 1) !== 92) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const tag = src.slice(m.index, i + 1);
    if (/type=["'](hidden|checkbox|radio|file)["']/.test(tag)) continue;
    if (/\baria-label(ledby)?=|\bid=/.test(tag)) continue;
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
    lines.push(src.slice(0, m.index).split('\n').length);
  }
  return lines;
}

const FILES = globSync('src/**/*.tsx').filter((f) => !f.includes('__tests__'));

describe('form fields have an accessible name', () => {
  it('the scan finds an unnamed field and ignores one in a comment (controls on the instrument)', () => {
    expect(unnamedFields('<div>\n<label>X</label>\n<input type="text" />\n</div>')).toEqual([3]);
    expect(unnamedFields('<input aria-label="X" />')).toEqual([]);
    expect(unnamedFields('/**\n * The one `<select>` on every surface.\n */')).toEqual([]);
  });

  it('it examines the app, not nothing', () => {
    const fields = FILES.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/<(input|select|textarea)(?=[\s/>])/g)?.length ?? 0), 0);
    expect(fields).toBeGreaterThan(100);
  });

  it('every field in the app is named', () => {
    const missing = FILES.flatMap((f) => unnamedFields(readFileSync(f, 'utf8')).map((n) => `${f.replace(/\\/g, '/')}:${n}`));
    expect(missing).toEqual([]);
  });
});
