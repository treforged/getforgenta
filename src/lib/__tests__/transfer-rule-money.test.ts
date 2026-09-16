// THE ACCEPTANCE TEST FOR "a transfer to my own linked account is booked as spending".
//
// ⚠️ IT ASSERTS A NUMBER, NOT A LABEL, AND THAT IS THE WHOLE POINT. A test that only checked
// `rule_type` changed from `expense` to `investment` would pass while every figure a person
// actually reads — living spending, the savings rate, the forecast engine's inputs, the cash floor
// — stayed exactly as wrong as it was. So this walks the real chain end to end:
//
//   proposeRulesFromHistory -> ruleInsertFromProposal -> generateMonthTransactionsFromRules
//   -> buildMonthlyExpenseModel -> `living`
//
// and requires `living` to FALL by the transfer amount while `transfers` RISES by it.
//
// ⚠️ THE RED ARM IS IN THE FILE, NOT IN A COMMIT MESSAGE. `withoutAccounts` is the code exactly as
// it shipped — the same charges with no `accounts` passed — and it is asserted to still produce the
// defect. A green suite here only means something because the pair discriminates; without the red
// arm, a `detectTransferLegs` that returned an empty map for every input would pass every other
// assertion in this file that matters.
//
// BUILT FROM THE REAL ROWS (Tre's profile, read 2026-09-16): three $25 `TRANSFER_OUT` charges on
// CHASE CHECKING named `FID BKG SVC LLC MONEYLINE PPD ID: 0368004600`, merchant `Fidelity`, on
// 2026-07-15, 2026-08-17 and 2026-09-15, against a `brokerage` account "Fidelity Go Automated".
//
// ⚠️ AND THE DESTINATION HAS NO TRANSACTION FEED, WHICH IS WHY THE PAIR DETECTOR IS NOT THE FIX.
// That account holds ZERO `synced_transactions` rows — Plaid returns holdings for it, not a feed —
// so there is no inflow leg to pair against. This fixture reproduces that: nothing at all is on the
// Fidelity account. A fix built only on `detectTransferPairs` passes its own tests and leaves this
// number untouched.

import { describe, it, expect } from 'vitest';
import { proposeRulesFromHistory, type HistoryCharge } from '@/lib/rules-from-history';
import { ruleInsertFromProposal } from '@/lib/rule-proposal-write';
import { generateMonthTransactionsFromRules } from '@/lib/pay-schedule';
import { buildMonthlyExpenseModel } from '@/lib/monthly-expense-model';
import type { PairableAccount } from '@/lib/transfer-pair-detection';

const CHASE = '933cbc10-bceb-4c20-8227-4a02e6db728a';
const FIDELITY = 'eb3f82fe-79ac-4d86-9e4a-2b626eda6ef6';
const SAVINGS = '36997c1c-0de7-45a5-8806-655bdcc78893';

const ACCOUNTS: PairableAccount[] = [
  { id: CHASE, name: 'CHASE CHECKING', account_type: 'checking' },
  { id: FIDELITY, name: 'Fidelity Go Automated', account_type: 'brokerage' },
  { id: SAVINGS, name: 'Savings Account', account_type: 'savings' },
];

/** The three charges, exactly as the provider returns them. Outflow-positive, per Stage A. */
const FIDELITY_RUN: HistoryCharge[] = ['2026-07-15', '2026-08-17', '2026-09-15'].map((date, i) => ({
  id: `fid-${i}`,
  account_id: CHASE,
  amount: 25,
  date,
  name: 'FID BKG SVC LLC MONEYLINE PPD ID: 0368004600',
  merchant_name: 'Fidelity',
  category: 'TRANSFER_OUT',
}));

/** An ordinary recurring purchase, so the month has spending for the transfer to be absent from. */
const GROCERY_RUN: HistoryCharge[] = ['2026-07-10', '2026-08-10', '2026-09-10'].map((date, i) => ({
  id: `pub-${i}`,
  account_id: CHASE,
  amount: 140,
  date,
  name: 'PUBLIX SUPER MARKET',
  merchant_name: 'Publix',
  category: 'GENERAL_MERCHANDISE',
}));

/** Proposal -> accepted rule row, as the accept button writes it. */
function acceptedRules(charges: HistoryCharge[], accounts: PairableAccount[]) {
  const proposals = proposeRulesFromHistory({ charges, rules: [], accounts });
  return proposals.map(p => {
    const draft = ruleInsertFromProposal(p);
    return {
      id: `rule-${p.id}`,
      user_id: 'u1',
      created_at: draft.start_date,
      ...draft,
    };
  });
}

/** `living` and `transfers` for September 2026, from rules alone. */
function septemberModel(rules: ReturnType<typeof acceptedRules>) {
  const monthTxns = generateMonthTransactionsFromRules(
    rules as never,
    ACCOUNTS as never,
    2026,
    8, // 0-indexed September
  );
  return buildMonthlyExpenseModel({
    monthTxns,
    paymentPlans: [],
    carFunds: [],
    creditCardSourceIds: new Set<string>(),
    asOf: new Date(2026, 8, 30),
  });
}

describe('a standing transfer to an account the user owns is not spending', () => {
  const charges = [...FIDELITY_RUN, ...GROCERY_RUN];

  it('RED ARM — with no accounts passed, the $25 is still counted as living spending', () => {
    // This is the shipped behaviour. If this ever goes green on its own, the fix below is no longer
    // being measured by anything and the assertions after it prove nothing.
    const rules = acceptedRules(charges, []);
    const fidelity = rules.find(r => r.name.toLowerCase().includes('fidelity'));
    expect(fidelity, 'the Fidelity run must still be proposed at all').toBeDefined();
    expect(fidelity!.rule_type).toBe('expense');

    const model = septemberModel(rules);
    expect(model.living).toBe(165); // 140 groceries + 25 transfer, the defect
    expect(model.transfers).toBe(0);
  });

  it('GREEN ARM — with accounts passed, living FALLS by exactly the transfer amount', () => {
    const rules = acceptedRules(charges, ACCOUNTS);
    const model = septemberModel(rules);

    expect(model.living).toBe(140); // groceries only — 25 less than the red arm
    expect(model.transfers).toBe(25);
    // The money still LEFT the account, so the cash view is unchanged. A fix that quietly lost the
    // $25 altogether would satisfy the two assertions above and be a worse bug than the one fixed.
    expect(model.expensesAllIn).toBe(165);
  });

  it('a brokerage destination is typed `investment`, and the destination is recorded', () => {
    const [proposal] = proposeRulesFromHistory({
      charges: FIDELITY_RUN, rules: [], accounts: ACCOUNTS,
    });
    expect(proposal.transfer).toEqual({
      ruleType: 'investment',
      destination: ACCOUNTS[1],
      // `name`, not `pair` — the destination has no feed, so nothing could have been paired.
      via: 'name',
    });

    const draft = ruleInsertFromProposal(proposal);
    expect(draft.rule_type).toBe('investment');
    // The account the money LEFT stays in `payment_source`, so `ruleChargeAccountId` resolves this
    // rule exactly as it did before and no existing charge match can move.
    expect(draft.payment_source).toBe(CHASE);
    expect(draft.deposit_account).toBe(FIDELITY);
  });

  it('an ordinary purchase is untouched, even sitting beside a transfer', () => {
    const proposals = proposeRulesFromHistory({ charges, rules: [], accounts: ACCOUNTS });
    const publix = proposals.find(p => /publix/i.test(p.merchantLabel));
    // POSITIVE CONTROL ON THE LOOKUP. A `find` that matches nothing returns undefined, and an
    // undefined proposal has no `transfer` field either — so without this line the two assertions
    // below would pass just as happily against a broken matcher as against a correct app.
    expect(publix, 'the matcher must find the grocery proposal').toBeDefined();
    expect(publix!.transfer).toBeUndefined();
    expect(ruleInsertFromProposal(publix!).rule_type).toBe('expense');
  });
});

describe('one movement is ONE rule, not two', () => {
  // ⚠️ THE DOUBLE COUNT IS REAL AND WAS MEASURED, NOT IMAGINED. A credit-card autopay posts twice -
  // money leaves checking and arrives at the card - and the two banks name it differently ("Payment
  // to Chase card ending in 56" vs "Payment Thank You-Mobile"). `rules-from-history` groups by
  // merchant, so before this the same movement produced TWO proposals: a correct transfer out of
  // checking AND $941.01 a month of PHANTOM INCOME on the card. Accepting both inflates income and
  // the savings rate - the same family of defect as the one this file's first describe() fixes, and
  // made more visible by fixing it.
  //
  // ⚠️ AND MY FIRST PROBE SAID THERE WAS NO DOUBLE COUNT, for a reason unrelated to the question.
  // It used ONE merchant name for both legs, which trips the existing "a merchant billing on two
  // accounts leaves every claimant silent" rule - so it returned zero proposals and read as clean.
  // Only DISTINCT names, which is the realistic case, exposes it. A zero from a fixture that cannot
  // contain the failure is a fact about the fixture.
  const CARD = 'card-1';
  const PAIR_ACCOUNTS: PairableAccount[] = [
    { id: CHASE, name: 'CHASE CHECKING', account_type: 'checking' },
    { id: CARD, name: 'Prime Visa', account_type: 'credit_card' },
  ];
  const autopay: HistoryCharge[] = [];
  for (const [i, date] of ['2026-07-15', '2026-08-15', '2026-09-15'].entries()) {
    autopay.push({
      id: `out-${i}`, account_id: CHASE, amount: 941.01, date,
      name: 'Payment to Chase card ending in 56', merchant_name: 'Chase Card Payment',
      category: 'LOAN_PAYMENTS',
    });
    autopay.push({
      id: `in-${i}`, account_id: CARD, amount: -941.01, date,
      name: 'Payment Thank You-Mobile', merchant_name: 'Payment Thank You', category: 'INCOME',
    });
  }

  it('RED ARM — with no accounts passed, the card leg is still proposed as phantom income', () => {
    const shapes = proposeRulesFromHistory({ charges: autopay, rules: [], accounts: [] })
      .map(p => `${p.direction}|${p.accountId}`);
    expect(shapes).toContain(`income|${CARD}`); // $941.01 a month that does not exist
    expect(shapes).toContain(`expense|${CHASE}`);
  });

  it('GREEN ARM — the mirrored inflow is not proposed, and the outflow is the transfer', () => {
    const out = proposeRulesFromHistory({ charges: autopay, rules: [], accounts: PAIR_ACCOUNTS });
    expect(out.map(p => `${p.direction}|${p.accountId}`)).toEqual([`expense|${CHASE}`]);
    // Paired, not name-matched: both legs are synced here, so the strong signal is what fired.
    expect(out[0].transfer?.via).toBe('pair');
    expect(out[0].transfer?.ruleType).toBe('transfer');
  });

  it('an UNPAIRED inflow is still proposed — suppressing it would delete the movement', () => {
    // Only the card's side exists. Nothing represents this money if the inflow is dropped, so the
    // suppression is deliberately PAIRS ONLY and never the one-sided name signal.
    const inflowOnly = autopay.filter(c => c.id.startsWith('in-'));
    const out = proposeRulesFromHistory({ charges: inflowOnly, rules: [], accounts: PAIR_ACCOUNTS });
    expect(out.map(p => p.direction)).toEqual(['income']);
  });
});

describe('the guards that keep the one-sided signal narrow', () => {
  const run = (over: Partial<HistoryCharge>, accounts = ACCOUNTS) =>
    proposeRulesFromHistory({
      charges: FIDELITY_RUN.map(c => ({ ...c, ...over })), rules: [], accounts,
    })[0];

  it('refuses a row the provider did not call a transfer', () => {
    // Same merchant, same account, same rhythm — only the provider's category differs. `OTHER` is
    // an admission of ignorance, and `transfer-pair-detection` says so in as many words.
    expect(run({ category: 'OTHER' })?.transfer).toBeUndefined();
    expect(run({ category: 'GENERAL_SERVICES' })?.transfer).toBeUndefined();
  });

  it('refuses a row that names no account the user owns', () => {
    expect(run({ merchant_name: 'Venmo', name: 'VENMO PAYMENT' })?.transfer).toBeUndefined();
  });

  it('refuses a self-match — a CHASE row on the CHASE account is not a destination', () => {
    expect(run({ merchant_name: 'Chase', name: 'CHASE ONLINE TRANSFER' })?.transfer).toBeUndefined();
  });

  it('refuses a contested name — two accounts match, so neither is claimed', () => {
    // This profile really does hold two accounts called "Robinhood individual".
    const contested: PairableAccount[] = [
      ...ACCOUNTS,
      { id: 'rh-1', name: 'Robinhood individual', account_type: 'brokerage' },
      { id: 'rh-2', name: 'Robinhood individual', account_type: 'brokerage' },
    ];
    expect(run({ merchant_name: 'Robinhood', name: 'ROBINHOOD TRANSFER' }, contested)?.transfer)
      .toBeUndefined();
  });

  it('refuses a generic word — "Savings Account" must not match every row saying SAVINGS', () => {
    expect(run({ merchant_name: 'Savings', name: 'AUTOMATIC SAVINGS TRANSFER' })?.transfer)
      .toBeUndefined();
  });

  it('a non-investment destination is typed `transfer`, not `investment`', () => {
    const accounts: PairableAccount[] = [
      { id: CHASE, name: 'CHASE CHECKING', account_type: 'checking' },
      { id: SAVINGS, name: 'Alliant Vault', account_type: 'savings' },
    ];
    const proposal = run({ merchant_name: 'Alliant', name: 'ALLIANT TRANSFER' }, accounts);
    expect(proposal?.transfer?.ruleType).toBe('transfer');
  });

  it('refuses a run that is not UNANIMOUS — two transfers and a purchase is not a transfer rule', () => {
    const mixed = FIDELITY_RUN.map((c, i) => (i === 1 ? { ...c, category: 'GENERAL_SERVICES' } : c));
    const proposal = proposeRulesFromHistory({ charges: mixed, rules: [], accounts: ACCOUNTS })[0];
    expect(proposal).toBeDefined();
    expect(proposal.transfer).toBeUndefined();
  });
});
