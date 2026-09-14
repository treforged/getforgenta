// THE OUTLINED FILTER-PILL ROW HAS ONE IMPLEMENTATION, AND THIS COUNTS IT.
//
// Same rule as `one-switch.test.ts`, applied to the next control kind. Tre, 2026-09-13:
// "consider design of other apps when thinking about our design always. and consistency across
// tabs." The acceptance evidence for that is a COUNT, because nobody builds two of a control on
// purpose — they arrive one screen at a time, each reasonable alone.
//
// ⚠️ FIVE COPIES EXISTED AND TWO HAD ALREADY DRIFTED INTO DEFECTS, measured 2026-09-14:
// `Accounts.tsx` passed an EMPTY inactive class where every other row used
// `border-border text-muted-foreground`, so its unselected pills had no border and no muted text;
// and FOUR of the five announced nothing about which pill was selected, because only the
// `CreditCardEngine` year row carried `aria-pressed`.
//
// ⚠️ THE INVENTORY THAT FOUND THEM WAS ITSELF INCOMPLETE, and that is the reusable part. The first
// count searched for `as const).map(` and reported 11 instances in 7 files. That idiom is not the
// control — it is one way of writing one. It MISSED the accordion year row in `CreditCardEngine`
// (built the same way, found only by grepping the CLASS), and it COUNTED `DebtPayoff`, which maps
// over a tuple to render `card-forged` CARDS and is not a pill row at all. **A negative is bounded
// by what you searched, not by what exists.** So this gate matches the rendered SHAPE.
//
// WHAT IS DELIBERATELY NOT COVERED, so nobody forces it in later: the strategy and payment-mode
// rows in `CreditCardEngine` carry per-option ICONS and TOOLTIPS, and the joined FILLED groups
// (`pct|flat`, `upfront|monthly_charge`, MaintenanceFormModal's mode row) are a different control —
// a single block with a filled active segment, not separated outline pills. Folding either in
// would produce a component configured by flags instead of one that means something. They are
// their own counts and are recorded in the handoff.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).filter(f => !f.includes('__tests__'));

/**
 * The pill's own signature: a bordered control that turns `border-primary text-primary` when it is
 * the selected one. Built by concatenation so this file cannot match itself.
 */
const ACTIVE_PILL = new RegExp("border-primary text-" + "primary");
const PILL_BASE = /font-medium[\s\S]{0,80}?border\b/;

const CANONICAL = join(SRC, 'components', 'shared', 'SegmentedControl.tsx');

function classNames(body: string): string[] {
  return [...body.matchAll(/className=(?:\{`([\s\S]*?)`\}|"([^"]*)")/g)].map(m => m[1] ?? m[2] ?? '');
}

/** A file draws a pill row itself if one className carries both the base and the active state. */
function drawsAPill(body: string): boolean {
  return classNames(body).some(c => PILL_BASE.test(c) && ACTIVE_PILL.test(c));
}

/**
 * The two rows that legitimately still draw their own pills: both carry per-option icons and
 * tooltips. Listed as an ALLOWANCE with a reason rather than silently excluded — an inventory
 * defined by exclusion grows invisibly, so a new entry here has to be argued for.
 */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  [join('components', 'debt', 'CreditCardEngine.tsx'),
   'strategy + payment-mode rows carry per-option icons AND tooltips - a richer control'],
  [join('pages', 'Legal.tsx'),
   'router <Link> tabs, not buttons - navigation, and selection is the URL rather than state'],
  [join('components', 'forecast', 'ForecastAssumptionsPanel.tsx'),
   'a single icon toggle (bonusRecurring), not a mutually-exclusive row'],
];
const ALLOWED_PATHS = ALLOWED.map(([f]) => f);

describe('one outlined filter-pill row implementation', () => {
  it('examined a non-trivial number of components', () => {
    // Zero examined is "nothing was compared", never a pass.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('the canonical SegmentedControl draws a pill — the positive control', () => {
    // Without this, a broken pattern reports an empty offenders list and reads as clean. That is
    // exactly how the switch gate's first two matchers failed.
    expect(drawsAPill(readFileSync(CANONICAL, 'utf8'))).toBe(true);
  });

  it('⚠️ no OTHER file draws its own pill row, except the argued allowance', () => {
    const offenders = FILES
      .filter(f => f !== CANONICAL)
      .filter(f => drawsAPill(readFileSync(f, 'utf8')))
      .map(f => relative(SRC, f))
      .filter(f => !ALLOWED_PATHS.includes(f));

    expect(
      offenders,
      `${offenders.length} file(s) draw a filter pill by hand. Use <SegmentedControl>: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('the canonical control names its group and announces the selected pill', () => {
    const body = readFileSync(CANONICAL, 'utf8');
    // Four of the five copies announced neither, which is what made this worth consolidating.
    expect(body).toContain('aria-pressed');
    expect(body).toContain('aria-label');
    expect(body).toContain('type="button"');
  });
});
