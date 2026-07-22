import { describe, it, expect } from 'vitest';
import { buildResimOverrides, type ResimContext } from '../cardProjectionResim';
import {
  simulateVariablePayoff, buildPaymentLedger, PROJECTION_MONTHS,
  type CardData, type PaymentLedgerEntry,
} from '@/lib/credit-card-engine';

// Regression for the month-0 augmented-floor breach (handoff 2026-07-22).
//
// The forecast engine consumes the RESIM payment ledger, which buildResimOverrides rebuilds
// RAW from the sim on every convergence pass. The raw sim pays month 0 down to the BARE floor,
// overshooting the AUGMENTED floor (CC-min/car/insurance buffers) by ~$176 — so the current-month
// row landed below the floor even though the popup's floor-capped recommendation was correct.
//
// The fix threads the hook's floor-capped month-0 entry (perCardAdjustedFinal-derived) through
// ResimContext.month0PaymentLedger; buildResimOverrides swaps it into ledger index 0 while
// leaving months 1+ as the raw sim. These tests pin that contract without rendering the hook.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 20, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

describe('buildResimOverrides — month-0 floor-capped ledger override', () => {
  const a = makeCard({ id: 'a', name: 'Discover', balance: 9000, apr: 24 });
  const b = makeCard({ id: 'b', name: 'Prime', balance: 6000, apr: 18 });
  const cards = [a, b];
  // Real sim: funding $1,900, floor $2,700, income $2,800/mo — pays a sizeable (≠ $1,354) month-0.
  const sim = simulateVariablePayoff(
    cards, 1900, 2700, 'avalanche', 0, 0, PROJECTION_MONTHS,
    flatEvents(PROJECTION_MONTHS, 2800, 140),
  );
  const baseCtx: ResimContext = {
    cards,
    cardPurchasesPerMonth: Array.from({ length: PROJECTION_MONTHS }, () => ({} as { [id: string]: number })),
    now: new Date(),
    saveUpMonths: new Set<number>(),
    maxDebtPaymentByMonth: Array(PROJECTION_MONTHS).fill(Infinity),
  };

  it('swaps ledger[0] for the supplied floor-capped entry and leaves months 1+ raw', () => {
    const rawLedger = buildPaymentLedger(sim, cards);
    // Floor-capped month-0 entry, deliberately LOWER than the raw sim spend (the augmented-floor cap).
    const capped: PaymentLedgerEntry = {
      total: 1354, revolving: 1354, cycling: 0,
      perCard: [{ id: 'a', payment: 1354 }, { id: 'b', payment: 0 }],
    };
    // Precondition: the cap actually binds (otherwise the test wouldn't distinguish the fix).
    expect(Math.abs(capped.total - rawLedger[0].total)).toBeGreaterThan(1);

    const withOverride = buildResimOverrides(sim, { ...baseCtx, month0PaymentLedger: capped });
    expect(withOverride.paymentLedger[0]).toEqual(capped);
    for (let m = 1; m < PROJECTION_MONTHS; m++) {
      expect(withOverride.paymentLedger[m]).toEqual(rawLedger[m]);
    }
  });

  it('falls back to the raw sim ledger[0] when no override is supplied (backward-compatible)', () => {
    const rawLedger = buildPaymentLedger(sim, cards);
    const noOverride = buildResimOverrides(sim, baseCtx);
    expect(noOverride.paymentLedger[0]).toEqual(rawLedger[0]);
  });
});
