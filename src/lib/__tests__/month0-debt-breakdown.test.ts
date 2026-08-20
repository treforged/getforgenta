import { describe, it, expect } from 'vitest';
import { buildMonth0DebtBreakdown, emptyMonth0DebtBreakdown } from '../month0-debt-breakdown';
import type { CardData } from '../credit-card-engine';
import type { Month0Result } from '../debt-model-types';

const card = (over: Partial<CardData> & { id: string; name: string }): CardData => ({
  balance: 1000,
  apr: 20,
  creditLimit: 5000,
  minPayment: 35,
  targetPayment: 0,
  monthlyNewPurchases: 0,
  monthlyRepayments: 0,
  color: '#123456',
  paymentPreference: null,
  autopayFullBalance: false,
  dueDay: 20,
  statementBalancePhase: false,
  statementBalance: null,
  ...over,
});

const month0 = (
  perCardAdjusted: Month0Result['perCardAdjusted'],
  safeToPayTotal = 1000,
): Month0Result => ({
  safeToPayTotal,
  maxCapacity: safeToPayTotal,
  holdback: 0,
  holdbackEvent: null,
  cyclingPayment: 0,
  revolvingPayment: safeToPayTotal,
  perCardAdjusted,
  m0SafeFloor: 0,
  carReserve: 0,
  carReserveEvent: null,
  carReserveHeld: 0,
  endCash: 0,
  vehicleInsurance: 0,
  mortgagePayment: 0,
  chain: {
    fundingBalance: 0, income: 0, expenses: 0, planExpenses: 0, goalContributions: 0, autoExtraReserve: 0,
    carSavedEarmark: 0, carSavedShortfall: 0, carReserve: 0,
    carLoanPayment: 0, vehicleInsurance: 0, mortgagePayment: 0, transfers: 0, oneTimeNet: 0,
    cashPreDebt: 0,
  },
});

// Fixed so the due-day-vs-cutoff comparisons don't drift with the calendar.
const NOW = new Date(2026, 7, 4); // 2026-08-04
const CUTOFF = '2026-08-04';

describe('buildMonth0DebtBreakdown', () => {
  it('reports each card exactly the payment month0 recommends', () => {
    const cards = [card({ id: 'a', name: 'Sapphire' }), card({ id: 'b', name: 'Discover' })];
    const result = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'a', name: 'Sapphire', payment: 6401, maxPayment: 6401 },
        { id: 'b', name: 'Discover', payment: 87, maxPayment: 200 },
      ], 6488),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });

    expect(result.recommendations.map(r => [r.cardName, r.payment])).toEqual([
      ['Sapphire', 6401],
      ['Discover', 87],
    ]);
    // The invariant Budget Control claims: total available equals month0.safeToPayTotal.
    expect(result.totalAvailableCash).toBe(6488);
    expect(result.totalRecommended).toBe(6488);
  });

  it('returns an empty breakdown when the projection has not resolved', () => {
    const result = buildMonth0DebtBreakdown({
      month0: null,
      simCards: [card({ id: 'a', name: 'Sapphire' })],
      debtStrategy: 'snowball',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result).toEqual(emptyMonth0DebtBreakdown('snowball'));
    expect(result.strategyLabel).toBe('Snowball');
  });

  it('returns an empty breakdown when there are no cards', () => {
    const result = buildMonth0DebtBreakdown({
      month0: month0([]),
      simCards: [],
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result).toEqual(emptyMonth0DebtBreakdown('avalanche'));
  });

  it('excludes minimums whose due date is already captured in the balance', () => {
    // Cutoff Aug 20 with the 3-day settlement lag ⇒ captured means due before Aug 17.
    const cards = [
      card({ id: 'past', name: 'Paid', dueDay: 1, minPayment: 50 }),
      card({ id: 'future', name: 'Due later', dueDay: 22, minPayment: 40 }),
    ];
    const result = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'past', name: 'Paid', payment: 0, maxPayment: 0 },
        { id: 'future', name: 'Due later', payment: 40, maxPayment: 40 },
      ]),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: '2026-08-20',
      now: new Date(2026, 7, 20),
    });
    expect(result.totalMinimumsDue).toBe(40);
  });

  // §1.1 cause C sweep: this display now shares `m0MinDueSettled` with the engine, so it inherits
  // the settlement lag. A minimum due Aug 1 against an Aug 4 sync has NOT provably cleared —
  // `balances.current` excludes pending debits — so it stays counted rather than silently
  // disappearing from the total the user is asked to cover.
  it('still counts a minimum due inside the settlement-lag window', () => {
    const cards = [
      card({ id: 'recent', name: 'Just due', dueDay: 1, minPayment: 50 }),
      card({ id: 'future', name: 'Due later', dueDay: 22, minPayment: 40 }),
    ];
    const result = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'recent', name: 'Just due', payment: 0, maxPayment: 0 },
        { id: 'future', name: 'Due later', payment: 40, maxPayment: 40 },
      ]),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.totalMinimumsDue).toBe(90);
  });

  it('caps a minimum at the balance and counts a card with no due day', () => {
    const cards = [card({ id: 'small', name: 'Nearly paid', balance: 12, minPayment: 35, dueDay: null })];
    const result = buildMonth0DebtBreakdown({
      month0: month0([{ id: 'small', name: 'Nearly paid', payment: 12, maxPayment: 12 }]),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.totalMinimumsDue).toBe(12);
  });

  it('labels autopay cards by payment preference and keeps them out of minimums', () => {
    const cards = [
      card({ id: 's', name: 'Statement card', autopayFullBalance: true, paymentPreference: 'statement', monthlyNewPurchases: 400 }),
      card({ id: 'f', name: 'Full card', autopayFullBalance: true, paymentPreference: 'full', monthlyNewPurchases: 250 }),
      card({ id: 'p', name: 'Plain autopay', autopayFullBalance: true, paymentPreference: null, monthlyNewPurchases: 100 }),
    ];
    const result = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 's', name: 'Statement card', payment: 400, maxPayment: 400 },
        { id: 'f', name: 'Full card', payment: 250, maxPayment: 250 },
        { id: 'p', name: 'Plain autopay', payment: 100, maxPayment: 100 },
      ]),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.recommendations.map(r => r.reason)).toEqual([
      'Statement balance', 'Full balance', 'Autopay Full Balance',
    ]);
    expect(result.totalMinimumsDue).toBe(0);
    expect(result.autopayTotal).toBe(750);
  });

  it('flags minimum-only payments and labels the rest by strategy', () => {
    const cards = [
      card({ id: 'min', name: 'Min only', minPayment: 35 }),
      card({ id: 'extra', name: 'Target', minPayment: 35 }),
    ];
    const avalanche = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'min', name: 'Min only', payment: 35, maxPayment: 35 },
        { id: 'extra', name: 'Target', payment: 500, maxPayment: 500 },
      ]),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(avalanche.recommendations.map(r => [r.reason, r.isMinimumOnly])).toEqual([
      ['Minimum payment', true],
      ['Avalanche priority', false],
    ]);

    const snowball = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'min', name: 'Min only', payment: 35, maxPayment: 35 },
        { id: 'extra', name: 'Target', payment: 500, maxPayment: 500 },
      ]),
      simCards: cards,
      debtStrategy: 'snowball',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(snowball.recommendations[1].reason).toBe('Snowball priority');
    expect(snowball.strategyLabel).toBe('Snowball');
  });

  it('warns only when available cash cannot cover the minimums', () => {
    const cards = [card({ id: 'a', name: 'Sapphire', minPayment: 200 })];
    const recs: Month0Result['perCardAdjusted'] = [{ id: 'a', name: 'Sapphire', payment: 200, maxPayment: 200 }];
    const covered = buildMonth0DebtBreakdown({
      month0: month0(recs, 200), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF, now: NOW,
    });
    const short = buildMonth0DebtBreakdown({
      month0: month0(recs, 150), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF, now: NOW,
    });
    expect(covered.cashWarning).toBe(false);
    expect(short.cashWarning).toBe(true);
  });

  it('falls back to a neutral color when the card is missing from simCards', () => {
    const result = buildMonth0DebtBreakdown({
      month0: month0([{ id: 'ghost', name: 'Ghost', payment: 10, maxPayment: 10 }]),
      simCards: [card({ id: 'other', name: 'Other' })],
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.recommendations[0]).toMatchObject({ color: '#888', dueDay: null });
  });
});

describe('buildMonth0DebtBreakdown — a card the user has not opened yet', () => {
  // The real leak: Venture X (card_start_date 2026-12-20) and Apple Card (2028-02-28) were
  // listed in "Recommended This Month" badged `priority` at $0. A card that does not exist
  // yet cannot receive a payment this month.
  it('does not recommend a payment on a card whose start date has not arrived', () => {
    const cards = [
      card({ id: 'a', name: 'Discover' }),
      card({ id: 'b', name: 'Venture X', balance: 0, minPayment: 0, startDate: '2026-12-20' }),
    ];
    const result = buildMonth0DebtBreakdown({
      month0: month0([
        { id: 'a', name: 'Discover', payment: 300, maxPayment: 300 },
        { id: 'b', name: 'Venture X', payment: 0, maxPayment: 0 },
      ], 300),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.recommendations.map(r => r.cardName)).toEqual(['Discover']);
  });

  it('recommends the same card once its start month has arrived', () => {
    const cards = [card({ id: 'b', name: 'Venture X', startDate: '2026-08-20' })];
    const result = buildMonth0DebtBreakdown({
      month0: month0([{ id: 'b', name: 'Venture X', payment: 120, maxPayment: 120 }], 120),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW, // same month as the start date — open
    });
    expect(result.recommendations.map(r => r.cardName)).toEqual(['Venture X']);
  });

  it('keeps an unopened card out of minimums due and the autopay total', () => {
    // Both would read $0 for a $0-balance card anyway; pinned so a future card that carries
    // a projected balance or projected purchases cannot leak in through a second door.
    const cards = [
      card({ id: 'b', name: 'Apple Card', balance: 900, minPayment: 40, startDate: '2028-02-28' }),
      card({ id: 'c', name: 'Future Cycler', balance: 0, autopayFullBalance: true, monthlyNewPurchases: 500, startDate: '2028-02-28' }),
    ];
    const result = buildMonth0DebtBreakdown({
      month0: month0([], 0),
      simCards: cards,
      debtStrategy: 'avalanche',
      syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(result.totalMinimumsDue).toBe(0);
    expect(result.autopayTotal).toBe(0);
  });
});
