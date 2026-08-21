import { describe, it, expect } from 'vitest';
import {
  parseTranches, trancheMinimumAsOf, splitPaymentAcrossTranches,
  allocatePaymentAcrossTranches, type BalanceTranche, type TranchePayable,
} from '../balance-tranches';

const tranche = (o: Partial<BalanceTranche> & { id: string }): BalanceTranche => ({
  label: 'Promo', balance: 1000, apr: 0, promo_end_date: null, min_payment: null, ...o,
});

const payable = (o: Partial<TranchePayable> & { id: string }): TranchePayable => ({
  balance: 1000, apr: 0, minPayment: 0, promoEndDate: null, ...o,
});

describe('parseTranches — min_payment', () => {
  it('reads a positive instalment and normalises everything else to null', () => {
    const [a, b, c, d] = parseTranches([
      { id: 'a', balance: 100, apr: 0, min_payment: 49.89 },
      { id: 'b', balance: 100, apr: 0, min_payment: 0 },
      { id: 'c', balance: 100, apr: 0, min_payment: 'nonsense' },
      { id: 'd', balance: 100, apr: 0 },
    ]);
    expect(a.min_payment).toBe(49.89);
    expect(b.min_payment).toBeNull();
    expect(c.min_payment).toBeNull();
    expect(d.min_payment).toBeNull();
  });

  it('accepts a numeric string, because jsonb numerics can arrive as one', () => {
    expect(parseTranches([{ id: 'a', balance: 100, apr: 0, min_payment: '323.79' }])[0].min_payment)
      .toBe(323.79);
  });
});

describe('trancheMinimumAsOf', () => {
  const t = tranche({ id: 'p', min_payment: 100, promo_end_date: '2027-07-07' });

  it('is due while the promo is live', () => {
    expect(trancheMinimumAsOf(t, '2027-07-01')).toBe(100);
  });

  it('is still due in the month the promo ends — the last instalment is what retires it', () => {
    expect(trancheMinimumAsOf(t, '2027-07-07')).toBe(100);
  });

  it('is zero once the promo has ended, because the balance is ordinary money by then', () => {
    expect(trancheMinimumAsOf(t, '2027-08-01')).toBe(0);
  });

  it('is zero when no instalment is stored', () => {
    expect(trancheMinimumAsOf(tranche({ id: 'p' }), '2027-01-01')).toBe(0);
  });
});

describe('splitPaymentAcrossTranches', () => {
  it('PARITY: with no instalments it is the old highest-rate-first sweep, to the cent', () => {
    const got = splitPaymentAcrossTranches(1500, [
      payable({ id: 'low', apr: 7.99, balance: 5000 }),
      payable({ id: 'high', apr: 27.49, balance: 1000 }),
    ]);
    expect(got.get('high')).toBeCloseTo(1000, 6);
    expect(got.get('low')).toBeCloseTo(500, 6);
  });

  it('pays a 0% instalment BEFORE sweeping the high rate — the phantom-cliff fix', () => {
    const got = splitPaymentAcrossTranches(1000, [
      payable({ id: 'promo', apr: 0, balance: 3561.65, minPayment: 323.79, promoEndDate: '2027-07-07' }),
      payable({ id: 'revolving', apr: 27.49, balance: 2809.15 }),
    ]);
    expect(got.get('promo')).toBeCloseTo(323.79, 6);
    expect(got.get('revolving')).toBeCloseTo(676.21, 6);
  });

  it('never pays an instalment more than the balance left on it', () => {
    const got = splitPaymentAcrossTranches(500, [
      payable({ id: 'promo', apr: 0, balance: 40, minPayment: 68.97 }),
      payable({ id: 'rev', apr: 27.49, balance: 1000 }),
    ]);
    expect(got.get('promo')).toBeCloseTo(40, 6);
    expect(got.get('rev')).toBeCloseTo(460, 6);
  });

  it('feeds the SOONEST-expiring promo first when the payment cannot cover both', () => {
    const got = splitPaymentAcrossTranches(60, [
      payable({ id: 'late', apr: 0, balance: 900, minPayment: 50, promoEndDate: '2027-08-07' }),
      payable({ id: 'soon', apr: 0, balance: 300, minPayment: 50, promoEndDate: '2027-02-07' }),
    ]);
    expect(got.get('soon')).toBeCloseTo(50, 6);
    expect(got.get('late')).toBeCloseTo(10, 6);
  });

  it('does not double-count: a bucket paid in pass 1 is topped up, never re-paid, in pass 2', () => {
    const got = splitPaymentAcrossTranches(5000, [
      payable({ id: 'only', apr: 0, balance: 1000, minPayment: 200, promoEndDate: '2027-07-07' }),
    ]);
    expect(got.get('only')).toBeCloseTo(1000, 6);
  });

  it('allocates nothing for a zero or negative payment', () => {
    expect(splitPaymentAcrossTranches(0, [payable({ id: 'a', minPayment: 50 })]).size).toBe(0);
    expect(splitPaymentAcrossTranches(-5, [payable({ id: 'a', minPayment: 50 })]).size).toBe(0);
  });
});

describe('allocatePaymentAcrossTranches — the engine path', () => {
  it('honours the instalment on a 0% promo instead of sweeping it to the standard rate', () => {
    const got = allocatePaymentAcrossTranches(
      1000, 8396.90,
      [tranche({ id: 'promo', balance: 3561.65, apr: 0, promo_end_date: '2027-07-07', min_payment: 323.79 })],
      27.49, '2026-09-01',
    );
    expect(got.get('promo')).toBeCloseTo(323.79, 6);
    expect(got.get('remainder')).toBeCloseTo(676.21, 6);
  });

  it('stops paying the instalment once the promo has expired', () => {
    const got = allocatePaymentAcrossTranches(
      1000, 8396.90,
      [tranche({ id: 'promo', balance: 3561.65, apr: 0, promo_end_date: '2027-07-07', min_payment: 323.79 })],
      27.49, '2027-09-01',
    );
    // Repriced to 27.49%, so it ties with the remainder and takes the sweep on its own merits.
    expect(got.get('promo') ?? 0).toBeGreaterThan(323.79);
  });

  it('maps an allocation to the right tranche when an earlier one is clamped away', () => {
    // Tranches sum past the balance, so `trancheInterestBreakdown` drops the second line entirely.
    // The old index-based lookup paid the DROPPED tranche's id here.
    const got = allocatePaymentAcrossTranches(
      100, 500,
      [
        tranche({ id: 'first', balance: 500, apr: 0, promo_end_date: '2027-07-07', min_payment: 100 }),
        tranche({ id: 'stale', balance: 400, apr: 22.99 }),
      ],
      27.49, '2026-09-01',
    );
    expect(got.get('first')).toBeCloseTo(100, 6);
    expect(got.has('stale')).toBe(false);
  });
});
