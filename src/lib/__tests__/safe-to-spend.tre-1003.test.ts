import { describe, it, expect } from 'vitest';
import {
  computeSafeToSpend, assembleSafeToSpendInput,
  type SafeToSpendAssembly, type SafeToSpendMonth0,
} from '../safe-to-spend';
import { cardPaymentSettledThisCycle } from '../credit-card-engine';

/**
 * Tre's Safe to Spend read $0 on 2026-10-03 (Sam relayed: "am I able to pay 987 to chase today?").
 * Two defects in it, both measured in his drawer:
 *   (a) "Oct 4 · Discover it Card payment $150.40" - Discover was paid 10-01 and is next due 11-01.
 *       The month-0 "already paid" rule was date-only with a 3-day settlement lag, so a 10-01 due
 *       date on a 10-03 sync still read as unpaid. Fixed by the card's own settled payment credit.
 *   (b) the +$200 one-time income on 10-05 was dropped: only a NEGATIVE one-time net was ever
 *       reserved, a positive one was ignored. Fixed by walking each one-time on its own date.
 */

describe('(a) cardPaymentSettledThisCycle - the card\'s own payment credit', () => {
  const now = new Date(2026, 9, 3); // Oct 3, local
  const tx = (o: Partial<{ account_id: string; amount: number; date: string; pending: boolean; name: string }>) => ({
    account_id: 'disc', amount: -198.17, date: '2026-10-01', pending: false, name: 'DIRECTPAY MINIMUM PAYMENT', ...o,
  });

  it('POSITIVE: Discover\'s settled $198.17 payment on 10-01 settles the 10-01 minimum of $150.40', () => {
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({})], now)).toBe(true);
  });
  it('last month\'s payment (09-01) does not settle this month', () => {
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({ date: '2026-09-01', amount: -150.4 })], now)).toBe(false);
  });
  it('a payment below the minimum does not settle it', () => {
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({ amount: -100 })], now)).toBe(false);
  });
  it('a refund or statement credit is not a payment', () => {
    expect(cardPaymentSettledThisCycle('disc', 1, 10, [tx({ name: 'AUTOMATIC STATEMENT CREDIT', amount: -10.83 })], now)).toBe(false);
    expect(cardPaymentSettledThisCycle('disc', 1, 10, [tx({ name: 'Amazon', amount: -15.34 })], now)).toBe(false);
  });
  it('a pending credit, a charge, or another card\'s payment does not count', () => {
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({ pending: true })], now)).toBe(false);
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({ amount: 198.17 })], now)).toBe(false);
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, [tx({ account_id: 'prime' })], now)).toBe(false);
  });
  it('Prime Visa\'s 09-07 payment does not settle its 10-07 due date', () => {
    expect(cardPaymentSettledThisCycle('prime', 7, 773.05,
      [tx({ account_id: 'prime', date: '2026-09-07', amount: -743.75, name: 'AUTOMATIC PAYMENT - THANK' })], now)).toBe(false);
  });
  it('no due day or no transactions is no evidence', () => {
    expect(cardPaymentSettledThisCycle('disc', null, 150.4, [tx({})], now)).toBe(false);
    expect(cardPaymentSettledThisCycle('disc', 1, 150.4, undefined, now)).toBe(false);
  });
});

describe('(b) one-time transactions walked on their own dates', () => {
  const m0: SafeToSpendMonth0 = {
    fundingBalance: 1000, carSavedEarmark: 0, goalContributions: 0, autoExtraReserve: 0, carReserve: 0,
    carLoanPayment: 0, vehicleInsurance: 0, otherDebtPayment: 0, transfers: 0, planExpenses: 0, oneTimeNet: 200,
    cyclingPayment: 0,
  };
  const asm = (over: Partial<SafeToSpendAssembly>): SafeToSpendAssembly => ({
    month0: m0, fundingAccountId: 'chk', liquidAccountIds: new Set(['chk']), creditCardIds: new Set(),
    paycheckRuleIds: new Set(), cardMinimumReserve: 0, rules: [], scheduledEvents: [], confirmed: new Set(),
    pauseSavings: false, cutoffDate: '2026-10-03', profilePayday: '2026-10-09', floor: 0,
    monthZeroDate: '2026-10-03', ...over,
  });
  const rentRule = { id: 'bill', active: true, rule_type: 'expense', category: 'Housing', payment_source: null, deposit_account: null, tax_rate: null };
  const bill = { ruleId: 'bill', date: '2026-10-07', amount: 1100, type: 'expense' as const, name: 'bill' };
  const run = (a: SafeToSpendAssembly) => computeSafeToSpend(assembleSafeToSpendInput(a));

  it('BEFORE (no item list): a positive net is ignored, so a $1,100 bill on 10-07 leaves $0', () => {
    const r = run(asm({ rules: [rentRule], scheduledEvents: [bill] }));
    expect(r.kind === 'figure' && r.amount).toBe(0);
  });
  it('the +$200 on 10-05 is counted before the 10-07 bill: $100 safe', () => {
    const r = run(asm({
      month0: { ...m0, oneTimeItems: [{ date: '2026-10-05', amount: 200, direction: 'in', label: 'ESTIMATE' }] },
      rules: [rentRule], scheduledEvents: [bill],
    }));
    expect(r.kind === 'figure' && r.amount).toBe(100);
  });
  it('income that lands AFTER the low point does not lift the figure', () => {
    const r = run(asm({
      month0: { ...m0, oneTimeItems: [{ date: '2026-10-08', amount: 200, direction: 'in', label: 'late' }] },
      rules: [rentRule], scheduledEvents: [bill],
    }));
    expect(r.kind === 'figure' && r.amount).toBe(0);
  });
  it('a one-time outflow is walked on its date too, and is not ALSO reserved as a net', () => {
    const r = run(asm({
      month0: { ...m0, oneTimeNet: -300, oneTimeItems: [{ date: '2026-10-06', amount: 300, direction: 'out', label: 'repair' }] },
    }));
    expect(r.kind === 'figure' && r.amount).toBe(700);
  });
});
