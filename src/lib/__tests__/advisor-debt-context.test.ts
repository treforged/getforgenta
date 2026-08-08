// Stage 6 — the AI Advisor must quote the debt engine, never its own estimate.
//
// The regression this guards is customer-visible: the advisor previously ran a closed-form
// amortization per `debts` row. On Tre's live data that told the model Discover would NEVER
// pay off, because its $52 target payment sits below the $60.65/mo interest accrual — while
// the app itself showed a real payoff date on screen. An advisor that contradicts the page
// it is embedded in is worse than one that stays quiet.

import { describe, it, expect } from 'vitest';
import { buildAdvisorDebtContext, payoffMonthsFromNow } from '@/lib/advisor-debt-context';
import { firstRevolvingPayoffMonth } from '@/lib/revolving-payoff';

/** Card whose revolving balance clears at a chosen 0-based month index. */
const cardClearingAt = (id: string, name: string, clearIdx: number, months = 12) => ({
  id,
  name,
  balances: Array.from({ length: months }, (_, m) => (m < clearIdx ? 1000 : 0)),
});

const projectionOf = (cards: ReturnType<typeof cardClearingAt>[]) => ({
  perCardPayments: cards.map(c => ({ name: c.name, id: c.id })),
  monthlyRevolvingBalances: new Map(cards.map(c => [c.id, c.balances])),
});

describe('payoffMonthsFromNow', () => {
  it('treats engine month 1 as "this month" (0 months away), not one month out', () => {
    // Off-by-one here would shift every date the advisor quotes against the rest of the app.
    expect(payoffMonthsFromNow(1)).toBe(0);
    expect(payoffMonthsFromNow(2)).toBe(1);
    expect(payoffMonthsFromNow(13)).toBe(12);
  });

  it('passes null through — no payoff month means no claim', () => {
    expect(payoffMonthsFromNow(null)).toBeNull();
  });

  it('never returns a negative month', () => {
    expect(payoffMonthsFromNow(0)).toBe(0);
  });
});

describe('buildAdvisorDebtContext — engine is the source of truth', () => {
  it('quotes exactly what the engine helper returns for each card', () => {
    const cards = [cardClearingAt('a', 'Prime Visa', 4), cardClearingAt('b', 'Discover', 7)];
    const proj = projectionOf(cards);

    const { debtDetails } = buildAdvisorDebtContext({
      cardProjection: proj, accounts: [], debts: [], months: 12,
    });

    // Assert against the helper itself, so this cannot drift from the engine's own answer.
    for (const c of cards) {
      const expected = payoffMonthsFromNow(
        firstRevolvingPayoffMonth(proj.monthlyRevolvingBalances, [c.id], 12),
      );
      const row = debtDetails.find(d => d.name === c.name);
      expect(row?.payoffMonthsFromNow).toBe(expected);
      expect(row?.source).toBe('engine');
    }
  });

  it('reports the overall debt-free month from ALL cards, not the first to clear', () => {
    // The cascade means the portfolio is only clear when the LAST card clears.
    const proj = projectionOf([
      cardClearingAt('a', 'Prime Visa', 3),
      cardClearingAt('b', 'Discover', 9),
    ]);

    const { creditCardDebtFreeMonthsFromNow } = buildAdvisorDebtContext({
      cardProjection: proj, accounts: [], debts: [], months: 12,
    });

    expect(creditCardDebtFreeMonthsFromNow).toBe(payoffMonthsFromNow(10)); // clears at idx 9
  });

  it('pulls balance/APR from accounts and target payment from the debts row', () => {
    const proj = projectionOf([cardClearingAt('a', 'Prime Visa', 2)]);

    const { debtDetails } = buildAdvisorDebtContext({
      cardProjection: proj,
      accounts: [{ name: 'Prime Visa', balance: 5037.73, apr: 27.49, min_payment: 231.15 }],
      debts: [{ name: 'prime visa', target_payment: 500 }], // case-insensitive match
      months: 12,
    });

    expect(debtDetails).toHaveLength(1); // matched, so NOT duplicated as user_entered
    expect(debtDetails[0]).toMatchObject({
      name: 'Prime Visa', balance: 5037.73, apr: 27.49, minPayment: 231.15, targetPayment: 500,
    });
  });
});

describe('buildAdvisorDebtContext — debts the engine does not model', () => {
  it('keeps user-entered rows but refuses to give them a payoff figure', () => {
    // The exact live shape that used to produce "never pays off": target below interest.
    const { debtDetails } = buildAdvisorDebtContext({
      cardProjection: projectionOf([cardClearingAt('a', 'Prime Visa', 2)]),
      accounts: [],
      debts: [{ name: 'Personal Loan from Dad', balance: 3734.71, apr: 19.49, target_payment: 52 }],
      months: 12,
    });

    const row = debtDetails.find(d => d.name === 'Personal Loan from Dad');
    expect(row).toBeDefined();               // nothing the user typed is lost
    expect(row?.source).toBe('user_entered');
    expect(row?.payoffMonthsFromNow).toBeNull(); // and no fabricated timeline
  });

  it('emits no engine rows and no debt-free date when the projection is unavailable', () => {
    const { debtDetails, creditCardDebtFreeMonthsFromNow } = buildAdvisorDebtContext({
      cardProjection: null,
      accounts: [],
      debts: [{ name: 'Discover', balance: 100, apr: 19.49 }],
    });

    expect(creditCardDebtFreeMonthsFromNow).toBeNull();
    expect(debtDetails).toHaveLength(1);
    expect(debtDetails[0].source).toBe('user_entered');
    expect(debtDetails[0].payoffMonthsFromNow).toBeNull();
  });

  it('returns null rather than a number when no card ever clears in the window', () => {
    const proj = projectionOf([cardClearingAt('a', 'Prime Visa', 99)]); // never clears
    const { debtDetails, creditCardDebtFreeMonthsFromNow } = buildAdvisorDebtContext({
      cardProjection: proj, accounts: [], debts: [], months: 12,
    });

    expect(debtDetails[0].payoffMonthsFromNow).toBeNull();
    expect(creditCardDebtFreeMonthsFromNow).toBeNull();
  });

  it('never fabricates a payoff for a debt whose payment cannot cover its interest', () => {
    // Guards the specific defect: the old closed-form guard fell through to null for
    // Discover, but the shape it protected against must never come back as a number.
    const { debtDetails } = buildAdvisorDebtContext({
      cardProjection: null,
      accounts: [],
      debts: [{ name: 'Discover it Card', balance: 3734.71, apr: 19.49, min_payment: 83, target_payment: 52 }],
    });

    expect(debtDetails.every(d => d.payoffMonthsFromNow === null)).toBe(true);
  });
});
