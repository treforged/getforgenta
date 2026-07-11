// Regression guard for the unified sim+engine income model (session 2026-07-09).
//
// The Feb 2027 floor breach was caused by the credit-card sim computing DIFFERENT monthly income
// than the forecast engine: the sim omitted the tax-return estimator and computed the bonus off
// annual NET instead of annual GROSS, inflating its cash walk and oversizing the mandatory cycling
// pool in a tax-owed month. The fix routed BOTH models through this one pure function, so income
// parity is now guaranteed by construction — there is no second implementation to diverge.
//
// These tests pin that function's contract so a future edit can't silently reopen the divergence:
//   1. % bonus is a share of annual GROSS (not net).
//   2. The tax-return injection can be NEGATIVE (amount owed) — the exact Feb-breach condition.
//   3. Both components are zero outside their configured month.
//   4. A non-recurring bonus fires only on its first occurrence.

import { describe, it, expect } from 'vitest';
import { computeBonusAndTax, type BonusTaxAssumptions } from '@/lib/income-model';

const baseAssumptions = (over: Partial<BonusTaxAssumptions> = {}): BonusTaxAssumptions => ({
  bonusEnabled: true,
  bonusAmount: 5, // 5%
  bonusMode: 'pct',
  bonusMonth: 2, // February
  bonusRecurring: true,
  taxReturnEnabled: true,
  taxReturnMonth: 2, // February
  taxReturnFilingStatus: 'single',
  taxReturnDependents: 0,
  taxReturnState: 'FL',
  ...over,
});

const feb = new Date(2027, 1, 1); // month index 1 = February
const jun = new Date(2027, 5, 1);

describe('computeBonusAndTax — unified income invariants', () => {
  it('computes a % bonus off annual GROSS, not net', () => {
    const { bonusIncome } = computeBonusAndTax({
      annualGrossHere: 100_000,
      monthDate: feb,
      assumptions: baseAssumptions({ taxReturnEnabled: false }),
      isFirstBonusOccurrence: true,
      annualFederalWithheldFromBudget: 0,
    });
    // 5% of the GROSS 100k — never a share of a smaller net figure.
    expect(bonusIncome).toBe(5_000);
  });

  it('honors a flat bonus amount verbatim', () => {
    const { bonusIncome } = computeBonusAndTax({
      annualGrossHere: 100_000,
      monthDate: feb,
      assumptions: baseAssumptions({ bonusMode: 'flat', bonusAmount: 2170, taxReturnEnabled: false }),
      isFirstBonusOccurrence: true,
      annualFederalWithheldFromBudget: 0,
    });
    expect(bonusIncome).toBe(2170);
  });

  it('passes a tax-return OVERRIDE through unchanged in the tax month', () => {
    const { taxReturnIncome } = computeBonusAndTax({
      annualGrossHere: 100_000,
      monthDate: feb,
      assumptions: baseAssumptions({ bonusEnabled: false, taxReturnAmountOverride: 1500 }),
      isFirstBonusOccurrence: true,
      annualFederalWithheldFromBudget: 0,
    });
    expect(taxReturnIncome).toBe(1500);
  });

  it('lets the estimated tax-return go NEGATIVE (amount owed) — the Feb-breach condition', () => {
    // High gross with essentially no federal withholding forces an amount OWED (negative refund).
    // Assert the sign, not a brittle exact figure, so this survives estimator retuning.
    const { taxReturnIncome } = computeBonusAndTax({
      annualGrossHere: 150_000,
      monthDate: feb,
      assumptions: baseAssumptions({ bonusEnabled: false, taxReturnFederalWithheld: 1 }),
      isFirstBonusOccurrence: true,
      annualFederalWithheldFromBudget: 0,
    });
    expect(taxReturnIncome).toBeLessThan(0);
  });

  it('emits zero bonus and zero tax-return outside their configured month', () => {
    const { bonusIncome, taxReturnIncome } = computeBonusAndTax({
      annualGrossHere: 100_000,
      monthDate: jun,
      assumptions: baseAssumptions(),
      isFirstBonusOccurrence: true,
      annualFederalWithheldFromBudget: 0,
    });
    expect(bonusIncome).toBe(0);
    expect(taxReturnIncome).toBe(0);
  });

  it('fires a non-recurring bonus only on its first occurrence', () => {
    const assumptions = baseAssumptions({ bonusRecurring: false, taxReturnEnabled: false });
    const first = computeBonusAndTax({
      annualGrossHere: 100_000, monthDate: feb, assumptions,
      isFirstBonusOccurrence: true, annualFederalWithheldFromBudget: 0,
    });
    const later = computeBonusAndTax({
      annualGrossHere: 100_000, monthDate: feb, assumptions,
      isFirstBonusOccurrence: false, annualFederalWithheldFromBudget: 0,
    });
    expect(first.bonusIncome).toBe(5_000);
    expect(later.bonusIncome).toBe(0);
  });
});
