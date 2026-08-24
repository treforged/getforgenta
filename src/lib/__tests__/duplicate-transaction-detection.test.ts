import { describe, it, expect } from 'vitest';
import {
  scanForDuplicateTransactions,
  findDuplicateCollisions,
  collisionKey,
  DUPLICATE_AMOUNT_TOLERANCE,
  type GeneratedObligation,
  type ManualTransaction,
} from '../duplicate-transaction-detection';
import type { PaymentPlan } from '../payment-plan-generator';
import type { CarFund } from '../types';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';

const CHECKING_ID = 'chk-total-checking';

/**
 * Tre's real trap, reproduced. `car_funds` amortizes the 2004 Chevrolet at $422.89/mo; a manual
 * `transactions` row dated 2026-09-08 for the same $422.89 sits beside September's generated
 * installment, and September is charged twice.
 */
const chevy: CarFund = {
  id: 'cf-chevy',
  user_id: 'u1',
  vehicle_name: '2004 Chevorlet C5',
  phase: 'loan',
  target_amount: 0,
  monthly_contribution: 0,
  planned_purchase_date: '2025-09-01',
  loan_start_date: '2025-09-01',
  payment_start_date: '2025-09-08',
  interest_start_date: '2025-09-08',
  loan_term_months: 29,
  expected_apr: 0,
  down_payment: 0,
  loan_amount: 422.89 * 29,
  vehicle_price: 422.89 * 29,
  actual_monthly_payment: 422.89,
  loan_payment_account: CHECKING_ID,
  monthly_insurance: 0,
  insurance_start_date: null,
  lump_sum_payments: [],
} as unknown as CarFund;

function manual(over: Partial<ManualTransaction> & { amount: number }): ManualTransaction {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    date: '2026-09-08',
    type: 'expense',
    category: 'Auto Loan',
    note: '2004 Chevorlet C5 Payment (13/29)',
    payment_source: '',
    origin: 'manual',
    ...over,
  };
}

function generated(over: Partial<GeneratedObligation> & { amount: number }): GeneratedObligation {
  return {
    id: `g-${Math.random().toString(36).slice(2)}`,
    kind: 'car_loan',
    date: '2026-09-08',
    type: 'expense',
    note: '2004 Chevorlet C5 Payment (13/29)',
    payment_source: `account:${CHECKING_ID}`,
    ...over,
  };
}

const emptyScan = {
  rules: [] as RuleRow[],
  accounts: [] as AccountRow[],
  paymentPlans: [] as PaymentPlan[],
  carFunds: [] as CarFund[],
};

describe('the live case — a manual row beside the car-loan amortization', () => {
  it('flags the September collision, naming the generator', () => {
    const row = manual({ amount: 422.89 });
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      carFunds: [chevy],
      transactions: [row],
    });

    expect(found).toHaveLength(1);
    expect(found[0].monthKey).toBe('2026-09');
    expect(found[0].amount).toBe(422.89);
    expect(found[0].generated.kind).toBe('car_loan');
    expect(found[0].manual.id).toBe(row.id);
  });

  it('says nothing when the manual row is the only $422.89 in a month the loan does not bill', () => {
    // The loan runs 29 payments from 2025-09; a 2029 row has no installment to collide with.
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      carFunds: [chevy],
      transactions: [manual({ amount: 422.89, date: '2029-09-08' })],
    });
    expect(found).toHaveLength(0);
  });
});

describe('what counts as the same payment', () => {
  it('matches across the month — a hand-typed row rarely lands on the generator\'s day', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, date: '2026-09-27' })],
      [generated({ amount: 422.89, date: '2026-09-08' })],
    )).toHaveLength(1);
  });

  it('does not match across months', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, date: '2026-10-08' })],
      [generated({ amount: 422.89, date: '2026-09-08' })],
    )).toHaveLength(0);
  });

  it('tolerates a cent and no more', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.88 })],
      [generated({ amount: 422.89 })],
    )).toHaveLength(1);
    expect(findDuplicateCollisions(
      [manual({ amount: 422.87 })],
      [generated({ amount: 422.89 })],
    )).toHaveLength(0);
    expect(DUPLICATE_AMOUNT_TOLERANCE).toBe(0.01);
  });

  it('never crosses direction — income is not a duplicate of an expense', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, type: 'income' })],
      [generated({ amount: 422.89, type: 'expense' })],
    )).toHaveLength(0);
  });

  it('rejects the pair when both name DIFFERENT accounts', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, payment_source: 'account:some-other-card' })],
      [generated({ amount: 422.89, payment_source: `account:${CHECKING_ID}` })],
    )).toHaveLength(0);
  });

  it('accepts the pair when one side is unattributed — the live row carries no source', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, payment_source: '' })],
      [generated({ amount: 422.89, payment_source: `account:${CHECKING_ID}` })],
    )).toHaveLength(1);
  });

  it('treats a bare account id and an account:-prefixed one as the same account', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, payment_source: CHECKING_ID })],
      [generated({ amount: 422.89, payment_source: `account:${CHECKING_ID}` })],
    )).toHaveLength(1);
  });

  it('never flags a synced bank row — those are what DID happen', () => {
    expect(findDuplicateCollisions(
      [manual({ amount: 422.89, origin: 'synced' })],
      [generated({ amount: 422.89 })],
    )).toHaveLength(0);
  });
});

describe('a legitimate second payment of the same amount can be kept', () => {
  it('pairs one-to-one — two manual rows against one installment flag ONCE', () => {
    const copy = manual({ amount: 422.89, id: 'm-copy', date: '2026-09-08' });
    const extra = manual({ amount: 422.89, id: 'm-extra', date: '2026-09-22', note: 'extra principal' });

    const found = findDuplicateCollisions([copy, extra], [generated({ amount: 422.89, id: 'g-sep' })]);

    expect(found).toHaveLength(1);
    // The earlier row claims the installment; the later one is left alone as a real second payment.
    expect(found[0].manual.id).toBe('m-copy');
  });

  it('flags both when the generator really does bill twice that month', () => {
    const found = findDuplicateCollisions(
      [manual({ amount: 422.89, id: 'm1' }), manual({ amount: 422.89, id: 'm2', date: '2026-09-22' })],
      [generated({ amount: 422.89, id: 'g1' }), generated({ amount: 422.89, id: 'g2', date: '2026-09-22' })],
    );
    expect(found).toHaveLength(2);
    expect(new Set(found.map(c => c.generated.id))).toEqual(new Set(['g1', 'g2']));
  });

  it('resolves nothing on its own — the manual row is returned, never removed', () => {
    const rows = [manual({ amount: 422.89 })];
    findDuplicateCollisions(rows, [generated({ amount: 422.89 })]);
    expect(rows).toHaveLength(1);
  });
});

describe('dismissal', () => {
  it('hides a dismissed pair and leaves the others', () => {
    const g1 = generated({ amount: 422.89, id: 'g1' });
    const g2 = generated({ amount: 150, id: 'g2', date: '2026-10-08', note: 'Something else' });
    const m1 = manual({ amount: 422.89, id: 'm1' });
    const m2 = manual({ amount: 150, id: 'm2', date: '2026-10-08' });

    const all = findDuplicateCollisions([m1, m2], [g1, g2]);
    expect(all).toHaveLength(2);

    const remaining = findDuplicateCollisions([m1, m2], [g1, g2], [all[0].key]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].key).toBe(all[1].key);
  });

  it('produces the same key on every scan, so a dismissal persists', () => {
    const m = manual({ amount: 422.89, id: 'm1' });
    const g = generated({ amount: 422.89, id: 'g1' });
    const first = findDuplicateCollisions([m], [g])[0].key;
    const second = findDuplicateCollisions([m], [g])[0].key;
    expect(second).toBe(first);
    expect(first).toBe(collisionKey('m1', 'g1', 422.89));
  });

  it('asks again when the amount changes — a different number is a different decision', () => {
    const g = generated({ amount: 422.89, id: 'g1' });
    const dismissedKey = collisionKey('m1', 'g1', 422.89);

    expect(findDuplicateCollisions([manual({ amount: 422.89, id: 'm1' })], [g], [dismissedKey])).toHaveLength(0);
    // Edited to a penny less: still within tolerance, still a collision, but not the dismissed one.
    expect(findDuplicateCollisions([manual({ amount: 422.88, id: 'm1' })], [g], [dismissedKey])).toHaveLength(1);
  });
});

describe('the other generators', () => {
  const plan: PaymentPlan = {
    id: 'plan-1',
    user_id: 'u1',
    name: 'Sofa',
    provider: 'PayPal',
    total_amount: 400,
    payment_amount: 100,
    frequency: 'monthly',
    start_date: '2026-09-03',
    total_payments: 4,
    category: 'Shopping',
    payment_source: `account:${CHECKING_ID}`,
    plan_type: 'monthly_charge',
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  } as unknown as PaymentPlan;

  const rule: RuleRow = {
    id: 'rule-1',
    user_id: 'u1',
    name: 'Internet',
    amount: 89.99,
    category: 'Bills',
    rule_type: 'expense',
    frequency: 'monthly',
    due_day: 12,
    due_month: null,
    active: true,
    payment_source: `account:${CHECKING_ID}`,
    deposit_account: null,
    start_date: null,
    end_date: null,
  } as unknown as RuleRow;

  it('flags a hand-entered payment-plan installment', () => {
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      paymentPlans: [plan],
      transactions: [manual({ amount: 100, date: '2026-09-15', note: 'Sofa payment', category: 'Shopping' })],
    });
    expect(found).toHaveLength(1);
    expect(found[0].generated.kind).toBe('payment_plan');
  });

  it('flags a hand-entered copy of a recurring rule', () => {
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      rules: [rule],
      transactions: [manual({ amount: 89.99, date: '2026-09-20', note: 'Internet bill', category: 'Bills' })],
    });
    expect(found).toHaveLength(1);
    expect(found[0].generated.kind).toBe('recurring_rule');
  });

  it('stays quiet when the stream SUBSTITUTES the rule occurrence rather than adding to it', () => {
    // mergeWithGeneratedTransactions drops a generated occurrence whose date+note+amount equals a
    // real row's — the real row replaces it, nothing is double-counted, and warning here would flag
    // the app's own working behavior as a bug.
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      rules: [rule],
      transactions: [manual({ amount: 89.99, date: '2026-09-12', note: 'Internet', category: 'Bills' })],
    });
    expect(found).toHaveLength(0);
  });

  it('stays quiet when the substitution is tolerant, the same bill paid on a different day', () => {
    // Since 2026-08-24 the merge also substitutes by occurrence identity (same note, amount inside
    // the matcher's tolerance, date inside its window) via overridesGeneratedOccurrence. This scan
    // reuses that predicate, so a bill paid three days late must not come back as a "duplicate"
    // warning about the app's own working substitution. Before the reuse, this exact case warned:
    // the byte-exact key missed on the date, the obligation stayed collected, and the real row
    // collided with it.
    const found = scanForDuplicateTransactions({
      ...emptyScan,
      rules: [rule],
      transactions: [manual({ amount: 89.99, date: '2026-09-15', note: 'Internet', category: 'Bills' })],
    });
    expect(found).toHaveLength(0);
  });
});
