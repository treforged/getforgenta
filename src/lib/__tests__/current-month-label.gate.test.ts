/**
 * A CURRENT-MONTH FIGURE MUST NEVER BE LABELLED "/mo".
 *
 * Tre, 2026-09-18: "if something is set to like biweekly or monthly or with like a different
 * interval, it shouldn't say the amount per month, that line would be incorrect."
 *
 * ⚠️ THE NUMBERS WERE RIGHT AND THE LABEL WAS WRONG, which is why this gate reads LABELS and
 * asserts nothing about arithmetic. `budgetMonthTotals` is called with `toCurrentMonthAmount`, so
 * every total on that page — and the per-row figure — is WHAT FALLS IN THE CURRENT CALENDAR MONTH.
 * That coincides with a monthly equivalent for a monthly rule and diverges for every other
 * interval, so the old label was silently true for some rows and false for others: his Supplements
 * row (every other month, starts October) read `/mo $0`, and his biweekly Fuel read `/mo $65`
 * against a ~$141 monthly equivalent.
 *
 * ⚠️ IT DOES NOT BAN THE STRING, AND THAT IS THE WHOLE DESIGN. One line on that page computes a
 * GENUINE monthly equivalent (a goal contribution, `flatAmt * periodsPerYear / 12`) and is right to
 * say `/mo`. A gate that simply forbade "/mo" would have gone red on honest code and been switched
 * off — so it is scoped to lines that render a current-month quantity, and it ASSERTS the honest
 * line still says `/mo` so that scoping is proven rather than claimed.
 *
 * STATED LIMIT: this is a SOURCE scan. It cannot see a rendered frame, cannot see spacing or
 * wrapping, and says nothing about whether the arithmetic is right — only about what the figure is
 * CALLED. A label added via a variable this scan cannot resolve would pass.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_MONTH_LABEL } from '@/lib/budget-month-totals';

const FILE = path.resolve(__dirname, '../../pages/BudgetControl.tsx');
const SRC = fs.readFileSync(FILE, 'utf8');
const LINES = SRC.split('\n');

/** Identifiers that ARE a current-month figure, derived from what `budgetMonthTotals` returns. */
const CURRENT_MONTH_FIGURES = [
  'toCurrentMonthAmount',
  'totalRecurringIncome', 'totalVariableExpenses', 'totalDebtPayments', 'totalTransfers',
  'Math.abs(remaining)',
];

const renderedLines = LINES
  .map((text, i) => ({ text, n: i + 1 }))
  .filter(l => CURRENT_MONTH_FIGURES.some(f => l.text.includes(f)) && l.text.includes('formatCurrency'));

describe('the /mo label never sits on a current-month figure', () => {
  /**
   * ⚠️ POSITIVE CONTROL ON THE EXTRACTION, not on the assertion. A slice that matched nothing would
   * make every assertion below vacuously true and print clean — the "a gate that extracts before it
   * asserts needs a control on the EXTRACTION" case.
   */
  it('CONTROL: the scan actually finds the figures', () => {
    expect(renderedLines.length).toBeGreaterThanOrEqual(6);
  });

  it('CONTROL: it finds the per-row figure specifically', () => {
    expect(renderedLines.some(l => l.text.includes('toCurrentMonthAmount(r)'))).toBe(true);
  });

  it('none of them is labelled /mo', () => {
    const offenders = renderedLines.filter(l => l.text.includes('/mo'));
    expect(offenders.map(l => `${l.n}: ${l.text.trim()}`)).toEqual([]);
  });

  it('they carry the shared label instead', () => {
    const unlabelled = renderedLines.filter(l => !l.text.includes('CURRENT_MONTH_LABEL'));
    expect(unlabelled.map(l => `${l.n}: ${l.text.trim()}`)).toEqual([]);
  });

  /**
   * ⚠️ THE DISCRIMINATING CONTROL. Proves the gate is scoped to the QUANTITY rather than to the
   * string — a genuine monthly equivalent may and should still say "/mo".
   */
  it('CONTROL: a true monthly equivalent still says /mo', () => {
    expect(SRC).toMatch(/\/ 12 \* 100\) \/ 100, false\)\}\/mo/);
  });

  it('the shared label is the one the page imports', () => {
    expect(CURRENT_MONTH_LABEL).toBe('this month');
    // Matched loosely on purpose: the import also carries `isFixedRule`, and pinning the exact
    // member order would make this go red on an unrelated tidy-up.
    expect(SRC).toMatch(/import \{[^}]*CURRENT_MONTH_LABEL[^}]*\} from '@\/lib\/budget-month-totals';/);
  });
});
