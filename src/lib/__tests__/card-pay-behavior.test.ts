import { describe, it, expect } from 'vitest';
import { inferCardPayBehavior, type CardPaymentTxn } from '../card-pay-behavior';

const TODAY = '2026-10-03';
const p = (date: string, amount: number, name: string, pending = false): CardPaymentTxn => ({ date, amount, name, pending });

describe('inferCardPayBehavior', () => {
  it("Discover's real history: DIRECTPAY MINIMUM on the 1st -> minimum, day 1, manual lumps ignored", () => {
    const r = inferCardPayBehavior([
      p('2026-10-01', -198.17, 'DIRECTPAY MINIMUM PAYMENT'),
      p('2026-09-01', -150.4, 'DIRECTPAY MINIMUM PAYMENT SEE DETAILS OF YOUR NEXT DIRECTPAY BELOW'),
      p('2026-07-28', -1000, 'INTERNET PAYMENT - THANK YOU'),
    ], { minPayment: 150.4, today: TODAY });
    expect(r).toEqual({ autopay: true, kind: 'minimum', dayOfMonth: 1, sampleSize: 2, lastAmount: 198.17 });
  });

  it("Prime's real history: AUTOMATIC PAYMENT on the 7th, above the minimum -> statement_or_more", () => {
    const r = inferCardPayBehavior([
      p('2026-09-07', -743.75, 'AUTOMATIC PAYMENT - THANK'),
      p('2026-08-07', -941.01, 'AUTOMATIC PAYMENT - THANK'),
      p('2026-06-23', -5037.73, 'Payment Thank You Bill'),
    ], { minPayment: 773.05, today: TODAY });
    expect(r).toEqual({ autopay: true, kind: 'statement_or_more', dayOfMonth: 7, sampleSize: 2, lastAmount: 743.75 });
  });

  it('manual payments only -> unknown, no day', () => {
    const r = inferCardPayBehavior([p('2026-09-20', -500, 'Payment Thank You-Mobile'), p('2026-08-20', -854, 'Payment Thank You-Mobile')], { minPayment: 25, today: TODAY });
    expect(r).toEqual({ autopay: false, kind: 'unknown', dayOfMonth: null, sampleSize: 2, lastAmount: 500 });
  });

  it('a manual payment equal to the minimum reads as minimum', () => {
    const r = inferCardPayBehavior([p('2026-09-12', -25.4, 'Payment Thank You')], { minPayment: 25, today: TODAY });
    expect(r.kind).toBe('minimum');
    expect(r.autopay).toBe(false);
  });

  it('autopay matching the minimum without the word MINIMUM -> minimum', () => {
    const r = inferCardPayBehavior([p('2026-09-15', -35, 'AUTOPAY PYMT')], { minPayment: 35, today: TODAY });
    expect(r.kind).toBe('minimum');
    expect(r.dayOfMonth).toBe(15);
  });

  it('pending and non-negative amounts are ignored', () => {
    const r = inferCardPayBehavior([
      p('2026-10-02', -900, 'AUTOPAY', true),
      p('2026-09-30', 40, 'AUTOPAY REVERSAL'),
      p('2026-09-12', -334.26, 'AUTOPAY'),
    ], { minPayment: 25, today: TODAY });
    expect(r).toEqual({ autopay: true, kind: 'statement_or_more', dayOfMonth: 12, sampleSize: 1, lastAmount: 334.26 });
  });

  it('payments older than 120 days or after today are ignored', () => {
    const r = inferCardPayBehavior([p('2026-05-01', -51.88, 'DIRECTPAY MINIMUM PAYMENT'), p('2026-10-10', -60, 'AUTOPAY')], { minPayment: 25, today: TODAY });
    expect(r.sampleSize).toBe(0);
    expect(r.kind).toBe('unknown');
  });

  it('the 120-day edge is inclusive', () => {
    const r = inferCardPayBehavior([p('2026-06-05', -100, 'AUTOPAY')], { minPayment: null, today: TODAY });
    expect(r.sampleSize).toBe(1);
  });

  it('a day tie resolves to the most recent payment', () => {
    const r = inferCardPayBehavior([p('2026-07-03', -50, 'AUTOPAY'), p('2026-08-09', -50, 'AUTOPAY'), p('2026-09-09', -50, 'AUTOPAY'), p('2026-06-20', -50, 'AUTOPAY')], { minPayment: null, today: TODAY });
    expect(r.dayOfMonth).toBe(9);
  });

  it('empty input', () => {
    expect(inferCardPayBehavior([], { minPayment: 25, today: TODAY })).toEqual({ autopay: false, kind: 'unknown', dayOfMonth: null, sampleSize: 0, lastAmount: null });
  });

  it('does not mutate its input order', () => {
    const txns = [p('2026-08-07', -1, 'AUTOPAY'), p('2026-09-07', -2, 'AUTOPAY')];
    inferCardPayBehavior(txns, { minPayment: null, today: TODAY });
    expect(txns.map(t => t.date)).toEqual(['2026-08-07', '2026-09-07']);
  });
});
