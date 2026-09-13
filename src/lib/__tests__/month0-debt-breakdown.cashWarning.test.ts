import { describe, it, expect } from 'vitest';
import { buildMonth0DebtBreakdown } from '../month0-debt-breakdown';
import type { CardData } from '../credit-card-engine';
import type { Month0Result } from '../debt-model-types';

/**
 * AIMED AT THE WIRING, NOT THE HELPER — and that distinction is not academic here.
 *
 * `cash-warning-message.test.ts` covers `cashWarningMessage` itself and is green. Disabling the
 * CALL SITE — passing `[]` where the rows' shortfalls belong, which is exactly the pre-fix
 * blindness — left **all 3,180 lib tests passing**. A test of a helper is not a test of the caller
 * that forgot to feed it, and the defect lived entirely in the feeding.
 *
 * The browser found the original; this is what would have.
 */

const card = (over: Partial<CardData> & { id: string }): CardData => ({
  name: over.id, balance: 0, minPayment: 0, apr: 0, color: '#000',
  monthlyNewPurchases: 0, dueDay: 15, autopayFullBalance: false, ...over,
} as CardData);

function month0(perCardAdjusted: Month0Result['perCardAdjusted']): Month0Result {
  return {
    perCardAdjusted, safeToPayTotal: 7991, cyclingPayment: 0, revolvingPayment: 0,
    holdback: 0, holdbackEvent: null, m0SafeFloor: 0,
  } as unknown as Month0Result;
}

const build = (perCardAdjusted: Month0Result['perCardAdjusted']) => buildMonth0DebtBreakdown({
  month0: month0(perCardAdjusted),
  simCards: [card({ id: 'c1', name: 'Prime Visa', balance: 7991, minPayment: 0 })],
  debtStrategy: 'avalanche',
  syncCutoffDate: '2026-09-01',
  now: new Date('2026-09-13T12:00:00'),
});

describe('buildMonth0DebtBreakdown — a shortfall on a row IS a cash warning', () => {
  it('RAISES the warning when a row carries a shortfall, minimums fully covered', () => {
    // The measured browser case: Safe to Pay $7,991 against $2,526 of liquid cash, minimums $0,
    // and the old predicate (`cash − minimums < 0`) came out large and POSITIVE.
    const b = build([{ id: 'c1', name: 'Prime Visa', payment: 7991, maxPayment: 7991, unconditionalShortfall: 7991 }]);
    expect(b.totalMinimumsDue).toBe(0);
    expect(b.cashWarning).toBe(true);
    expect(b.cashWarningText).toMatch(/always pay in full/i);
  });

  it('stays SILENT on the identical row with no shortfall — the discriminating pair', () => {
    // Same cash, same minimums, same payment. Only the shortfall differs, so the assertion above
    // measures the shortfall rather than the fixture.
    const b = build([{ id: 'c1', name: 'Prime Visa', payment: 7991, maxPayment: 7991 }]);
    expect(b.cashWarning).toBe(false);
    expect(b.cashWarningText).toBeNull();
  });

  it('carries the TEXT, not just the boolean — a banner with no sentence shows nothing', () => {
    const b = build([{ id: 'c1', name: 'Prime Visa', payment: 7991, maxPayment: 7991, unconditionalShortfall: 7991 }]);
    expect(typeof b.cashWarningText).toBe('string');
    expect(b.cashWarningText).toContain('$7,991');
  });

  it('a zero shortfall is not a warning', () => {
    const b = build([{ id: 'c1', name: 'Prime Visa', payment: 7991, maxPayment: 7991, unconditionalShortfall: 0 }]);
    expect(b.cashWarning).toBe(false);
  });
});
