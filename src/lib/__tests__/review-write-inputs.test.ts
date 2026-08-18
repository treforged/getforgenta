// The rows a decision writes, whichever surface the user made it on.
//
// These used to be four closures inside `BankActivity.tsx`. They were lifted out so the Decision
// Deck could write the SAME rows rather than a second set that drifts — so what this file pins is
// mostly the fields that must not move, and the one field that must not appear.
import { describe, it, expect } from 'vitest';
import {
  ruleOccurrence, acceptRuleInput, acceptPlanInput, acceptCarInput, acceptLedgerTxnInput,
  ignoreInput, planSuggestionAccept,
} from '../review-write-inputs';

const txn = { id: 'charge-1', date: '2026-08-19' };

const monthlyRule = {
  id: 'rule-1', name: 'Rent', frequency: 'monthly', due_day: 20, due_month: null, start_date: null,
};

const biweeklyRule = {
  id: 'rule-2', name: 'Fuel', frequency: 'biweekly', due_day: 3, due_month: null,
  start_date: '2026-01-02', created_at: '2026-01-02T00:00:00Z',
};

describe('ruleOccurrence — which occurrence a charge settled', () => {
  it('names the month and the day for a monthly rule', () => {
    expect(ruleOccurrence(monthlyRule, '2026-08-19')).toEqual({
      occurrence_month: '2026-08',
      occurrence_date: '2026-08-20',
    });
  });

  it('names a DAY for a biweekly rule — a month-wide link would suppress both of its charges', () => {
    const occurrence = ruleOccurrence(biweeklyRule, '2026-08-15');
    expect(occurrence.occurrence_month).toBe('2026-08');
    expect(occurrence.occurrence_date).toMatch(/^2026-08-\d{2}$/);
  });
});

describe('the four accept writes', () => {
  it('a rule link carries the rule and its occurrence, and NEVER a category', () => {
    const input = acceptRuleInput(txn, monthlyRule);
    expect(input).toEqual({
      synced_transaction_id: 'charge-1',
      status: 'linked_rule',
      rule_id: 'rule-1',
      occurrence_month: '2026-08',
      occurrence_date: '2026-08-20',
    });
    // A `category_override` on a link row is rejected outright by `validateReviewSet`.
    expect('category_override' in input).toBe(false);
  });

  it('a plan link carries the month only — a plan bills once a month', () => {
    expect(acceptPlanInput(txn, 'plan-1')).toEqual({
      synced_transaction_id: 'charge-1',
      status: 'linked_plan',
      payment_plan_id: 'plan-1',
      occurrence_month: '2026-08',
    });
  });

  it('a vehicle link carries WHICH of the vehicle\'s two monthly bills it settled', () => {
    expect(acceptCarInput(txn, 'fund-1', 'insurance')).toEqual({
      synced_transaction_id: 'charge-1',
      status: 'linked_car',
      car_fund_id: 'fund-1',
      car_charge_kind: 'insurance',
      occurrence_month: '2026-08',
    });
  });

  it('a ledger link KEEPS the category — it is exclusive, so it lands on the row that owns one', () => {
    expect(acceptLedgerTxnInput(txn, 'ledger-1', 'Groceries')).toEqual({
      synced_transaction_id: 'charge-1',
      status: 'linked_txn',
      transaction_id: 'ledger-1',
      category_override: 'Groceries',
    });
    expect(acceptLedgerTxnInput(txn, 'ledger-1', null).category_override).toBeNull();
  });

  it('ignoring records the charge and nothing else', () => {
    expect(ignoreInput(txn)).toEqual({ synced_transaction_id: 'charge-1', status: 'ignored' });
  });
});

describe('planSuggestionAccept — one routing decision, shared by the list and the deck', () => {
  it('follows the queue\'s own precedence: rule over plan over vehicle over your own entry', () => {
    const input = planSuggestionAccept(
      txn,
      {
        rule: monthlyRule,
        plan: { id: 'plan-1' },
        carCharge: { carFundId: 'f1', kind: 'loan_payment', vehicleName: 'Civic', amount: 300 },
        ledgerTxn: { id: 'ledger-1' },
      },
      null,
    );
    expect(input?.status).toBe('linked_rule');
  });

  it('routes a plan suggestion to the plan write', () => {
    expect(planSuggestionAccept(txn, { plan: { id: 'plan-1' } }, null)?.status).toBe('linked_plan');
  });

  it('routes a vehicle suggestion to the vehicle write, naming the charge kind', () => {
    const input = planSuggestionAccept(
      txn,
      { carCharge: { carFundId: 'f1', kind: 'loan_payment', vehicleName: 'Civic', amount: 300 } },
      null,
    );
    expect(input).toMatchObject({ status: 'linked_car', car_fund_id: 'f1', car_charge_kind: 'loan_payment' });
  });

  it('routes a ledger suggestion to the ledger write and carries the existing category through', () => {
    const input = planSuggestionAccept(
      txn,
      { ledgerTxn: { id: 'ledger-1' } },
      'Groceries',
    );
    expect(input).toMatchObject({ status: 'linked_txn', transaction_id: 'ledger-1', category_override: 'Groceries' });
  });

  it('returns NULL when there is no suggestion — a caller must never invent a decision', () => {
    expect(planSuggestionAccept(txn, null, null)).toBeNull();
    expect(planSuggestionAccept(txn, {}, null)).toBeNull();
  });
});
