import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * EVERY CHART LEGEND DRAWS ITS LABEL IN THE PAGE'S TEXT COLOUR.
 *
 * Recharts colours a legend's LABEL with the series colour by default, and that value is doing
 * two jobs with two different WCAG floors - 3:1 as a graphical line or bar, 4.5:1 as a caption.
 * A palette tuned to look right on a chart is routinely illegible as text.
 *
 * Measured: `/debt`'s legend label "Discover It" read **2.48:1** in light mode, the only string
 * in a 490-element sweep still failing AA. The same shape was found in DARK at 3.6:1 on
 * 2026-09-18, which is the tell that it is the MECHANISM rather than one unlucky colour - so it
 * gets a gate rather than a third fix.
 *
 * ⚠️ WHY THIS SOURCE GATE EXISTS WHEN A RENDERED ONE ALREADY PASSES. `check:light-contrast`
 * measures what is ON SCREEN on six routes, and it now reads 0 below AA. It cannot see a chart
 * on a route it does not walk, a chart behind a tab, or one added tomorrow. This asserts the
 * PATTERN at every call site, which is the half a rendered sweep structurally cannot cover.
 *
 * ⚠️ THE SUBJECT LIST IS DERIVED. Every `<Legend` in `src/` must carry a `formatter`, found by
 * sweeping the tree rather than by naming the four files that have one today - a hand-named list
 * is blind to the chart nobody adds to it, which is how the three bare legends survived in the
 * first place while `Forecast.tsx` had been doing it correctly all along.
 *
 * WHAT IT DOES NOT PROVE: that the formatter renders a legible colour (the rendered probes own
 * that), that the SERIES colours clear 3:1 as graphics in light mode - which is a separate and
 * still-unanswered question - or anything about a chart from another library.
 */

const REPO = join(__dirname, '..', '..', '..');
const SRC = join(REPO, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * ⚠️ THE TAG IS READ UP TO THE NEXT ELEMENT, NOT UP TO THE NEXT `>`.
 *
 * The obvious pattern - `<Legend\b[\s\S]*?\/?>` - is non-greedy, so it stops at the FIRST `>`
 * it meets. An arrow function inside a prop CONTAINS one: `onClick={e => toggle(e)}`. So the
 * matcher truncated mid-prop and reported `Forecast.tsx`'s two legends as bare when they were
 * the very files that had been doing it correctly all along. A false finding aimed at the one
 * correct implementation, which is the costliest shape a wrong matcher takes.
 *
 * These legends are self-closing and carry no children, so reading to the next `<` is both safe
 * and immune to arrows, braces and nesting.
 */
const LEGEND = /<Legend\b[^<]{0,600}/g;

type Hit = { file: string; line: number; tag: string };

const legends: Hit[] = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(REPO, file).replace(/\\/g, '/');
  for (const m of src.matchAll(LEGEND)) {
    legends.push({ file: rel, line: src.slice(0, m.index).split('\n').length, tag: m[0] });
  }
}

describe('chart legends - positive controls', () => {
  it('the sweep found the charts', () => {
    // Five today. A COUNT, so a legend that vanishes from the sweep is itself a failure rather
    // than a quietly smaller inventory that makes the assertion below vacuous.
    expect(legends.length).toBeGreaterThanOrEqual(5);
  });

  it('the matcher recognises both a formatted and a bare legend', () => {
    const bare = '<Legend wrapperStyle={{ fontSize: 10 }} />';
    const fmt = '<Legend formatter={legendLabel} wrapperStyle={{ fontSize: 10 }} />';
    expect(LEGEND.test(bare)).toBe(true);
    LEGEND.lastIndex = 0;
    expect(LEGEND.test(fmt)).toBe(true);
    LEGEND.lastIndex = 0;
    expect(/formatter=/.test(bare)).toBe(false);
    expect(/formatter=/.test(fmt)).toBe(true);
  });
});

describe('chart legends - the label is text, not a series colour', () => {
  it('every <Legend> sets a formatter', () => {
    const bare = legends
      .filter((h) => !/formatter=/.test(h.tag))
      .map((h) => `${h.file}:${h.line} - a legend label drawn in the series colour is TEXT at 4.5:1`);
    expect(bare).toEqual([]);
  });

  it('the shared helper draws in the page foreground token', () => {
    const helper = readFileSync(join(SRC, 'components/shared/chart-legend.tsx'), 'utf8');
    expect(helper).toContain('hsl(var(--foreground))');
  });
});
