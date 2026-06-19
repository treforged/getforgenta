import { describe, it, expect } from 'vitest';
import { projectCardVariable, CardData } from '../credit-card-engine';

// Regression test for the bug where a revolving (non-cycling) card's displayed balance jumped
// with "no evidence" between two months (e.g. Prime Visa Dec→Jan: end $4,092 but next month's
// start was $892). Root cause: projectCardVariable's revolving branch recomputed its OWN local
// balance walk using a simplified flat-APR interest estimate, instead of reading
// simulateVariablePayoff's actual Step 3-6 cascade output (monthlyBalances) — the two could
// silently drift apart over several months and then "snap back" once a later row (e.g. a
// cycling transition) switched to ground truth, producing an unexplained jump.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('projectCardVariable — ground-truth revolving balance', () => {
  it('uses the engine-provided true end balance instead of its own flat-APR walk, so every row reconciles exactly to ground truth', () => {
    const card = makeCard({
      id: 'cardR', name: 'Card R', balance: 1000, apr: 24, monthlyNewPurchases: 200,
      minPayment: 50, paymentPreference: null, autopayFullBalance: false,
    });

    // Payments the engine actually made (e.g. shaped by another card's avalanche priority in a
    // shared pool) and the engine's true end-of-month balances. Picked so they do NOT match what
    // the old flat-APR walk would compute on its own, proving the row now follows ground truth.
    const monthlyPayments = [300, 250, 1200];
    const trueBalanceByMonth = [950, 980, 0];

    const proj = projectCardVariable(
      card, monthlyPayments, 3, false, undefined, undefined, undefined, undefined,
      trueBalanceByMonth,
    );

    // Row 1: endBalance must be exactly the ground truth, with interest solved so
    // start + purchases + interest - payment reconciles to it (1000+200+50-300=950).
    expect(proj.months[0].endBalance).toBeCloseTo(950, 2);
    expect(proj.months[0].interest).toBeCloseTo(50, 2);

    // Row 2 starts exactly where row 1 ended (continuity — no unexplained jump) and again
    // matches ground truth (950+200+80-250=980).
    expect(proj.months[1].startBalance).toBeCloseTo(950, 2);
    expect(proj.months[1].endBalance).toBeCloseTo(980, 2);
    expect(proj.months[1].interest).toBeCloseTo(80, 2);

    // Row 3: a big payment per ground truth pays the card off (980+200+20-1200=0).
    expect(proj.months[2].startBalance).toBeCloseTo(980, 2);
    expect(proj.months[2].endBalance).toBeCloseTo(0, 2);
    expect(proj.payoffMonth).toBe(3);
  });

  it('uses the engine-provided true interest instead of back-solving it, when the displayed payment is scaled away from the payment that produced the true balance', () => {
    // Mirrors a real bug: CreditCardEngine.tsx's "Forecast Sim" mode displays a cash-floor-scaled
    // payment (PASS-3) that can be much smaller than the engine's own natural payment, while
    // monthlyBalances reflects the trajectory produced by the NATURAL (unscaled) payment. Back-
    // solving interest from (trueEndBal - startBal - purchases + DISPLAYED payment) in that case
    // produces a nonsensical, often deeply negative figure that silently vanishes from the UI —
    // exactly what "Oct/Nov/Dec show no interest charges" turned out to be.
    const card = makeCard({
      id: 'cardP', name: 'Prime Visa', balance: 1221.98, apr: 27.49, monthlyNewPurchases: 777,
      minPayment: 50, paymentPreference: null, autopayFullBalance: false,
    });

    const scaledPayment = [607]; // displayed — far less than the engine's own natural payment
    const trueBalanceByMonth = [936.41]; // produced by the engine's actual (larger, unscaled) payment
    const trueInterestByMonth = [27.99]; // the real Step-3 interest the engine charged this cycle

    const proj = projectCardVariable(
      card, scaledPayment, 1, false, undefined, undefined, undefined, undefined,
      trueBalanceByMonth, trueInterestByMonth,
    );

    // Interest must come from the engine's real figure, not a back-solved value (which would be
    // 936.41 - 1221.98 - 777 + 607 = -455 — exactly the kind of figure the old code hid).
    expect(proj.months[0].interest).toBeCloseTo(27.99, 2);
    // endBalance still trusts ground truth directly, and payment still shows what's displayed.
    expect(proj.months[0].endBalance).toBeCloseTo(936.41, 2);
    expect(proj.months[0].payment).toBeCloseTo(607, 2);
  });

  it('falls back to the local flat-APR walk when no ground truth is provided (hypothetical payment schedules)', () => {
    const card = makeCard({
      id: 'cardH', name: 'Card H', balance: 1000, apr: 24, monthlyNewPurchases: 0,
      minPayment: 50, paymentPreference: null, autopayFullBalance: false,
    });
    const monthlyPayments = [300, 300, 300];

    // No trueBalanceByMonth argument — this is the path used by callers projecting a
    // hypothetical schedule that never went through simulateVariablePayoff (payment overrides,
    // minimum-only comparisons), which have no ground truth to read by definition.
    const proj = projectCardVariable(card, monthlyPayments, 3, false);

    // Old behavior preserved exactly: interest = APR/12 * startBalance.
    // Row 1: interest = 1000 * 0.02 = 20; end = 1000 + 0 + 20 - 300 = 720.
    expect(proj.months[0].interest).toBeCloseTo(20, 2);
    expect(proj.months[0].endBalance).toBeCloseTo(720, 2);
  });
});
