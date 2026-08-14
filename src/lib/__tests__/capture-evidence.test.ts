// §1A Stage C part 2 — `carChargeEvidence`, the one helper both month-0 car gates call.
//
// The single most important guarantee here is the FIRST describe block: with no rows, the function
// must return `undefined` rather than `{hasTxnCoverage:false, matched:false}`. Those two values
// take the same branch of `isCapturedInBalance` today, so a test that only checked behavior would
// pass either way — but `undefined` is what makes "this user has no synced transactions" and "this
// caller was never wired up" provably identical to pre-Stage-C at the type level, and it is the
// reason part 2 could ship number-neutral. Asserting the value, not just the effect, is deliberate.

import { describe, it, expect } from 'vitest';
import { carChargeEvidence } from '../capture-evidence';
import type { MatchableTransaction } from '../transaction-matching';

const LOAN_ACCT = 'loan-acct-1';
const FUNDING_ACCT = 'checking-1';
const DUE_DATE = '2026-08-15';
const AMOUNT = 422.89;

let txnSeq = 0;
function txn(over: Partial<MatchableTransaction> & { account_id: string }): MatchableTransaction {
  return {
    id: `t${txnSeq++}`,
    amount: AMOUNT,
    date: DUE_DATE,
    pending: false,
    ...over,
  };
}

/** Settled rows spanning the WHOLE ±DATE_WINDOW_DAYS (5) window, both ends — what `hasCoverage`
 * demands. 6 days out on each side, so the bound is cleared rather than sat exactly on. */
function coverageRows(accountId: string): MatchableTransaction[] {
  return [
    txn({ account_id: accountId, date: '2026-08-09', amount: 12.34 }),
    txn({ account_id: accountId, date: '2026-08-21', amount: 56.78 }),
  ];
}

describe('carChargeEvidence — no rows means "ask the date heuristic"', () => {
  it('returns undefined when transactions are absent entirely (an unwired caller)', () => {
    expect(carChargeEvidence({ loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT, undefined))
      .toBeUndefined();
  });

  it('returns undefined for an empty array (a user whose backfill has not landed)', () => {
    expect(carChargeEvidence({ loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT, []))
      .toBeUndefined();
  });

  it('returns undefined when no account can be resolved at all', () => {
    // Unattributed: neither the car's own payment account nor a forecast funding account. There is
    // nothing to look for the charge on, so this must fall back rather than answer from nothing.
    expect(carChargeEvidence({ loan_payment_account: null }, AMOUNT, DUE_DATE, null, coverageRows(LOAN_ACCT)))
      .toBeUndefined();
  });
});

describe('carChargeEvidence — account resolution', () => {
  it('uses car_funds.loan_payment_account when set, in preference to the funding account', () => {
    // Coverage exists on the LOAN account only. Reading the funding account instead would report
    // no coverage, so this asserts which id was actually consulted, not merely that one was.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT, coverageRows(LOAN_ACCT),
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('falls back to the forecast funding account when loan_payment_account is null', () => {
    // Documented meaning of null: "the payment comes from the generic liquid-cash pool".
    const evidence = carChargeEvidence(
      { loan_payment_account: null }, AMOUNT, DUE_DATE, FUNDING_ACCT, coverageRows(FUNDING_ACCT),
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('normalizes an `account:`-prefixed loan_payment_account', () => {
    // Live rows are bare uuids, but demo fixtures and legacy call sites still carry the prefix.
    const evidence = carChargeEvidence(
      { loan_payment_account: `account:${LOAN_ACCT}` }, AMOUNT, DUE_DATE, FUNDING_ACCT, coverageRows(LOAN_ACCT),
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('does not see transactions belonging to a different account', () => {
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT,
      [...coverageRows('someone-elses-account'), txn({ account_id: 'someone-elses-account' })],
    );
    expect(evidence).toEqual({ hasTxnCoverage: false, matched: false });
  });
});

describe('carChargeEvidence — the two booleans', () => {
  it('reports matched when a settled transaction corresponds to the charge', () => {
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT,
      [...coverageRows(LOAN_ACCT), txn({ account_id: LOAN_ACCT })],
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: true });
  });

  it('reports covered-but-unmatched — the branch that moves a number', () => {
    // The window has been fully observed and the charge is not in it. This is the only combination
    // that overrides the date heuristic toward "NOT captured", i.e. keeps the charge in month 0.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT, coverageRows(LOAN_ACCT),
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('reports a match even when the window is not fully covered', () => {
    // Coverage requires the WHOLE window observed, so a real match can land just outside it. A
    // transaction that exists outranks a conservatism about window completeness.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT, [txn({ account_id: LOAN_ACCT })],
    );
    expect(evidence).toEqual({ hasTxnCoverage: false, matched: true });
  });

  it('ignores pending rows for both coverage and matching', () => {
    // A pending debit is absent from `balances.current` — it is the very thing §1A stops guessing
    // about, so it must neither stretch the observed range nor satisfy the charge.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT,
      [
        txn({ account_id: LOAN_ACCT, date: '2026-08-09', pending: true }),
        txn({ account_id: LOAN_ACCT, date: '2026-08-21', pending: true }),
        txn({ account_id: LOAN_ACCT, pending: true }),
      ],
    );
    expect(evidence).toEqual({ hasTxnCoverage: false, matched: false });
  });

  it('does not match an inflow of the same size', () => {
    // Stage A normalizes to outflow-positive. A refund or deposit must never satisfy a payment.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT,
      [...coverageRows(LOAN_ACCT), txn({ account_id: LOAN_ACCT, amount: -AMOUNT })],
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('does not match two equally good candidates', () => {
    // A coin flip presented as evidence is worse than silence — the three identical $10 tolls on
    // one day in Tre's real data are why this is a hard rule.
    const evidence = carChargeEvidence(
      { loan_payment_account: LOAN_ACCT }, AMOUNT, DUE_DATE, FUNDING_ACCT,
      [...coverageRows(LOAN_ACCT), txn({ account_id: LOAN_ACCT }), txn({ account_id: LOAN_ACCT })],
    );
    expect(evidence).toEqual({ hasTxnCoverage: true, matched: false });
  });
});
