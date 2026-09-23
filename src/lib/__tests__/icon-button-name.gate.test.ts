// EVERY ICON-ONLY BUTTON HAS AN ACCESSIBLE NAME.
//
// THE DEFECT. Accounts' Edit and Delete controls were a pencil and a bin with no text, no
// aria-label and no title, so a screen reader announced "button" twice per row and the press
// crawler (npm run walk:press) could only call them "(no name)". Found 2026-09-23.
//
// DISCOVERY IS BY THE SHAPE: a <button> carrying the `icon-btn` class. Never by aria-label, which
// would search only among the already-correct.
//
// WHAT THIS DOES NOT CATCH: icon buttons that do not use `icon-btn`, a name that is WRONG, and a
// button whose only name is visible text rendered by a child component this scan cannot see.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/** A JSX open tag, tracking brace and quote depth so a `>` in `onClick={() => ...}` cannot end it. */
function openTags(src: string, tag: string): { tag: string; lineNo: number; rest: string }[] {
  const out: { tag: string; lineNo: number; rest: string }[] = [];
  const re = new RegExp('<' + tag + '(?=[\\s/>])', 'g');
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
    const close = src.indexOf('</' + tag + '>', i);
    out.push({
      tag: src.slice(m.index, i + 1),
      lineNo: src.slice(0, m.index).split('\n').length,
      rest: close < 0 ? '' : src.slice(i + 1, close),
    });
  }
  return out;
}

interface IconButton { file: string; lineNo: number; tag: string; body: string }

function everyIconButton(): IconButton[] {
  const rows: IconButton[] = [];
  for (const file of globSync('src/**/*.tsx').filter((f) => !f.includes('__tests__'))) {
    const src = readFileSync(file, 'utf8');
    for (const { tag, lineNo, rest } of openTags(src, 'button')) {
      // Two shapes: the icon-btn class, and a body that is ONE self-closing component and nothing
      // else (an <X/> close, an <Edit2/>). The second found 31 more unnamed buttons on 2026-09-23,
      // FormModal's close among them, which every form in the app shares.
      const onlyIcon = /^<[A-Z]\w*[^>]*\/>$/.test(rest.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim());
      if (/\bicon-btn\b/.test(tag) || onlyIcon) rows.push({ file: file.replace(/\\/g, '/'), lineNo, tag, body: rest });
    }
  }
  return rows;
}

/** Named if it carries aria-label / aria-labelledby / title, or its body has literal visible text. */
function isNamed(b: IconButton): boolean {
  if (/\baria-label(ledby)?=|\btitle=/.test(b.tag)) return true;
  const text = b.body.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').trim();
  return /[A-Za-z]{2,}/.test(text);
}

describe('icon buttons have an accessible name', () => {
  const buttons = everyIconButton();

  it('finds icon buttons at all, including Accounts\' known move-up control (control on the instrument)', () => {
    expect(buttons.length).toBeGreaterThan(5);
    expect(buttons.some((b) => b.file.endsWith('pages/Accounts.tsx') && /Move \$\{a\.name\} up/.test(b.tag))).toBe(true);
    // The icon-only shape is found too, not only the class.
    expect(buttons.some((b) => b.file.endsWith('shared/FormModal.tsx') && !/icon-btn/.test(b.tag))).toBe(true);
  });

  it('every one is named', () => {
    const missing = buttons.filter((b) => !isNamed(b)).map((b) => `${b.file}:${b.lineNo}`);
    expect(missing).toEqual([]);
  });
});
