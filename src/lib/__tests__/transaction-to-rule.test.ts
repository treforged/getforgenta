import { describe, it, expect } from 'vitest';
import {
  parseTransactionRepeat,
  ruleFromTransactionForm,
  transactionRepeatCadence,
  transactionRepeatHint,
  TRANSACTION_REPEAT_OPTIONS,
  type TransactionRepeatInput,
} from '../transaction-to-rule';
import { resolveBiweeklyAnchor, toLocalDateStr } from '../scheduling';

// 2026-08-21 is a FRIDAY (weekday 5) and the 21st of its month. Every expectation below is written
// as a literal so it states the calendar fact rather than recomputing it the way the code does.
const base: TransactionRepeatInput = {
  repeat: 'weekly',
  date: '2026-08-21',
  type: 'expense',
  amount: 62.5,
  category: 'Groceries',
  name: 'Weekly groceries',
  paymentSource: 'account:1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f',
};

/** The built rule, or a thrown failure naming the refusal reason. */
function payloadOf(overrides: Partial<TransactionRepeatInput> = {}) {
  const intent = ruleFromTransactionForm({ ...base, ...overrides });
  if (!intent.ok) throw new Error(`expected a rule, got refusal: ${intent.reason}`);
  return intent.payload;
}

describe('parseTransactionRepeat', () => {
  it('reads the four offered values', () => {
    for (const o of TRANSACTION_REPEAT_OPTIONS) {
      expect(parseTransactionRepeat(o.value)).toBe(o.value);
    }
  });

  it('treats anything it does not recognise as no repeat', () => {
    // A draft saved before the Repeats field existed restores with no `repeat` key, and a raw
    // `!== 'none'` on that undefined would have turned an ordinary add into a rule.
    expect(parseTransactionRepeat(undefined)).toBe('none');
    expect(parseTransactionRepeat(null)).toBe('none');
    expect(parseTransactionRepeat('')).toBe('none');
    expect(parseTransactionRepeat('yearly')).toBe('none');
    expect(parseTransactionRepeat('Weekly')).toBe('none');
  });

  it('offers no Yearly option', () => {
    expect(TRANSACTION_REPEAT_OPTIONS.map(o => o.value)).toEqual(['none', 'weekly', 'biweekly', 'monthly']);
    expect(TRANSACTION_REPEAT_OPTIONS.map(o => o.label)).toEqual(['None', 'Weekly', 'Every 2 Weeks', 'Monthly']);
  });
});

describe('ruleFromTransactionForm refusals', () => {
  it('refuses when nothing repeats', () => {
    const intent = ruleFromTransactionForm({ ...base, repeat: 'none' });
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/does not repeat/i);
  });

  it('refuses a blank name, because a rule is found by name and nothing else', () => {
    for (const name of ['', '   ']) {
      const intent = ruleFromTransactionForm({ ...base, name });
      expect(intent.ok).toBe(false);
      expect(intent.ok === false && intent.reason).toMatch(/note is required/i);
      expect(intent.ok === false && intent.reason).toMatch(/Budget Control/);
    }
  });

  it.each(['', '2026-8-21', '21/08/2026', '2026-02-31', 'tomorrow'])('refuses the unusable date %s', date => {
    const intent = ruleFromTransactionForm({ ...base, date });
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/real date/i);
  });

  it.each([0, NaN, Infinity])('refuses the unusable amount %s', amount => {
    const intent = ruleFromTransactionForm({ ...base, amount });
    expect(intent.ok).toBe(false);
    expect(intent.ok === false && intent.reason).toMatch(/usable amount/i);
  });
});

describe('ruleFromTransactionForm, weekly', () => {
  it('builds the whole rule from a Friday expense', () => {
    expect(payloadOf()).toEqual({
      name: 'Weekly groceries',
      amount: 62.5,
      rule_type: 'expense',
      frequency: 'weekly',
      due_day: 5,
      due_month: null,
      category: 'Groceries',
      payment_source: '1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f',
      deposit_account: null,
      start_date: '2026-08-21',
      end_date: null,
      notes: null,
      active: true,
    });
  });

  it.each([
    ['2026-08-23', 0],
    ['2026-08-24', 1],
    ['2026-08-25', 2],
    ['2026-08-26', 3],
    ['2026-08-27', 4],
    ['2026-08-28', 5],
    ['2026-08-29', 6],
  ])('reads %s as weekday %i from the string parts, never UTC', (date, weekday) => {
    // ⚠️ THE TIMEZONE TRAP THIS EXISTS FOR. `new Date('2026-08-23')` is UTC midnight, which is
    // Saturday the 22nd anywhere behind UTC, so a UTC-parsed builder would schedule this Sunday
    // transaction to repeat on Saturdays. Under TZ=UTC both readings agree and this test is merely
    // true; run it in America/New_York and only the local-parts reading passes.
    expect(payloadOf({ date, repeat: 'weekly' }).due_day).toBe(weekday);
  });
});

describe('ruleFromTransactionForm, biweekly', () => {
  it('pins the anchor to the entered date', () => {
    const payload = payloadOf({ repeat: 'biweekly' });
    expect(payload.frequency).toBe('biweekly');
    expect(payload.due_day).toBe(5);
    expect(payload.start_date).toBe('2026-08-21');
  });

  it('makes the engine run its 14-day cycle from the date the user picked', () => {
    // The assertion that actually matters: `resolveBiweeklyAnchor` is what every biweekly
    // generator phases on, and it prefers `start_date`. Without `start_date` the cycle would be
    // anchored on `created_at`, the moment the row was inserted, not the date on the form.
    const payload = payloadOf({ repeat: 'biweekly' });
    const anchor = resolveBiweeklyAnchor({
      due_day: payload.due_day,
      start_date: payload.start_date,
      created_at: '2026-09-04T18:22:00Z',
    });
    expect(toLocalDateStr(anchor)).toBe('2026-08-21');
  });

  it('does not let the anchor move when the entered weekday and due_day agree', () => {
    // `resolveBiweeklyAnchor` advances to the first `due_day` on or after the base date. Because
    // due_day is DERIVED from the same date, that advance is always zero days here.
    for (const date of ['2026-08-23', '2026-09-01', '2026-12-31']) {
      const payload = payloadOf({ date, repeat: 'biweekly' });
      const anchor = resolveBiweeklyAnchor({ due_day: payload.due_day, start_date: payload.start_date });
      expect(toLocalDateStr(anchor)).toBe(date);
    }
  });
});

describe('ruleFromTransactionForm, monthly', () => {
  it('uses the day of the MONTH, not the weekday', () => {
    const payload = payloadOf({ repeat: 'monthly' });
    expect(payload.frequency).toBe('monthly');
    expect(payload.due_day).toBe(21);
    expect(payload.start_date).toBe('2026-08-21');
  });

  it.each([
    ['2026-08-01', 1],
    ['2026-08-09', 9],
    ['2026-08-31', 31],
  ])('reads %s as day %i', (date, dayOfMonth) => {
    expect(payloadOf({ date, repeat: 'monthly' }).due_day).toBe(dayOfMonth);
  });
});

describe('ruleFromTransactionForm, income and account mapping', () => {
  it('sends an income rule to deposit_account and leaves payment_source null', () => {
    const payload = payloadOf({ type: 'income', category: 'Income', name: 'Side gig' });
    expect(payload.rule_type).toBe('income');
    expect(payload.deposit_account).toBe('1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f');
    expect(payload.payment_source).toBeNull();
  });

  it('strips the account: prefix the ledger select uses', () => {
    // Rules store a bare `accounts.id`; only this page's select speaks `account:<id>`.
    expect(payloadOf().payment_source).toBe('1f5b6b9e-9c1e-4f6a-8d47-2a3b4c5d6e7f');
  });

  it.each(['', 'cash', 'bank_account', 'credit_card', 'not-an-account-id'])(
    'leaves the rule unassigned for the source %s it cannot map to an account',
    paymentSource => {
      const payload = payloadOf({ paymentSource });
      expect(payload.payment_source).toBeNull();
      expect(payload.deposit_account).toBeNull();
    },
  );

  it('trims the name and stores a positive amount', () => {
    expect(payloadOf({ name: '  Gym  ' }).name).toBe('Gym');
    expect(payloadOf({ amount: -40 }).amount).toBe(40);
  });

  it('never writes a due_month or an end_date', () => {
    // Yearly is not offered, and nothing on the add form says when the series should stop.
    for (const repeat of ['weekly', 'biweekly', 'monthly'] as const) {
      const payload = payloadOf({ repeat });
      expect(payload.due_month).toBeNull();
      expect(payload.end_date).toBeNull();
      expect(payload.active).toBe(true);
    }
  });
});

describe('transactionRepeatHint', () => {
  it('says nothing when there is no repeat and nothing when the date is unusable', () => {
    expect(transactionRepeatHint('none', '2026-08-21')).toBeNull();
    expect(transactionRepeatHint('weekly', '')).toBeNull();
    expect(transactionRepeatHint('weekly', '2026-02-31')).toBeNull();
  });

  it('names the weekday it will actually repeat on', () => {
    expect(transactionRepeatHint('weekly', '2026-08-21')).toContain('every Friday');
    expect(transactionRepeatHint('weekly', '2026-08-23')).toContain('every Sunday');
  });

  it('describes the biweekly cycle in days, as the rule editor does', () => {
    expect(transactionRepeatHint('biweekly', '2026-08-21')).toContain('every 14 days');
  });

  it('names the day of the month, and warns when short months will clamp', () => {
    expect(transactionRepeatHint('monthly', '2026-08-21')).toContain('on the 21st of each month');
    expect(transactionRepeatHint('monthly', '2026-08-01')).toContain('on the 1st of each month');
    expect(transactionRepeatHint('monthly', '2026-08-03')).toContain('on the 3rd of each month');
    expect(transactionRepeatHint('monthly', '2026-08-31')).toContain('Shorter months bill on their last day.');
    expect(transactionRepeatHint('monthly', '2026-08-28')).not.toContain('Shorter months');
  });

  it('always says the row is saved as a rule rather than as a single transaction', () => {
    // The one fact a user cannot recover by looking: choosing a repeat REPLACES the one-off row.
    for (const repeat of ['weekly', 'biweekly', 'monthly'] as const) {
      expect(transactionRepeatHint(repeat, '2026-08-21')).toContain('not as a single row');
    }
  });
});

describe('transactionRepeatCadence', () => {
  it('reads the way the success toast needs it to', () => {
    expect(transactionRepeatCadence('weekly')).toBe('weekly');
    expect(transactionRepeatCadence('biweekly')).toBe('every 2 weeks');
    expect(transactionRepeatCadence('monthly')).toBe('monthly');
  });
});
