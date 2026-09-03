// §1A Stage C part 2 — the ENGINE half of the month-0 car gates.
//
// `useCardProjection.captureEvidence.test.ts` covers the hook. This covers `calculateForecast`,
// and the pair exists for one reason: finding §1.1 cause C was these two surfaces gating the SAME
// car loan in the SAME month and disagreeing ($537 charged by Forecast, dropped by the Dashboard;
// then `<=` vs `<` for a charge due exactly on the cutoff). A shared helper is only half the fix —
// the other half is proving both callers actually reach it with the same answer.
//
// Rides the real captured inputs for the ~30 fields the engine needs, but SUBSTITUTES its own
// synthetic loan-phase car fund so the assertions do not depend on what Tre's vehicles happened to
// look like on capture day. Self-skips without the fixture (gitignored), matching the Tier-A
// golden test and the other engine tests in this directory.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import type { MatchableTransaction } from '@/lib/transaction-matching';
import type { CarFund } from '@/lib/types';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

const LOAN_ACCT_ID = 'loan-acct-evidence-test';
const INSURANCE = 150;

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The engine reads `new Date()` internally, so everything is anchored to the fixture's capture
 * instant rather than to today — the same clock-pinning the golden test does.
 */
function buildScenario(at: Date) {
  const dueDate = ymd(new Date(at.getFullYear(), at.getMonth(), 1));
  // Late enough in the month that the DATE HEURISTIC alone calls the 1st "captured" (1 < 28 − 3),
  // so the baseline is a real drop and every assertion below is a departure from it.
  const syncCutoffDate = ymd(new Date(at.getFullYear(), at.getMonth(), 28));

  const carFund = {
    id: 'car-evidence-1', vehicle_name: 'Evidence Test Car', phase: 'loan',
    target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0, gift_contribution: 0,
    loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
    loan_start_date: dueDate, payment_start_date: dueDate, interest_start_date: dueDate,
    actual_monthly_payment: 0, monthly_insurance: INSURANCE,
    linked_account: null, linked_rule_id: null, loan_payment_account: LOAN_ACCT_ID,
    insurance_start_date: null, planned_purchase_date: null,
    lump_sum_payments: [],
  } as unknown as CarFund;

  const loanPayment = getTotalCarLoanMonthly([carFund], at);

  let seq = 0;
  const txn = (over: Partial<MatchableTransaction>): MatchableTransaction => ({
    id: `t${seq++}`, account_id: LOAN_ACCT_ID, amount: 0, date: dueDate, pending: false, ...over,
  });
  // Settled rows spanning the whole ±DATE_WINDOW_DAYS (5) window, both ends, with junk amounts
  // that cannot accidentally match either charge.
  const coverage = (): MatchableTransaction[] => [
    txn({ date: ymd(new Date(at.getFullYear(), at.getMonth(), 1 - 6)), amount: 12.34 }),
    txn({ date: ymd(new Date(at.getFullYear(), at.getMonth(), 1 + 6)), amount: 56.78 }),
  ];

  return { at, carFund, loanPayment, syncCutoffDate, txn, coverage };
}

/**
 * The two month-0 vehicle charges the engine actually applied, kept SEPARATE rather than summed.
 * They are gated independently — same due date and account, distinguished only by amount — so a
 * total would let one gate's regression hide inside the other's.
 */
function month0CarCharges(
  inputs: ForecastInputs,
  carFund: CarFund,
  syncCutoffDate: string,
  syncedTransactions?: readonly MatchableTransaction[],
): { loan: number; insurance: number } {
  const { data } = calculateForecast({
    ...inputs, carFunds: [carFund], syncCutoffDate, syncedTransactions,
  });
  const row = data[0] as unknown as Record<string, number>;
  return { loan: row.carLoanPayment ?? 0, insurance: row.vehicleInsurance ?? 0 };
}

describe('forecast-engine — §1A Stage C capture evidence (real inputs, synthetic car)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('honours transaction evidence at the month-0 car gates, matching useCardProjection', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers();
    vi.setSystemTime(clock);

    const { at, carFund, loanPayment, syncCutoffDate, txn, coverage } = buildScenario(clock);
    expect(loanPayment).toBeGreaterThan(0);
    const charge = (t?: readonly MatchableTransaction[]) =>
      month0CarCharges(inputs, carFund, syncCutoffDate, t);
    const DROPPED = { loan: 0, insurance: 0 };

    // Baseline: the date heuristic alone drops both charges. Guard on the guard — without this,
    // every assertion below could pass for the wrong reason.
    expect(charge(undefined)).toEqual(DROPPED);

    // No rows ⇒ byte-identical to pre-Stage-C. This is the number-neutrality guarantee that let
    // part 2 ship against live data where no checking account has synced transactions yet.
    expect(charge([])).toEqual(DROPPED);

    // Rows on another account say nothing about a loan debited from `loan_payment_account`.
    expect(charge(coverage().map(t => ({ ...t, account_id: 'some-other-account' })))).toEqual(DROPPED);

    // COVERED BUT UNMATCHED — the branch that moves a number. The window has been fully observed
    // and neither charge is in it, so both genuinely have not hit and stay in month 0, overriding
    // the heuristic's assumption that an old due date must have settled.
    const bothKept = charge(coverage());
    expect(bothKept.loan).toBeCloseTo(loanPayment, 2);
    expect(bothKept.insurance).toBeCloseTo(INSURANCE, 2);

    // MATCHED — a settled debit is the fact the heuristic was approximating. The two charges share
    // a due date and an account; only the amount separates them, so each drops independently while
    // the other stays covered-and-unmatched.
    const loanMatched = charge([...coverage(), txn({ amount: loanPayment })]);
    expect(loanMatched.loan).toBe(0);
    expect(loanMatched.insurance).toBeCloseTo(INSURANCE, 2);

    const insuranceMatched = charge([...coverage(), txn({ amount: INSURANCE })]);
    expect(insuranceMatched.insurance).toBe(0);
    expect(insuranceMatched.loan).toBeCloseTo(loanPayment, 2);

    // A pending debit is not evidence: `balances.current` excludes it, so it must not be assumed
    // gone, and it must not stretch the observed coverage range either.
    const pendingOnly = charge([...coverage(), txn({ amount: loanPayment, pending: true })]);
    expect(pendingOnly.loan).toBeCloseTo(loanPayment, 2);
    expect(pendingOnly.insurance).toBeCloseTo(INSURANCE, 2);

    // A match a few days off the due date counts even with NO coverage at all — coverage requires
    // the whole window observed, so a real transaction can land just outside it. The premium, with
    // neither a match nor coverage, correctly falls all the way back to the date heuristic and is
    // dropped: the two gates take different branches from the same single-row evidence set.
    const late = ymd(new Date(at.getFullYear(), at.getMonth(), 4));
    expect(charge([txn({ amount: loanPayment, date: late })])).toEqual(DROPPED);
  });
});
