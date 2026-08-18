// §1C — what these pin is the HONESTY of a proposal, not the arithmetic of one.
//
// A proposal is a first draft the user corrects, so the only failures that matter are the ones that
// put a rule in front of them they should never have been shown: a two-month coincidence, a bill an
// existing rule already covers, or a pattern with two equally good readings. Each of those has a
// test here, and each is written so that LOOSENING the threshold — the easy, wrong thing — fails it.

import { describe, it, expect } from 'vitest';
import {
  proposeRulesFromHistory, MIN_PROPOSAL_MONTHS, type HistoryCharge, type ProposalRule,
} from '../rules-from-history';
import { ruleInsertFromProposal } from '../rule-proposal-write';

/** Outflow positive, inflow negative — Stage A's convention, as it arrives from `synced_transactions`. */
const charge = (
  id: string, merchant: string, amount: number, date: string,
  account = 'acct-1', category: string | null = null,
): HistoryCharge => ({
  id, account_id: account, amount, date, name: merchant, merchant_name: merchant, category,
});

/** One charge a month on `day`, `months` long, ending at `endMonth`. */
function monthlyRun(
  merchant: string, amount: number | ((i: number) => number), day: number,
  months: string[], account = 'acct-1', category: string | null = null,
): HistoryCharge[] {
  return months.map((month, i) => charge(
    `${merchant}-${month}`.toLowerCase(),
    merchant,
    typeof amount === 'function' ? amount(i) : amount,
    `${month}-${String(day).padStart(2, '0')}`,
    account,
    category,
  ));
}

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08'];

const rule = (over: Partial<ProposalRule> & Pick<ProposalRule, 'id' | 'name' | 'amount'>): ProposalRule => ({
  frequency: 'monthly', rule_type: 'expense', due_day: 1, due_month: null,
  payment_source: 'acct-1', deposit_account: null, active: true,
  start_date: null, end_date: null, created_at: null,
  ...over,
});

describe('a monthly bill the app has no rule for', () => {
  it('is proposed with its merchant, its account, its day and a monthly cadence', () => {
    const out = proposeRulesFromHistory({ charges: monthlyRun('DUKE ENERGY', 120, 6, MONTHS), rules: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Duke Energy',
      merchantLabel: 'DUKE ENERGY',
      direction: 'expense',
      frequency: 'monthly',
      dueDay: 6,
      accountId: 'acct-1',
      months: MONTHS,
    });
    expect(out[0].amount).toBeCloseTo(120, 2);
  });

  it('names the MEDIAN of the recent window, so one double-billed month cannot set the rule', () => {
    // 100, 100, 100, then a month with a one-off extra on the same bill. The last-3 MEAN would
    // say 130; the median says what the bill actually is.
    const charges = monthlyRun('SPOTIFY', i => (i === 3 ? 190 : 100), 12, MONTHS);
    const out = proposeRulesFromHistory({ charges, rules: [] });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(100);
  });
});

describe('the thresholds, which exist to keep a coincidence off the screen', () => {
  it(`says NOTHING about a run shorter than ${MIN_PROPOSAL_MONTHS} consecutive months`, () => {
    const charges = monthlyRun('NEW GYM', 45, 9, ['2026-07', '2026-08']);
    expect(proposeRulesFromHistory({ charges, rules: [] })).toEqual([]);
  });

  it('says nothing when the months are not CONSECUTIVE', () => {
    const charges = monthlyRun('ODD BILL', 45, 9, ['2026-04', '2026-06', '2026-08']);
    expect(proposeRulesFromHistory({ charges, rules: [] })).toEqual([]);
  });

  it('says nothing about a merchant that billed twice in one of the months', () => {
    const charges = [
      ...monthlyRun('PUBLIX', 60, 4, MONTHS),
      charge('publix-extra', 'PUBLIX', 61, '2026-07-19'),
    ];
    expect(proposeRulesFromHistory({ charges, rules: [] })).toEqual([]);
  });

  it('says nothing when the amounts are too far apart to be one bill', () => {
    // 20, 20, 20, 200 — outside the band around the median, so there is no amount to propose.
    const charges = monthlyRun('WIDE SWING', i => (i === 3 ? 200 : 20), 8, MONTHS);
    expect(proposeRulesFromHistory({ charges, rules: [] })).toEqual([]);
  });

  it('says nothing about a bill that stopped months before the feed ends', () => {
    const charges = [
      ...monthlyRun('OLD SUB', 15, 2, ['2026-01', '2026-02', '2026-03']),
      ...monthlyRun('CURRENT SUB', 30, 5, MONTHS),
    ];
    const out = proposeRulesFromHistory({ charges, rules: [] });
    expect(out.map(p => p.merchantLabel)).toEqual(['CURRENT SUB']);
  });
});

describe('income is read off the deposits, and lands on the right side of the rule', () => {
  it('proposes an income rule from a run of deposits', () => {
    const charges = monthlyRun('ACME PAYROLL', -2400, 1, MONTHS);
    const out = proposeRulesFromHistory({ charges, rules: [] });
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe('income');
    expect(out[0].amount).toBeCloseTo(2400, 2);
  });

  it('writes an income proposal into `deposit_account`, never `payment_source`', () => {
    const charges = monthlyRun('ACME PAYROLL', -2400, 1, MONTHS);
    const [proposal] = proposeRulesFromHistory({ charges, rules: [] });
    const insert = ruleInsertFromProposal(proposal);
    expect(insert.rule_type).toBe('income');
    expect(insert.deposit_account).toBe('acct-1');
    expect(insert.payment_source).toBeNull();
  });

  it('writes an expense proposal into `payment_source`, never `deposit_account`', () => {
    const charges = monthlyRun('DUKE ENERGY', 120, 6, MONTHS);
    const [proposal] = proposeRulesFromHistory({ charges, rules: [] });
    const insert = ruleInsertFromProposal(proposal);
    expect(insert.rule_type).toBe('expense');
    expect(insert.payment_source).toBe('acct-1');
    expect(insert.deposit_account).toBeNull();
    expect(insert.active).toBe(true);
  });
});

describe('a merchant an existing rule already covers is never proposed', () => {
  it('excludes a merchant the app\'s own matcher settles against a rule', () => {
    const charges = monthlyRun('INVITATIONHOMES', 1915, 3, MONTHS);
    const rules = [rule({ id: 'r1', name: 'Rent', amount: 1915, due_day: 3 })];
    expect(proposeRulesFromHistory({ charges, rules })).toEqual([]);
  });

  it('excludes a merchant a DRIFTING rule is already about — the rule is wrong, not missing', () => {
    // $100 rule against a ~$140 bill: far outside the matcher's 1% band, so only the drift
    // detector can see the two belong together. Proposing a second rule here would double-count.
    const charges = monthlyRun('DUKE ENERGY', 140, 6, MONTHS);
    const rules = [rule({ id: 'r2', name: 'Electricity', amount: 100, due_day: 6 })];
    expect(proposeRulesFromHistory({ charges, rules })).toEqual([]);
  });

  it('excludes a merchant whose name is already a rule\'s name', () => {
    const charges = monthlyRun('NETFLIX', 22.99, 14, MONTHS);
    const rules = [rule({ id: 'r3', name: 'Netflix', amount: 15.49, due_day: 28, payment_source: 'acct-9' })];
    expect(proposeRulesFromHistory({ charges, rules })).toEqual([]);
  });

  it('excludes a merchant the user has LINKED to a rule by hand', () => {
    const charges = monthlyRun('CITY WATER', 61, 11, MONTHS);
    const rules = [rule({ id: 'r4', name: 'Water', amount: 30, due_day: 1, payment_source: 'acct-9' })];
    const links = charges.map(c => ({ synced_transaction_id: c.id, status: 'linked_rule', rule_id: 'r4' }));
    expect(proposeRulesFromHistory({ charges, rules, links })).toEqual([]);
  });
});

describe('two readings of one pattern means neither is offered', () => {
  it('stays silent when the same merchant qualifies on two accounts', () => {
    // The card would have to name ONE account, and the history says two. Picking the longer run or
    // the newer one is a coin flip that writes a rule against an account the bill may not be on.
    const charges = [
      ...monthlyRun('T MOBILE', 90, 7, MONTHS, 'acct-1'),
      ...monthlyRun('T MOBILE', 90, 7, MONTHS.slice(1), 'acct-2'),
    ];
    expect(proposeRulesFromHistory({ charges, rules: [] })).toEqual([]);
  });

  it('still proposes the OTHER merchants when one is ambiguous', () => {
    const charges = [
      ...monthlyRun('T MOBILE', 90, 7, MONTHS, 'acct-1'),
      ...monthlyRun('T MOBILE', 90, 7, MONTHS, 'acct-2'),
      ...monthlyRun('DUKE ENERGY', 120, 6, MONTHS),
    ];
    expect(proposeRulesFromHistory({ charges, rules: [] }).map(p => p.merchantLabel)).toEqual(['DUKE ENERGY']);
  });
});

describe('the cadences the app can already place', () => {
  it('proposes a biweekly rule from a 14-day rhythm, anchored on the first charge it saw', () => {
    const dates = ['2026-05-08', '2026-05-22', '2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17', '2026-07-31', '2026-08-14'];
    const charges = dates.map((d, i) => charge(`pay-${i}`, 'ACME PAYROLL', -1200, d));
    const out = proposeRulesFromHistory({ charges, rules: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ frequency: 'biweekly', direction: 'income', anchorDate: '2026-05-08' });
    // `due_day` is a day of the WEEK for biweekly — Friday, as every one of those dates is.
    expect(out[0].dueDay).toBe(5);
  });

  it('proposes a weekly rule from a 7-day rhythm', () => {
    const charges: HistoryCharge[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 4, 6 + i * 7);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      charges.push(charge(`gas-${i}`, 'WAWA', 48, iso));
    }
    const out = proposeRulesFromHistory({ charges, rules: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ frequency: 'weekly', dueDay: 3 });
  });
});

describe('rows the detector must not read at all', () => {
  it('ignores charges with no account and charges with no merchant', () => {
    const noAccount = monthlyRun('GHOST', 20, 4, MONTHS).map(c => ({ ...c, account_id: null }));
    const noMerchant = monthlyRun('  ', 20, 4, MONTHS).map(c => ({ ...c, name: '', merchant_name: null }));
    expect(proposeRulesFromHistory({ charges: [...noAccount, ...noMerchant], rules: [] })).toEqual([]);
  });
});
