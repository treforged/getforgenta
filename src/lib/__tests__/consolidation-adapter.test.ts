import { describe, it, expect } from 'vitest';
import {
  consolidationCards,
  scheduledCardCharges,
  totalScheduledCharges,
  type ConsolidationAccountRow,
  type ConsolidationPlanRow,
} from '../consolidation-adapter';
import { solveMinimumPrincipal } from '../consolidation';

const ASOF = '2026-08-20';

/** Shaped like a PostgREST row: numerics as strings, every optional column present and nullable. */
function account(over: Partial<ConsolidationAccountRow> & { id: string; name: string }): ConsolidationAccountRow {
  return {
    account_type: 'credit_card',
    active: true,
    balance: 0,
    credit_limit: null,
    apr: null,
    min_payment: null,
    card_start_date: null,
    balance_tranches: null,
    ...over,
  };
}

function plan(over: Partial<ConsolidationPlanRow> & { id: string; name: string }): ConsolidationPlanRow {
  return {
    active: true,
    plan_type: 'monthly_charge',
    frequency: 'monthly',
    start_date: '2026-09-01',
    payment_amount: 100,
    total_payments: 4,
    payment_source: null,
    ...over,
  };
}

describe('consolidationCards', () => {
  it('keeps only active credit cards', () => {
    const rows = [
      account({ id: 'cc', name: 'Discover', balance: 100, credit_limit: 1000 }),
      account({ id: 'chk', name: 'Checking', account_type: 'checking', balance: 500 }),
      account({ id: 'old', name: 'Closed card', active: false, balance: 100, credit_limit: 1000 }),
    ];
    expect(consolidationCards(rows).map(c => c.id)).toEqual(['cc']);
  });

  it('coerces string numerics the way PostgREST delivers them', () => {
    const [card] = consolidationCards([
      account({
        id: 'cc',
        name: 'Visa',
        balance: '8396.90',
        credit_limit: '14400',
        apr: '27.49',
        min_payment: '210.50',
      }),
    ]);
    expect(card.balance).toBeCloseTo(8396.9, 2);
    expect(card.creditLimit).toBe(14400);
    expect(card.apr).toBeCloseTo(27.49, 2);
    expect(card.minPayment).toBeCloseTo(210.5, 2);
  });

  it('omits minPayment entirely when the column is null, rather than asserting a $0 minimum', () => {
    const [card] = consolidationCards([account({ id: 'cc', name: 'Visa', balance: 100, credit_limit: 1000 })]);
    expect(card.minPayment).toBeUndefined();
  });

  it('passes card_start_date through untouched so the engine decides what is open', () => {
    const cards = consolidationCards([
      account({ id: 'now', name: 'Discover', balance: 100, credit_limit: 1000 }),
      account({ id: 'later', name: 'Venture X', balance: 0, credit_limit: 10000, card_start_date: '2027-04-20' }),
    ]);
    expect(cards.find(c => c.id === 'now')!.startDate).toBeNull();
    expect(cards.find(c => c.id === 'later')!.startDate).toBe('2027-04-20');
  });

  it('parses balance_tranches and drops malformed ones', () => {
    const [card] = consolidationCards([
      account({
        id: 'cc',
        name: 'Discover',
        balance: 10422.03,
        credit_limit: 11000,
        apr: 16.6,
        balance_tranches: [
          { id: 't1', label: 'Promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' },
          { id: 't2', label: 'Broken', balance: 'not a number' },
        ],
      }),
    ]);
    expect(card.tranches).toHaveLength(1);
    expect(card.tranches![0].apr).toBeCloseTo(7.99, 2);
  });

  it('drops a card with neither balance nor limit, keeps one with a balance and no limit', () => {
    const cards = consolidationCards([
      account({ id: 'empty', name: 'Nothing', balance: 0, credit_limit: 0 }),
      account({ id: 'nolimit', name: 'Store card', balance: 400, credit_limit: null }),
    ]);
    expect(cards.map(c => c.id)).toEqual(['nolimit']);
  });
});

describe('scheduledCardCharges', () => {
  const cards = consolidationCards([
    account({ id: 'discover', name: 'Discover', balance: 10422.03, credit_limit: 11000, apr: 16.6 }),
  ]);

  it('EXCLUDES upfront plans — that money is already in the card balance', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Chase Plan It', plan_type: 'upfront', payment_source: 'discover' })],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([]);
  });

  it('includes monthly_charge plans pointed at a card', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Cold Air Intake', payment_source: 'discover', payment_amount: 98.97, total_payments: 4 })],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([
      { label: 'Cold Air Intake', cardId: 'discover', amountPerMonth: 98.97, monthsRemaining: 4, landsOnCard: true },
    ]);
  });

  it('accepts the account: prefix form of payment_source', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Exhaust', payment_source: 'account:discover' })],
      cards,
      { asOf: ASOF },
    );
    expect(charges.map(c => c.cardId)).toEqual(['discover']);
  });

  it('ignores plans pointed at cash, at an unknown account, or at nothing', () => {
    const charges = scheduledCardCharges(
      [
        plan({ id: 'p1', name: 'Repointed', payment_source: 'checking-account-id' }),
        plan({ id: 'p2', name: 'Unsourced', payment_source: null }),
      ],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([]);
  });

  it('ignores inactive plans', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Cancelled', active: false, payment_source: 'discover' })],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([]);
  });

  it('counts only instalments still to come — past ones are already in the balance', () => {
    const charges = scheduledCardCharges(
      [plan({
        id: 'p1',
        name: 'Half done',
        payment_source: 'discover',
        start_date: '2026-06-15',
        payment_amount: 50,
        // Jun 15, Jul 15, Aug 15, Sep 15, Oct 15. The first three are behind ASOF (2026-08-20) —
        // including Aug 15, which has already posted even though the month has not ended.
        total_payments: 5,
      })],
      cards,
      { asOf: ASOF },
    );
    expect(charges[0].monthsRemaining).toBe(2);
    expect(charges[0].amountPerMonth).toBeCloseTo(50, 2);
  });

  it('drops a plan whose instalments have all landed', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Finished', payment_source: 'discover', start_date: '2026-01-10', total_payments: 3 })],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([]);
  });

  it('converts a biweekly plan to months while preserving the remaining TOTAL exactly', () => {
    const charges = scheduledCardCharges(
      [plan({
        id: 'p1',
        name: 'Pay in 4',
        frequency: 'biweekly',
        payment_source: 'discover',
        start_date: '2026-09-01', // Sep 1, Sep 15, Sep 29, Oct 13
        payment_amount: 89.25,
        total_payments: 4,
      })],
      cards,
      { asOf: ASOF },
    );
    const [c] = charges;
    expect(c.monthsRemaining).toBe(2);
    expect(c.amountPerMonth * c.monthsRemaining).toBeCloseTo(89.25 * 4, 6);
  });

  it('marks a repointed plan landsOnCard:false so the sizing solver stops borrowing for it', () => {
    const plans = [plan({ id: 'p1', name: 'Pay in 4', payment_source: 'discover', payment_amount: 200, total_payments: 5 })];
    const onCard = scheduledCardCharges(plans, cards, { asOf: ASOF });
    const repointed = scheduledCardCharges(plans, cards, { asOf: ASOF, repointedPlanIds: ['p1'] });

    expect(onCard[0].landsOnCard).toBe(true);
    expect(repointed[0].landsOnCard).toBe(false);

    const size = (charges: typeof onCard) =>
      solveMinimumPrincipal({
        cards,
        charges,
        constraints: { requireInterestFree: true, holdThroughScheduledCharges: true },
        asOf: ASOF,
      }).principalRequired;

    // Repointing is free; borrowing to cover the same instalments is not.
    expect(size(onCard) - size(repointed)).toBeCloseTo(1000, 2);
  });

  it('rejects an unrecognised frequency instead of guessing at its cadence', () => {
    const charges = scheduledCardCharges(
      [plan({ id: 'p1', name: 'Quarterly', frequency: 'quarterly', payment_source: 'discover' })],
      cards,
      { asOf: ASOF },
    );
    expect(charges).toEqual([]);
  });
});

describe('totalScheduledCharges', () => {
  it('sums only what still lands on a card', () => {
    const total = totalScheduledCharges([
      { label: 'a', cardId: 'x', amountPerMonth: 100, monthsRemaining: 3 },
      { label: 'b', cardId: 'x', amountPerMonth: 50, monthsRemaining: 2, landsOnCard: false },
    ]);
    expect(total).toBeCloseTo(300, 2);
  });
});
