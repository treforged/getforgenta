import { describe, it, expect } from 'vitest';
import {
  nextMonthStart, nextMonthReservations, transferTerms, buildNextMonthTerms,
  nextMonthOtherDebts, nextMonthPlanPayments,
  type NextMonthTerm, type NextMonthTermSources,
} from '@/lib/safe-to-spend-next-month';
import type { PaymentPlan } from '@/lib/payment-plan-generator';
import { assembleSafeToSpendInput, computeSafeToSpend, type SafeToSpendAssembly } from '@/lib/safe-to-spend';

const term = (over: Partial<NextMonthTerm>): NextMonthTerm =>
  ({ label: 'X', amount: 100, dueDay: null, kind: 'other-debt', editPath: '/debt', ...over });

describe('nextMonthReservations - Sam ruling 938fb5db', () => {
  // Cutoff late October, payday 2 November.
  const cutoff = '2026-10-28';
  const payday = '2026-11-02';

  it('EXCLUDES a dated bill after payday (car loan on the 20th, payday on the 2nd)', () => {
    const r = nextMonthReservations([term({ label: 'Car loan', amount: 450, dueDay: 20, kind: 'car-loan' })], cutoff, payday);
    expect(r.events).toEqual([]);
    expect(r.undated).toEqual([]);
  });

  it('RESERVES a dated bill before payday on its exact date', () => {
    const r = nextMonthReservations([term({ label: 'Transfer', amount: 200, dueDay: 1, kind: 'transfer' })], cutoff, payday);
    expect(r.events).toEqual([{ date: '2026-11-01', amount: 200, direction: 'out', label: 'Transfer' }]);
    expect(r.undated).toEqual([]);
  });

  it('reserves a bill due ON payday', () => {
    const r = nextMonthReservations([term({ amount: 75, dueDay: 2 })], cutoff, payday);
    expect(r.events.map(e => e.date)).toEqual(['2026-11-02']);
  });

  it('RESERVES an undated bill on day 1 AND lists it', () => {
    const r = nextMonthReservations([term({ label: 'Other debt payments', amount: 310 })], cutoff, payday);
    expect(r.events).toEqual([{ date: '2026-11-01', amount: 310, direction: 'out', label: 'Other debt payments' }]);
    expect(r.undated).toEqual([{ label: 'Other debt payments', amount: 310, kind: 'other-debt', editPath: '/debt' }]);
  });

  it('reserves goal contributions on day 1 but does NOT list them (no due-date field exists)', () => {
    const r = nextMonthReservations([term({ label: 'Goals', amount: 500, kind: 'goal' })], cutoff, payday);
    expect(r.events.map(e => [e.date, e.amount])).toEqual([['2026-11-01', 500]]);
    expect(r.undated).toEqual([]);
  });

  it('does nothing when payday is in the cutoff month', () => {
    expect(nextMonthReservations([term({})], '2026-10-01', '2026-10-15')).toEqual({ events: [], undated: [] });
  });

  it('does nothing with no payday, or a payday two months out', () => {
    expect(nextMonthReservations([term({})], cutoff, null)).toEqual({ events: [], undated: [] });
    expect(nextMonthReservations([term({})], cutoff, '2026-12-01')).toEqual({ events: [], undated: [] });
  });

  it('rolls December into January of the next year', () => {
    expect(nextMonthStart('2026-12-30')).toBe('2027-01-01');
    const r = nextMonthReservations([term({ amount: 50, dueDay: 3 })], '2026-12-30', '2027-01-05');
    expect(r.events.map(e => e.date)).toEqual(['2027-01-03']);
  });

  it('clamps a due day past the month end (31 -> Feb 28; 29 in a leap year)', () => {
    expect(nextMonthReservations([term({ dueDay: 31 })], '2027-01-30', '2027-02-28').events[0].date).toBe('2027-02-28');
    expect(nextMonthReservations([term({ dueDay: 31 })], '2028-01-30', '2028-02-29').events[0].date).toBe('2028-02-29');
  });

  it('ignores zero, negative and non-finite amounts', () => {
    const r = nextMonthReservations([term({ amount: 0 }), term({ amount: -5 }), term({ amount: NaN })], cutoff, payday);
    expect(r.events).toEqual([]);
  });
});

describe('transferTerms', () => {
  const cash = new Set(['chk']);
  const rule = { name: 'To savings', amount: '100', frequency: 'monthly', due_day: 5, start_date: null, end_date: null, payment_source: 'chk' };

  it('a monthly transfer is dated by due_day', () => {
    expect(transferTerms([rule], '2026-11-01', cash)).toEqual([
      { label: 'To savings', amount: 100, dueDay: 5, kind: 'transfer', editPath: '/budget' },
    ]);
  });

  it('a weekly Friday transfer lands on every Friday of November 2026 (6, 13, 20, 27)', () => {
    const t = transferTerms([{ ...rule, frequency: 'weekly', due_day: 5 }], '2026-11-01', cash);
    expect(t.map(x => x.dueDay)).toEqual([6, 13, 20, 27]);
  });

  it('a weekly Sunday transfer includes 1 November 2026 (a Sunday)', () => {
    const t = transferTerms([{ ...rule, frequency: 'weekly', due_day: 0 }], '2026-11-01', cash);
    expect(t.map(x => x.dueDay)).toEqual([1, 8, 15, 22, 29]);
  });

  it('yearly is amount / 12 undated; biweekly is the full amount undated', () => {
    const t = transferTerms([{ ...rule, frequency: 'yearly', amount: 1200 }, { ...rule, frequency: 'biweekly' }], '2026-11-01', cash);
    expect(t.map(x => [x.amount, x.dueDay])).toEqual([[100, null], [100, null]]);
  });

  it('skips a non-cash source, a rule not started yet, and an ended rule', () => {
    expect(transferTerms([
      { ...rule, payment_source: 'brokerage' },
      { ...rule, start_date: '2026-12-01' },
      { ...rule, end_date: '2026-10-31' },
    ], '2026-11-01', cash)).toEqual([]);
  });

  it('accepts an account:-prefixed source', () => {
    expect(transferTerms([{ ...rule, payment_source: 'account:chk' }], '2026-11-01', cash)).toHaveLength(1);
  });
});

describe('buildNextMonthTerms', () => {
  it('dates car loan, insurance, cards, debts (payment_due_day) and plans (own dates); goals and a debt with no due day stay undated', () => {
    const s: NextMonthTermSources = {
      monthStart: '2026-11-01', transferRules: [], cashSourceIds: new Set(),
      goalContributions: 500,
      otherDebts: [{ label: 'Student Loan', amount: 310, dueDay: 18 }, { label: 'Personal Loan', amount: 120, dueDay: null }],
      planPayments: [{ label: 'Affirm', amount: 90, date: '2026-11-09' }],
      carLoans: [{ label: 'Civic loan', amount: 450, paymentStartDate: '2025-06-20' }],
      carInsurance: [{ label: 'Civic insurance', amount: 140, anchorDate: '2025-06-12' }],
      cards: [{ label: 'Discover payment', amount: 35, dueDay: 4 }],
    };
    expect(buildNextMonthTerms(s).map(t => [t.label, t.dueDay])).toEqual([
      ['Savings goal contributions', null], ['Civic loan', 20], ['Civic insurance', 12],
      ['Discover payment', 4], ['Student Loan', 18], ['Personal Loan', null], ['Affirm', 9],
    ]);
    // Only the debt with no due day is listed as fixable; the goal is reserved but not listed.
    const r = nextMonthReservations(buildNextMonthTerms(s), '2026-10-28', '2026-11-30');
    expect(r.undated.map(u => [u.label, u.editPath])).toEqual([['Personal Loan', '/accounts']]);
  });
});

describe('assembleSafeToSpendInput + computeSafeToSpend - the figure itself', () => {
  const month0 = {
    fundingBalance: 3000, carSavedEarmark: 0, goalContributions: 0, autoExtraReserve: 0, carReserve: 0,
    carLoanPayment: 0, vehicleInsurance: 0, otherDebtPayment: 0, transfers: 0, planExpenses: 0, oneTimeNet: 0,
    cyclingPayment: 0,
  };
  const a: SafeToSpendAssembly = {
    month0, fundingAccountId: 'chk', liquidAccountIds: new Set(['chk']), creditCardIds: new Set(),
    paycheckRuleIds: new Set(), cardMinimumReserve: 0, rules: [], scheduledEvents: [], confirmed: new Set(),
    pauseSavings: false, cutoffDate: '2026-10-28', profilePayday: '2026-11-02', floor: 0,
  };

  it('payday next month: $3,000 - $200 dated before payday - $310 undated = $2,490; the $450 on the 20th is not reserved', () => {
    const input = assembleSafeToSpendInput({ ...a, nextMonthTerms: [
      term({ label: 'Transfer', amount: 200, dueDay: 1, kind: 'transfer' }),
      term({ label: 'Car loan', amount: 450, dueDay: 20, kind: 'car-loan' }),
      term({ label: 'Other debt payments', amount: 310 }),
    ] });
    const r = computeSafeToSpend(input);
    expect(r.kind === 'figure' && r.amount).toBe(2490);
    expect(input?.undatedNextMonth).toEqual([{ label: 'Other debt payments', amount: 310, kind: 'other-debt', editPath: '/debt' }]);
  });

  it('without nextMonthTerms the figure is unchanged ($3,000) - the old gap, kept as the control', () => {
    const r = computeSafeToSpend(assembleSafeToSpendInput(a));
    expect(r.kind === 'figure' && r.amount).toBe(3000);
  });
});

describe('nextMonthOtherDebts - the engine selection, dated by payment_due_day (66279032)', () => {
  const acct = (id: string, name: string, balance: number, due: number | null) =>
    ({ id, name, account_type: 'student_loan', active: true, balance, payment_due_day: due });
  const debt = (name: string, target: number) => ({ name, balance: null, apr: 6, target_payment: target });

  it('keeps an owed debt with its due day, and one with no due day as null', () => {
    expect(nextMonthOtherDebts({
      accounts: [acct('a', 'Student Loan', 7946, 18), acct('b', 'Personal Loan', 2000, null)],
      debts: [debt('Student Loan', 310), debt('Personal Loan', 120)], rules: [],
    })).toEqual([
      { label: 'Student Loan', amount: 310, dueDay: 18 },
      { label: 'Personal Loan', amount: 120, dueDay: null },
    ]);
  });

  it('drops a debt paid by a same-named expense rule (already a dated rule event)', () => {
    expect(nextMonthOtherDebts({
      accounts: [acct('a', 'Student Loan', 7946, 18)], debts: [debt('Student Loan', 310)],
      rules: [{ name: 'Student Loan', rule_type: 'expense', active: true }],
    })).toEqual([]);
  });

  it('drops a debt projected paid off before next month ($200 left, $310 payment)', () => {
    expect(nextMonthOtherDebts({
      accounts: [acct('a', 'Student Loan', 200, 18)], debts: [debt('Student Loan', 310)], rules: [],
    })).toEqual([]);
  });
});

describe('nextMonthPlanPayments - dated by the plan schedule', () => {
  const plan = (over: Partial<PaymentPlan>): PaymentPlan => ({
    id: 'p', user_id: 'u', name: 'Affirm', provider: null, total_amount: 360, payment_amount: 90,
    frequency: 'monthly', start_date: '2026-09-09', total_payments: 4, category: 'Shopping',
    payment_source: null, active: true, ...over,
  } as PaymentPlan);

  it('a monthly plan started 9 Sept pays on 9 Nov', () => {
    expect(nextMonthPlanPayments([plan({})], '2026-11', new Set())).toEqual([{ label: 'Affirm', amount: 90, date: '2026-11-09' }]);
  });

  it('a biweekly plan yields each installment date in the month', () => {
    const r = nextMonthPlanPayments([plan({ frequency: 'biweekly', start_date: '2026-10-26', total_payments: 6 })], '2026-11', new Set());
    expect(r.map(x => x.date)).toEqual(['2026-11-09', '2026-11-23']);
  });

  it('skips a plan charged to a card, an inactive plan, and a finished plan', () => {
    expect(nextMonthPlanPayments([
      plan({ payment_source: 'account:card1' }),
      plan({ active: false }),
      plan({ total_payments: 2 }),
    ], '2026-11', new Set(['card1', 'account:card1']))).toEqual([]);
  });
});
