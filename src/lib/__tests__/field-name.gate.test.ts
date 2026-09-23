// FORM FIELDS HAVE AN ACCESSIBLE NAME - a RATCHET over the files that are finished.
//
// THE DEFECT. Most fields in this app sit under a SIBLING <label> with no htmlFor/id link, so the
// caption is visible but a screen reader announces only "edit text". Measured 2026-09-23: 117 of
// 138 input/select/textarea tags had no aria-label, no id and no wrapping <label>. The sign-in,
// security and settings fields were fixed first because they are the ones every user meets.
//
// ⚠️ THIS IS A HAND-NAMED LIST AND IT SAYS SO. It is a ratchet, not a census: a file enters
// FINISHED only once every field in it is named, and it never leaves. The app-wide count lives in
// the test's own output so the remaining work cannot hide - see the second test.
//
// WHAT THIS DOES NOT CATCH: fields in files not yet on the list, a name that is WRONG, fields built
// by shared components (onboarding/fields.tsx needs a label PROP, not an attribute), and checkbox,
// radio, file and hidden inputs, which are excluded.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

const FINISHED = [
  'src/pages/Auth.tsx',
  'src/pages/Settings.tsx',
  'src/pages/BudgetControl.tsx',
  'src/components/builds/PhaseBlock.tsx',
  'src/components/forecast/ForecastAssumptionsPanel.tsx',
  'src/pages/Transactions.tsx',
  'src/components/builds/MaintenanceFormModal.tsx',
  'src/components/settings/PhoneAuth.tsx',
  'src/components/settings/TwoFactorAuth.tsx',
];

function unnamedFields(src: string): number[] {
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

describe('form fields have an accessible name', () => {
  it('the scan finds an unnamed field when there is one (control on the instrument)', () => {
    expect(unnamedFields('<div><label>X</label><input type="text" /></div>')).toEqual([1]);
    expect(unnamedFields('<input aria-label="X" />')).toEqual([]);
  });

  it('every field in a FINISHED file is named', () => {
    const missing = FINISHED.flatMap((f) => unnamedFields(readFileSync(f, 'utf8')).map((n) => `${f}:${n}`));
    expect(missing).toEqual([]);
  });

  it('reports how many unnamed fields remain app-wide, so the ratchet cannot hide the rest', () => {
    const remaining = globSync('src/**/*.tsx')
      .filter((f) => !f.includes('__tests__'))
      .reduce((n, f) => n + unnamedFields(readFileSync(f, 'utf8')).length, 0);
    console.info(`[field-name gate] unnamed fields outside the finished files: ${remaining}`);
    expect(remaining).toBeGreaterThan(0); // flip this to toBe(0) the day the list covers the app
  });
});
