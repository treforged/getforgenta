import { describe, it, expect } from 'vitest';
import { capPrePaydayRows, type PrePaydayCard } from '@/lib/pre-payday-cap';
import type { CardRecRow } from '@/lib/month0-debt-breakdown';

// Tre's account on 2026-10-03, read off /debt: Safe to Spend $82 until the 10-09 paycheck.
const NOW = new Date(2026, 9, 3, 12);

function row(p: Partial<CardRecRow> & Pick<CardRecRow, 'cardId' | 'payment'>): CardRecRow {
  return {
    cardName: p.cardId, color: '#888', maxPayment: p.payment, dueDay: null, pastDue: false,
    nextPayment: p.payment, nextPayMonth: 0, nextDueDate: null, reason: '', isMinimumOnly: false,
    ...p,
  };
}

const prime = row({
  cardId: 'prime', payment: 1340.94, maxPayment: 1452, dueDay: 7,
  nextDueDate: new Date(2026, 9, 7), reason: 'Partial statement',
});
const robinhood = row({
  cardId: 'rh', payment: 334.26, dueDay: 12, nextDueDate: new Date(2026, 9, 12), reason: 'Statement balance',
});
const discover = row({
  cardId: 'disc', payment: 350, dueDay: 1, nextPayMonth: 1, nextPayment: 150,
  nextDueDate: new Date(2026, 10, 1), reason: 'Minimum payment',
});
const cards: PrePaydayCard[] = [
  { id: 'prime', minPayment: 773.05, balance: 5000, m0MinSettled: false },
  { id: 'rh', minPayment: 25, balance: 900, m0MinSettled: false },
  { id: 'disc', minPayment: 150, balance: 2000, m0MinSettled: true },
];
const sts = { amount: 82, payday: '2026-10-09' };

describe('capPrePaydayRows', () => {
  it('caps a payment due before payday at its minimum plus the cash left until payday', () => {
    const out = capPrePaydayRows([prime, robinhood, discover], cards, sts, NOW);
    const p = out.find(r => r.cardId === 'prime')!;
    expect(p.nextPayment).toBe(855.05);
    expect(p.afterPayday).toBe(485.89);
    // The ledger payment is untouched: the cap moves the date, not the month's total.
    expect(p.payment).toBe(1340.94);
  });

  it('leaves a payment due after payday alone', () => {
    const out = capPrePaydayRows([prime, robinhood, discover], cards, sts, NOW);
    const r = out.find(x => x.cardId === 'rh')!;
    expect(r.nextPayment).toBe(334.26);
    expect(r.afterPayday).toBeUndefined();
  });

  it('marks a settled card\'s leftover extra as optional after payday, not due this month', () => {
    const out = capPrePaydayRows([prime, robinhood, discover], cards, sts, NOW);
    const d = out.find(x => x.cardId === 'disc')!;
    expect(d.dueThisMonth).toBe(0);
    expect(d.afterPayday).toBe(350);
    expect(d.nextPayment).toBe(150);
  });

  it('shares the until-payday cash in due-date order', () => {
    const early = row({ cardId: 'a', payment: 300, nextDueDate: new Date(2026, 9, 5) });
    const late = row({ cardId: 'b', payment: 300, nextDueDate: new Date(2026, 9, 8) });
    const cs: PrePaydayCard[] = [
      { id: 'a', minPayment: 50, balance: 1000, m0MinSettled: false },
      { id: 'b', minPayment: 50, balance: 1000, m0MinSettled: false },
    ];
    const out = capPrePaydayRows([late, early], cs, { amount: 100, payday: '2026-10-09' }, NOW);
    expect(out.find(r => r.cardId === 'a')!.nextPayment).toBe(150);
    expect(out.find(r => r.cardId === 'b')!.nextPayment).toBe(50);
    expect(out.find(r => r.cardId === 'b')!.afterPayday).toBe(250);
  });

  it('changes nothing when the cash covers the payment', () => {
    const out = capPrePaydayRows([prime], cards, { amount: 5000, payday: '2026-10-09' }, NOW);
    expect(out[0].nextPayment).toBe(1340.94);
    expect(out[0].afterPayday).toBeUndefined();
  });

  it('changes nothing without a Safe to Spend figure', () => {
    const out = capPrePaydayRows([prime, discover], cards, null, NOW);
    expect(out[0]).toEqual(prime);
    expect(out[1]).toEqual(discover);
  });

  it('never cuts below the minimum, even with negative cash', () => {
    const out = capPrePaydayRows([prime], cards, { amount: -40, payday: '2026-10-09' }, NOW);
    expect(out[0].nextPayment).toBe(773.05);
  });
});
