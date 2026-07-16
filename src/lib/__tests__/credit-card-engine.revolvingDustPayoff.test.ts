import { describe, it, expect } from 'vitest';
import { projectCardVariable, CardData, PROJECTION_MONTHS } from '../credit-card-engine';

// Q8 regression (2026-07-16): Prime Visa's card header showed TOTAL INTEREST $132,107 and
// "Interest-free: N/A" while the sim/engine numbers were sane (~$34 of real interest).
//
// Root cause: the sim left $0.04 of rounding dust on PV's revolving-balance series, so the
// strict `simRevBal === 0` cycling check never fired, and PV's installment balance (upfront
// payment plans) held it in the revolving display branch where the local inGrace payoff check
// also missed by cents of balance drift. payoffMonth stayed null, so past the 60-month sim
// window projectCardVariable's fallback walk paid only card.minPayment ($0, manual min) for the
// remaining ~300 months of its 360-month payoff-discovery loop — compounding 27.49% APR on a
// ~$148 cycling balance into the $132k phantom.
//
// Fix: payoffMonth is now also set from sim ground truth — the first month the sim's revolving
// balance drops below the sub-dollar dust threshold — mirroring the cycling branch's assignment.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('projectCardVariable — revolving dust must not defeat payoff detection (Q8)', () => {
  it('sets payoffMonth from sim ground truth when the revolving series bottoms out at sub-dollar dust, so the post-window walk cannot compound phantom interest', () => {
    // PV shape: statement preference, manual $0 minimum, high APR, installment balance still
    // owed (keeps the card in the revolving display branch), and a sim revolving series that
    // decays to $0.04 dust instead of exact 0.
    const card = makeCard({
      id: 'pv', name: 'Prime Visa', balance: 6000, apr: 27.49, creditLimit: 10000,
      minPayment: 0, targetPayment: 0, monthlyNewPurchases: 148,
      paymentPreference: 'statement', autopayFullBalance: false,
      installmentBalance: 5000, installmentMonthlyPayment: 400,
    });

    const N = PROJECTION_MONTHS;
    const payoffAt = 13; // 1-indexed projection month where revolving debt clears (to dust)
    const payments = Array.from({ length: N }, (_, i) => (i < payoffAt ? 500 : 148));
    // Revolving series decays to $0.04 dust — never exactly 0 (the real PV capture shape).
    const revBals = Array.from({ length: N }, (_, i) =>
      i < payoffAt - 1 ? 6000 - (i + 1) * 460 : 0.04);
    // True total balance stays positive (installments + cycling purchases still owed).
    const trueBals = Array.from({ length: N }, (_, i) => Math.max(148, 5600 - i * 450));
    const trueInterest = Array.from({ length: N }, (_, i) => (i < payoffAt - 1 ? 30 : 0));

    const proj = projectCardVariable(
      card, payments, N, true, undefined, revBals, undefined, undefined, trueBals, trueInterest,
    );

    // Ground truth says revolving debt cleared at payoffAt — payoffMonth must reflect it
    // (this is what the header's "Interest-free" label renders; it showed N/A live).
    expect(proj.payoffMonth).toBe(payoffAt);

    // totalInterest must be exactly the in-window interest the engine actually charged —
    // no post-window compounding tail (the $132k phantom was ~4000x the real figure).
    const inWindow = proj.months.reduce((s, m) => s + m.interest, 0);
    expect(proj.totalInterest).toBe(Math.round(inWindow));
    expect(proj.totalInterest).toBeLessThanOrEqual(Math.round(30 * (payoffAt - 1)) + 1);
  });

  it('does not fire an in-window payoff when the sim revolving series stays genuinely positive', () => {
    const card = makeCard({
      id: 'stuck', name: 'Stuck Card', balance: 5000, apr: 20,
      minPayment: 100, targetPayment: 100, monthlyNewPurchases: 0,
      paymentPreference: null, autopayFullBalance: false,
    });
    const N = PROJECTION_MONTHS;
    const payments = Array.from({ length: N }, () => 100);
    const revBals = Array.from({ length: N }, () => 4500); // never clears
    const trueBals = Array.from({ length: N }, () => 4500);
    const trueInterest = Array.from({ length: N }, () => 75);

    const proj = projectCardVariable(
      card, payments, N, true, undefined, revBals, undefined, undefined, trueBals, trueInterest,
    );
    // The dust threshold must not claim payoff while ground truth stays at $4,500. (A payoff
    // discovered far past the window — the fallback walk amortizing with min payments — is
    // pre-existing intended behavior and fine.)
    if (proj.payoffMonth !== null) expect(proj.payoffMonth).toBeGreaterThan(N);
  });
});
