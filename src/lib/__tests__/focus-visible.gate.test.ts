// EVERY FORM CONTROL IN THE APP KEEPS A VISIBLE FOCUS INDICATOR.
//
// THE DEFECT, TWICE. A control that carries `outline-none` / `outline-hidden` and puts nothing
// back has NO visible focus state at all: a keyboard or switch user tabbing into it lands on an
// invisible cursor. It happened first in `FriendLink.tsx`'s username field, which is why
// `src/components/shared/field-classes.ts` exists. It happened AGAIN, in
// `UsernameClaim.tsx`, because that file hand-rolled a copy of the wrapper/input pair instead of
// importing the constants - and the hand-rolled wrapper had no `focus-within` ring.
//
// ⚠️ THE EXISTING GATE COULD NOT HAVE CAUGHT THE SECOND ONE: `field-consistency.test.ts` reads
// ONE FILE (FriendLink). Tre's instruction was "consistency across tabs", and a gate scoped to the
// screen where a defect was first reported just relocates the defect. This one is repo-wide.
//
// ⚠️ DISCOVERY IS BY ELEMENT, NEVER BY THE SHARED CONSTANT. A hand-rolled control is precisely the
// one that does not import `FIELD_INPUT`, so finding candidates by that marker would search only
// among the already-correct - the exact blind spot measured on the one-switch gate on 2026-09-14,
// where six hand-rolled switches were invisible because they lacked the role the gate matched on.
//
// MEASURED IN A REAL BROWSER, BOTH DIRECTIONS, 2026-09-16 - because a class list cannot show
// whether a ring is visible:
//   hand-rolled wrapper : box-shadow "none" before focus AND "none" after, input outline "none"
//   shared wrapper      : box-shadow "none" -> rgb(201,162,64) 0 0 0 1px on focus
//
// WHAT THIS DOES NOT CATCH, stated so nobody trusts it further than it goes: whether the ring has
// adequate CONTRAST, whether it is occluded by an ancestor's `overflow-hidden`, controls built at
// runtime, controls in files outside `src/`, and any indicator expressed through a mechanism other
// than a `focus:`/`focus-within:` utility. It proves the MECHANISM is declared, not that a human
// can see it.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/**
 * Scan a JSX open tag, tracking brace and quote depth so a `>` inside an inline handler
 * (`onChange={e => ...}`) cannot end the tag early. The naive non-greedy regex reported 43 of 44
 * `<select>` elements as carrying no className, which was false - measured before this was written.
 */
function openTags(src: string, tag: string): { tag: string; lineNo: number }[] {
  const out: { tag: string; lineNo: number }[] = [];
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
    out.push({ tag: src.slice(m.index, i + 1), lineNo: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const KILLS_OUTLINE = /\boutline-(none|hidden)\b/;
/** Any utility that paints something on focus, on the element or on its wrapper. */
const RESTORES_INDICATOR = /\bfocus(-within)?:(ring|outline|border|shadow|bg)/;
/** Delegating to a shared constant is correct BY DESIGN - the constant owns the indicator. */
const DELEGATES = /FIELD_INPUT\b|FIELD_INPUT_BARE\b|FIELD_WRAPPER\b|inputCls/;
/** Controls with no focusable text surface, or that are never rendered visibly. */
const NOT_APPLICABLE = ['hidden', 'checkbox', 'radio', 'range', 'color', 'file'];

interface Control { file: string; lineNo: number; el: string; type: string; tag: string }

function everyControl(): Control[] {
  const files = globSync('src/**/*.tsx').filter((f) => !f.includes('__tests__'));
  const rows: Control[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (const el of ['input', 'select', 'textarea']) {
      for (const { tag, lineNo } of openTags(src, el)) {
        // A `<select>` written inside a JSDoc block is prose, not an element. Two of this repo's
        // apparent "bare selects" were exactly that.
        if (/^\s*\*/.test(lines[lineNo - 1] ?? '')) continue;
        const type = tag.match(/type=["']([a-z-]+)["']/)?.[1] ?? (el === 'input' ? 'text' : el);
        if (NOT_APPLICABLE.includes(type)) continue;
        rows.push({ file, lineNo, el, type, tag });
      }
    }
  }
  return rows;
}

describe('the matcher can say both yes and no (positive controls)', () => {
  it('FLAGS a control that kills the outline and replaces nothing', () => {
    const bad = '<input className="flex-1 bg-transparent outline-none" />';
    expect(KILLS_OUTLINE.test(bad)).toBe(true);
    expect(RESTORES_INDICATOR.test(bad)).toBe(false);
    expect(DELEGATES.test(bad)).toBe(false);
  });

  it('SPARES a control that replaces the outline with a ring', () => {
    const good = '<input className="outline-hidden focus:ring-1 focus:ring-ring" />';
    expect(RESTORES_INDICATOR.test(good)).toBe(true);
  });

  it('SPARES a control that delegates to the shared constant', () => {
    expect(DELEGATES.test('<input className={FIELD_INPUT_BARE} />')).toBe(true);
  });

  it('reads a tag whose handler contains `=>` - the trap that broke the first matcher', () => {
    const src = `<select value={v} onChange={e => setV(e.target.value)} className="themed">x</select>`;
    const [only] = openTags(src, 'select');
    expect(only.tag).toContain('className="themed"');
  });
});

describe('every form control in the app keeps a visible focus indicator', () => {
  const controls = everyControl();

  it('examined a NON-EMPTY inventory - a resolver that finds nothing reports a clean app', () => {
    // A floor, not the exact count: it tracks reality so it fails when the scan collapses, and it
    // is deliberately below today's number (136) so ordinary work does not turn it red.
    expect(controls.length).toBeGreaterThanOrEqual(100);
  });

  it('no control kills its outline and puts nothing back', () => {
    const blind = controls.filter(
      (c) => KILLS_OUTLINE.test(c.tag) && !RESTORES_INDICATOR.test(c.tag) && !DELEGATES.test(c.tag),
    );
    expect(
      blind.map((c) => `${c.file}:${c.lineNo} <${c.el} type=${c.type}>`),
      'these controls have NO visible focus state - a keyboard user tabbing in lands on an invisible cursor',
    ).toEqual([]);
  });
});
