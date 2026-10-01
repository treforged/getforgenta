import { describe, it, expect } from 'vitest';
import {
  nextMonthStart, nextMonthReservations, transferTerms, buildNextMonthTerms,
  nextMonthOtherDebts, nextMonthPlanPayments, datedMonthZero, cardTermsFor,
  type NextMonthTerm, type NextMonthTermSources,
} from '@/lib/safe-to-spend-next-month';
import type { PaymentPlan } from '@/lib/payment-plan-generator';
import type { ScheduledEvent } from '@/lib/scheduling';
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

  it('payday next month: $3,000 - $200 dated before payday - $310 undated = $2,490; the $450 on the 20th is covered by the paycheck', () => {
    const paid: SafeToSpendAssembly = { ...a, paycheckRuleIds: new Set(['pay']),
      rules: [{ id: 'pay', active: true, rule_type: 'income', category: 'Salary', deposit_account: 'chk' }],
      scheduledEvents: [{ ruleId: 'pay', date: '2026-11-02', amount: 500, type: 'income', name: 'Paycheck' } as unknown as ScheduledEvent] };
    const input = assembleSafeToSpendInput({ ...paid, nextMonthTerms: [
      term({ label: 'Transfer', amount: 200, dueDay: 1, kind: 'transfer' }),
      term({ label: 'Car loan', amount: 450, dueDay: 20, kind: 'car-loan' }),
      term({ label: 'Other debt payments', amount: 310 }),
    ] });
    const r = computeSafeToSpend(input);
    expect(r.kind === 'figure' && r.amount).toBe(2490);
    expect(input?.undatedNextMonth).toEqual([{ label: 'Other debt payments', amount: 310, kind: 'other-debt', editPath: '/debt' }]);
  });

  it("Sam's condition 1, payday next month: with NO paycheck the 20th's $450 caps it -> $2,040", () => {
    const r = computeSafeToSpend(assembleSafeToSpendInput({ ...a, nextMonthTerms: [
      term({ label: 'Transfer', amount: 200, dueDay: 1, kind: 'transfer' }),
      term({ label: 'Car loan', amount: 450, dueDay: 20, kind: 'car-loan' }),
      term({ label: 'Other debt payments', amount: 310 }),
    ] }));
    expect(r.kind === 'figure' && [r.amount, r.lowDate]).toEqual([2040, '2026-11-20']);
  });

  it('on the 1st, with the sync cutoff still last month, THIS month is not reserved twice (Tre, 2026-10-01)', () => {
    // Cutoff 30 Sept, today 1 Oct, payday 2 Oct: October is month 0, whose chain already holds these terms.
    const terms = [term({ label: 'Discover it Card payment', amount: 150.4, dueDay: 1, kind: 'card' })];
    const input = assembleSafeToSpendInput({
      ...a, cutoffDate: '2026-09-30', profilePayday: '2026-10-02', monthZeroDate: '2026-10-01', nextMonthTerms: terms,
    });
    expect(input?.events).toEqual([]);
    expect(input?.nextMonthFirst).toBe('2026-11-01');
    const r = computeSafeToSpend(input);
    expect(r.kind === 'figure' && r.amount).toBe(3000);
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

describe('datedMonthZero - month 0 dated (Sam 2026-10-01)', () => {
  const card = (label: string, amount: number, dueDay: number | null) => term({ label, amount, dueDay, kind: 'card', editPath: '/accounts' });

  it('dates items whose sum matches the engine total', () => {
    const r = datedMonthZero([{ total: 300, items: [card('A', 100, 15), card('B', 200, 3)] }], '2026-10-01', '2026-09-30');
    expect(r.undatedReserve).toBe(0);
    expect(r.events.map(e => [e.date, e.amount])).toEqual([['2026-10-15', 100], ['2026-10-03', 200]]);
  });

  it('keeps the whole total undated when the items do not add up (never high, never double)', () => {
    const r = datedMonthZero([{ total: 350, items: [card('A', 100, 15), card('B', 200, 3)] }], '2026-10-01', '2026-09-30');
    expect(r).toEqual({ events: [], undatedReserve: 350 });
  });

  it('an item with no due day is reserved today', () => {
    const r = datedMonthZero([{ total: 300, items: [card('A', 100, null), card('B', 200, 20)] }], '2026-10-10', '2026-10-09');
    expect(r.undatedReserve).toBe(100);
    expect(r.events.map(e => e.date)).toEqual(['2026-10-20']);
  });

  it("EDGE 2 (Sam): a due day already PASSED but still in the engine's total is reserved the day after the cutoff, not next month", () => {
    const r = datedMonthZero([{ total: 120, items: [card('Loan', 120, 5)] }], '2026-10-12', '2026-10-11');
    expect(r.events).toEqual([{ date: '2026-10-12', amount: 120, direction: 'out', label: 'Loan' }]);
  });

  it('no items -> the total stays undated', () => {
    expect(datedMonthZero([{ total: 80, items: [] }], '2026-10-01', '2026-09-30')).toEqual({ events: [], undatedReserve: 80 });
  });
});

describe("the figure with month 0 dated - Tre's shape (cutoff 30 Sept, payday 2 Oct)", () => {
  const month0 = {
    fundingBalance: 2513.14, carSavedEarmark: 0, goalContributions: 39.86, autoExtraReserve: 0, carReserve: 0,
    carLoanPayment: 0, vehicleInsurance: 0, otherDebtPayment: 0, transfers: 0, planExpenses: 0, oneTimeNet: 0,
    cyclingPayment: 0,
  };
  const a: SafeToSpendAssembly = {
    month0, fundingAccountId: 'chk', liquidAccountIds: new Set(['chk']), creditCardIds: new Set(),
    paycheckRuleIds: new Set(), cardMinimumReserve: 1150.4, rules: [], scheduledEvents: [], confirmed: new Set(),
    pauseSavings: false, cutoffDate: '2026-09-30', profilePayday: '2026-10-02', floor: 0, monthZeroDate: '2026-10-01',
  };
  const terms = [
    term({ label: 'Discover payment', amount: 150.4, dueDay: 1, kind: 'card' }),
    term({ label: 'Prime Visa payment', amount: 1000, dueDay: 15, kind: 'card' }),
  ];

  it('EDGE 1 (Sam): a card due TODAY is reserved; one due on the 15th (after payday) is covered by the paycheck', () => {
    const paid: SafeToSpendAssembly = { ...a, paycheckRuleIds: new Set(['pay']),
      rules: [{ id: 'pay', active: true, rule_type: 'income', category: 'Salary', deposit_account: 'chk' }],
      scheduledEvents: ['2026-10-02', '2026-10-09'].map(date =>
        ({ ruleId: 'pay', date, amount: 816.1, type: 'income', name: 'Weekly Paycheck' }) as unknown as ScheduledEvent) };
    // Two paychecks (1,632.20) land before the 15th, so its $1,000 never dips below today's low.
    const r = computeSafeToSpend(assembleSafeToSpendInput({ ...paid, monthZeroTerms: terms }));
    // 2513.14 - 39.86 goals (undated) - 150.40 due today = 2322.88
    expect(r.kind === 'figure' && r.amount).toBeCloseTo(2322.88, 2);
  });

  it("Sam's condition 1: with NO paycheck, the 15th's $1,000 caps the figure -> $1,322.88", () => {
    const r = computeSafeToSpend(assembleSafeToSpendInput({ ...a, monthZeroTerms: terms }));
    expect(r.kind === 'figure' && [r.amount, r.lowDate, r.cappedAfterPayday]).toEqual([1322.88, '2026-10-15', true]);
  });

  it('control: without month-0 terms everything is reserved today -> $1,322.88', () => {
    const r = computeSafeToSpend(assembleSafeToSpendInput(a));
    expect(r.kind === 'figure' && r.amount).toBeCloseTo(1322.88, 2);
  });
});

describe('cardTermsFor - mirrors the engine split (9be90af5, Tre’s Robinhood)', () => {
  const p = {
    simCards: [{ id: 'disc', name: 'Discover', dueDay: 1 }, { id: 'rh', name: 'Robinhood', dueDay: 10 }],
    monthlyRevolvingBalances: new Map([['disc', [9000, 8500]], ['rh', [0, 0]]]),
    perCardMinPayments: new Map([['disc', [150.4, 145]], ['rh', [0, 0]]]),
    perCardPayments: [{ id: 'disc', payments: [900, 900] }, { id: 'rh', payments: [841, 300] }],
  };

  it('month 0: a revolving card owes its MINIMUM; a non-revolving card owes its whole sim payment (the statement)', () => {
    expect(cardTermsFor(p, 0)).toEqual([
      { label: 'Discover payment', amount: 150.4, dueDay: 1 },
      { label: 'Robinhood payment', amount: 841, dueDay: 10 },
    ]);
  });

  it('month 1 reads the START-of-month revolving balance (end of month 0), not the end of month 1', () => {
    // Discover still revolves at the start of month 1 ($9,000) and clears by its end: it owes the $145
    // minimum. Reading month 1's END balance would wrongly call the $900 payoff a statement.
    const q = { ...p, monthlyRevolvingBalances: new Map([['disc', [9000, 0]], ['rh', [0, 0]]]) };
    expect(cardTermsFor(q, 1).map(c => c.amount)).toEqual([145, 300]);
    // And a card that cleared in month 0 owes its whole month-1 sim payment as a statement.
    const r = { ...p, monthlyRevolvingBalances: new Map([['disc', [0, 0]], ['rh', [0, 0]]]) };
    expect(cardTermsFor(r, 1).map(c => c.amount)).toEqual([900, 300]);
  });
});
