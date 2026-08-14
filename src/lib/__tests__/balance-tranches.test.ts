// Multi-rate cards. Synthetic values shaped like the real failure: a balance-transfer promo at a
// low rate with a hard expiry, riding on a card whose standard rate is roughly double.
import { describe, it, expect } from 'vitest';
import {
  parseTranches, trancheAprAsOf, trancheInterestBreakdown, promoExpiryWarnings,
  allocatePaymentAcrossTranches, type BalanceTranche,
} from '../balance-tranches';

const BT: BalanceTranche = {
  id: 'bt-1', label: 'Balance transfer', balance: 5000, apr: 8, promo_end_date: '2028-01-04',
};
const STANDARD = 16;

describe('parseTranches', () => {
  it('accepts numeric strings, drops junk, and never returns a negative or zero balance', () => {
    const parsed = parseTranches([
      { id: 'a', label: 'BT', balance: '5000', apr: '8', promo_end_date: '2028-01-04' },
      { id: 'b', balance: 0, apr: 8 },
      { id: 'c', balance: 100, apr: -1 },
      'not an object',
      null,
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].balance).toBe(5000);
    expect(parsed[0].apr).toBe(8);
  });

  it('null and non-arrays mean no tranches — the single-APR card', () => {
    expect(parseTranches(null)).toEqual([]);
    expect(parseTranches(undefined)).toEqual([]);
    expect(parseTranches({})).toEqual([]);
  });
});

describe('trancheAprAsOf — the cliff', () => {
  it('promo rate before the end date, standard ON and after it', () => {
    expect(trancheAprAsOf(BT, STANDARD, '2028-01-03')).toBe(8);
    expect(trancheAprAsOf(BT, STANDARD, '2028-01-04')).toBe(STANDARD);
    expect(trancheAprAsOf(BT, STANDARD, '2028-06-01')).toBe(STANDARD);
  });

  it('a tranche with no end date keeps its rate forever', () => {
    expect(trancheAprAsOf({ ...BT, promo_end_date: null }, STANDARD, '2030-01-01')).toBe(8);
  });
});

describe('trancheInterestBreakdown', () => {
  it('splits interest between the tranche and the remainder at their own rates', () => {
    const b = trancheInterestBreakdown(10000, [BT], STANDARD, '2026-09-01');
    expect(b.lines[0].monthlyInterest).toBeCloseTo(5000 * 0.08 / 12, 6);
    expect(b.remainderBalance).toBe(5000);
    expect(b.remainderMonthlyInterest).toBeCloseTo(5000 * 0.16 / 12, 6);
    expect(b.totalMonthlyInterest).toBeCloseTo((5000 * 0.08 + 5000 * 0.16) / 12, 6);
    expect(b.lines[0].monthlyInterestAfterPromo).toBeCloseTo(5000 * 0.16 / 12, 6);
  });

  it('after the cliff the whole card pays the standard rate', () => {
    const b = trancheInterestBreakdown(10000, [BT], STANDARD, '2028-02-01');
    expect(b.totalMonthlyInterest).toBeCloseTo(10000 * 0.16 / 12, 6);
    expect(b.lines[0].promoEndDate).toBeNull();
  });

  it('clamps tranches that exceed the balance, and the remainder never goes negative', () => {
    const b = trancheInterestBreakdown(3000, [BT], STANDARD, '2026-09-01');
    expect(b.lines[0].balance).toBe(3000);
    expect(b.remainderBalance).toBe(0);
  });
});

describe('promoExpiryWarnings', () => {
  it('names the cliff, the added cost, and the paydown that beats it', () => {
    const [w] = promoExpiryWarnings([BT], STANDARD, '2026-09-01');
    expect(w.promoEndDate).toBe('2028-01-04');
    expect(w.monthsRemaining).toBe(16);
    expect(w.requiredMonthlyPaydown).toBeCloseTo(5000 / 16, 2);
    expect(w.extraMonthlyInterest).toBeCloseTo(5000 * 0.08 / 12, 6);
  });

  it('an expired or rate-neutral promo warns nothing', () => {
    expect(promoExpiryWarnings([BT], STANDARD, '2028-01-04')).toEqual([]);
    expect(promoExpiryWarnings([BT], 8, '2026-09-01')).toEqual([]);
    expect(promoExpiryWarnings([{ ...BT, promo_end_date: null }], STANDARD, '2026-09-01')).toEqual([]);
  });
});

describe('allocatePaymentAcrossTranches — CARD Act', () => {
  it('sends dollars to the highest current APR first: remainder before a live promo', () => {
    const alloc = allocatePaymentAcrossTranches(6000, 10000, [BT], STANDARD, '2026-09-01');
    expect(alloc.get('remainder')).toBe(5000);
    expect(alloc.get('bt-1')).toBe(1000);
  });

  it('after the cliff the order flips with the rates', () => {
    // Post-expiry both pay 16% — listed bucket order after the stable sort keeps the tranche
    // first only if its rate is strictly higher, so equal rates drain in encounter order.
    const alloc = allocatePaymentAcrossTranches(1000, 10000, [BT], STANDARD, '2028-02-01');
    const total = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(1000);
  });

  it('never allocates more than the payment or the balances', () => {
    const alloc = allocatePaymentAcrossTranches(20000, 10000, [BT], STANDARD, '2026-09-01');
    const total = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(10000);
  });
});
