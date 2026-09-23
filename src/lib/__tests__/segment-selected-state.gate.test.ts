// EVERY SEGMENT IN A PANEL BAR SAYS WHICH ONE IS SELECTED, TO A SCREEN READER AS WELL AS TO THE EYE.
//
// THE DEFECT. `PanelBar` renders `role="tablist"`. Account's section bar gives each segment
// `role="tab"` and `aria-selected`; nine segments in Settings, Dashboard, Accounts, Debt Payoff and
// the Garage did not. They were plain buttons whose only selected state was the `seg-item-active`
// COLOUR, so assistive tech heard a tab list with no tabs and no current section.
// Found 2026-09-23 by walk-press-every-control.mjs: pressing Settings > Security changed the pane,
// and nothing about the control itself said so.
//
// ⚠️ DISCOVERY IS BY THE SHAPE (`seg-item` in the class), NEVER BY `aria-selected`. Finding
// candidates by the correctness marker would search only among the already-correct.
//
// WHAT THIS DOES NOT CATCH: whether the value is RIGHT (only that it is declared), segments built
// without the `seg-item` class, and keyboard arrow-key navigation between tabs.

import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/** A JSX open tag, tracking brace and quote depth so a `>` in `onClick={() => ...}` cannot end it. */
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

interface Segment { file: string; lineNo: number; tag: string }

function everySegment(): Segment[] {
  const rows: Segment[] = [];
  for (const file of globSync('src/**/*.tsx').filter((f) => !f.includes('__tests__'))) {
    const src = readFileSync(file, 'utf8');
    for (const { tag, lineNo } of openTags(src, 'button')) {
      if (/\bseg-item\b/.test(tag)) rows.push({ file: file.replace(/\\/g, '/'), lineNo, tag });
    }
  }
  return rows;
}

describe('segment selected state', () => {
  const segments = everySegment();

  it('finds segments at all, including Account\'s known-correct ones (control on the instrument)', () => {
    expect(segments.length).toBeGreaterThan(9);
    expect(segments.filter((s) => s.file.endsWith('pages/Account.tsx')).length).toBeGreaterThan(0);
  });

  it('every seg-item button declares role="tab" and aria-selected', () => {
    const missing = segments
      .filter((s) => !/role="tab"/.test(s.tag) || !/aria-selected=/.test(s.tag))
      .map((s) => `${s.file}:${s.lineNo}`);
    expect(missing).toEqual([]);
  });
});
