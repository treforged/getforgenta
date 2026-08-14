// §1A Stage C part 2 — the ONE way a car-fund month-0 charge asks for transaction evidence.
//
// Lives in its own module, imported by BOTH `forecast-engine.ts` and `useCardProjection.ts`, for
// the reason finding §1.1 cause C exists at all: those two surfaces gate the SAME car loan in the
// SAME month, and every time they have derived a shared predicate independently they have drifted
// (the $537 payment, then `<=` vs `<`). One function, two callers, no room to disagree.
//
// ACCOUNT RESOLUTION. `car_funds.loan_payment_account` is the account the loan is actually debited
// from; it is nullable, and null documented to mean "the generic liquid-cash pool", so the forecast
// funding account is the fallback. Getting this wrong is not dangerous — an id with no transactions
// simply has no coverage and no match, which is the date heuristic — but getting it right is what
// makes the evidence real.

import { buildCaptureEvidence, normalizePaymentSource, type MatchableTransaction } from './transaction-matching';
import type { CaptureEvidence } from './sync-cutoff';

/** The `car_funds` fields this reads. Structurally satisfied by `CarFund`. */
export type CarChargeAccountSource = { loan_payment_account: string | null };

/**
 * Evidence for one dated car-fund outflow, or `undefined` to mean "ask the date heuristic".
 *
 * Returning `undefined` — rather than `{ hasTxnCoverage: false, matched: false }` — when there are
 * no rows to consult is deliberate: it makes the no-transactions path provably identical to
 * pre-Stage-C behavior at the type level, so a caller that has not been wired up yet and a user
 * whose backfill has not landed take the exact same branch of `isCapturedInBalance`.
 *
 * `amount` must be the REGULAR payment with lump sums excluded (`getActiveCarLoanPayments` already
 * subtracts them) — a lump sum is a separate debit at the bank, and folding it in would look for a
 * combined charge that never posts as one transaction.
 */
export function carChargeEvidence(
  cf: CarChargeAccountSource,
  amount: number,
  dueDate: string,
  fundingAccountId: string | null,
  txns: readonly MatchableTransaction[] | undefined,
): CaptureEvidence | undefined {
  if (!txns || txns.length === 0) return undefined;
  const accountId = normalizePaymentSource(cf.loan_payment_account) ?? fundingAccountId;
  if (!accountId) return undefined;
  return buildCaptureEvidence({ accountId, amount, dueDate }, txns);
}
