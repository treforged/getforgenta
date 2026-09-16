// §1C — is this recurring charge MONEY MOVING BETWEEN ACCOUNTS THE USER OWNS, rather than spending?
//
// WHY THIS EXISTS. `rules-from-history.ts` proposes a rule from any merchant billing three months
// in a row, and `rule-proposal-write.ts` takes `rule_type` straight from the direction. So a $25
// standing transfer from CHASE CHECKING to a Fidelity brokerage was offered as a variable expense —
// inflating living spending, understating the savings rate, and feeding the forecast engine and the
// cash floor a number that is simply not a cost.
//
// ⚠️ WHY IT IS NOT JUST `detectTransferPairs`. The obvious design — reuse the pair detector, which
// already matches a debit in one linked account against the credit in another — CANNOT SEE THIS
// CASE AT ALL, and the reason is measured rather than argued: on 2026-09-16 the Fidelity account
// held ZERO `synced_transactions` rows. Plaid returns holdings for it, not a transaction feed.
// There is no inflow leg, so there is nothing to pair, and a fix built only on pairing would have
// passed its own tests and left the number exactly as wrong as it was. Linking the destination did
// not help, and that is precisely what the complaint was about.
//
// SO THERE ARE TWO SIGNALS, and the second is the one that actually reaches this case:
//   A. THE PAIR. Both legs synced — `detectTransferPairs` says they are one movement. The strong
//      signal, and it covers credit-card autopay, where the destination does have a feed.
//   B. THE NAME, gated by the provider's category. The row is explicitly `TRANSFER_OUT`/`TRANSFER`
//      AND its text names exactly one account the user owns. One-sided, so it is deliberately the
//      narrower rule of the two — see the three guards on `namedOwnedAccount`.
//
// ⚠️ OUTFLOWS ONLY, AND THAT IS A CORRECTNESS CONSTRAINT, NOT A SCOPE CUT. `pay-schedule.ts:1437`
// computes `txType = rule_type === 'income' ? 'income' : 'expense'`, so ANY rule typed `transfer`
// generates an expense-shaped transaction. On an outflow that is right, and `isTransfer` then keeps
// it out of `living`. On an INFLOW it would book arriving money as a cost — strictly worse than
// today. Marking the incoming half requires that function to learn a third shape first.

import {
  detectTransferPairs, indexPairsByLeg,
  type PairableTransfer, type PairableAccount,
} from './transfer-pair-detection';

/** Provider categories that ASSERT a transfer, as opposed to admitting ignorance. */
const EXPLICIT_TRANSFER_CATEGORIES: ReadonlySet<string> = new Set([
  'TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER',
]);

/**
 * Account types where the money is INVESTED rather than merely moved.
 *
 * Both verdicts satisfy `isTransfer` at `pay-schedule.ts:1446`, so this changes no total — it is the
 * app's existing vocabulary for the same distinction, and the surfaces that say "invested" read this
 * one. Fidelity Go Automated is `brokerage`, which is why it matters for the row that prompted this.
 */
const INVESTMENT_ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'brokerage', 'roth_ira', 'traditional_ira', 'ira', '401k', '403b', 'hsa', '529',
]);

/**
 * Words that identify a KIND of account rather than an institution.
 *
 * ⚠️ THIS IS THE GUARD THAT STOPS "Savings Account" MATCHING EVERY ROW SAYING "SAVINGS". A generic
 * token is shared by half the accounts on the page and half the statement descriptions, so matching
 * on one is not evidence of anything. What survives is the distinctive part — the institution or the
 * product — which is the only part that can identify WHICH account.
 */
const GENERIC_ACCOUNT_WORDS: ReadonlySet<string> = new Set([
  'account', 'accounts', 'checking', 'savings', 'save', 'card', 'cards', 'credit', 'debit',
  'bank', 'banking', 'visa', 'mastercard', 'amex', 'individual', 'joint', 'personal',
  'business', 'main', 'primary', 'secondary', 'general', 'operations', 'plan', 'plans',
  'fund', 'funds', 'cash', 'online', 'mobile', 'payment', 'payments', 'transfer', 'transfers',
  'deposit', 'loan', 'rate', 'fixed', 'auto', 'automated', 'reward', 'rewards',
  'corporation', 'corp', 'company', 'salaried', 'the', 'and', 'llc', 'inc', 'from', 'with',
]);

/** Distinctive lower-case words in a piece of text. Four letters, because three is a bank code. */
function distinctiveWords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return new Set(
    words.filter(w => w.length >= 4 && !GENERIC_ACCOUNT_WORDS.has(w) && !/^[0-9]+$/.test(w)),
  );
}

/**
 * What `detectTransferLegs` answers.
 *
 * ⚠️ `mirroredInflows` EXISTS TO STOP A DOUBLE COUNT, and the double count is real - measured
 * 2026-09-16 on a credit-card autopay fixture. One movement produced TWO proposals: the outflow
 * from checking (correctly a transfer) AND **$941.01 a month of phantom INCOME** on the card,
 * because the two banks name the same movement differently ("Payment to Chase card ending in 56"
 * vs "Payment Thank You-Mobile") and `rules-from-history` groups by merchant. A user accepting both
 * books income that does not exist, inflating the savings rate.
 *
 * It is PAIRS ONLY, never the one-sided name signal: a mirrored inflow is suppressed because its
 * OUTFLOW TWIN already represents the movement. Where no twin was found there is nothing to be
 * represented by, and suppressing the inflow would delete the movement entirely.
 *
 * ⚠️ An existing rule almost hid this. A merchant billing on two accounts already makes every
 * claimant go quiet - so a fixture using ONE merchant name for both legs returns zero proposals for
 * a reason unrelated to the question. The first probe did exactly that and read as "no double
 * count". Only distinct names, which is the realistic case, exposes it.
 */
export interface TransferLegs {
  /** Outflow legs that are movements between the user's own accounts. */
  verdicts: Map<string, TransferVerdict>;
  /** Inflow legs whose outflow twin is already proposed. Never proposed themselves. */
  mirroredInflows: Set<string>;
}

/** What a charge is, when it is not spending. */
export interface TransferVerdict {
  /** The value `recurring_rules.rule_type` must carry. Both satisfy `isTransfer` downstream. */
  ruleType: 'transfer' | 'investment';
  /** The account the money reached, when it is known. Written to `deposit_account`. */
  destination: PairableAccount | null;
  /** Which signal fired — carried so a surface can explain itself and a test can tell them apart. */
  via: 'pair' | 'name';
}

function verdictFor(destination: PairableAccount, via: TransferVerdict['via']): TransferVerdict {
  return {
    ruleType: INVESTMENT_ACCOUNT_TYPES.has(destination.account_type) ? 'investment' : 'transfer',
    destination,
    via,
  };
}

/**
 * The one account this row names, or null.
 *
 * THREE GUARDS, each doing real work against the sixteen accounts on this profile:
 *  1. NEVER THE ACCOUNT IT POSTED ON. A row on CHASE CHECKING saying "CHASE" names its own side of
 *     the movement, not a destination, and a self-match is not a transfer.
 *  2. AT LEAST ONE DISTINCTIVE WORD IN COMMON, per {@link GENERIC_ACCOUNT_WORDS}.
 *  3. UNIQUELY ONE ACCOUNT. This profile holds two accounts called "Robinhood individual"; a row
 *     saying "ROBINHOOD" cannot say which, so nothing is claimed. Silence rather than a coin flip is
 *     this codebase's standing answer to a contested match, and it is `detectTransferPairs`' own
 *     unique-best rule applied to a one-sided problem.
 */
function namedOwnedAccount(
  txn: PairableTransfer,
  accounts: readonly PairableAccount[],
): PairableAccount | null {
  const rowWords = distinctiveWords(`${txn.merchant_name ?? ''} ${txn.name ?? ''}`);
  if (rowWords.size === 0) return null;

  const matches = accounts.filter(a => {
    if (a.id === txn.account_id) return false;
    for (const word of distinctiveWords(a.name)) if (rowWords.has(word)) return true;
    return false;
  });
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Every OUTFLOW row that is a leg of a movement between the user's own accounts, keyed by row id.
 *
 * Pure. `txns` may be the whole history and is never mutated. Rows absent from the map are, as far
 * as this can tell, spending — and saying nothing is the correct answer for all of them.
 */
export function detectTransferLegs(
  txns: readonly PairableTransfer[],
  accounts: readonly PairableAccount[],
): TransferLegs {
  const verdicts = new Map<string, TransferVerdict>();
  const mirroredInflows = new Set<string>();
  if (accounts.length === 0) return { verdicts, mirroredInflows };

  // SIGNAL A — both legs synced. Only the OUTFLOW leg is recorded; see the header.
  const pairByLeg = indexPairsByLeg(detectTransferPairs(txns, accounts));
  for (const [legId, pair] of pairByLeg) {
    // The INFLOW half is recorded as mirrored so nothing proposes it as a second rule for the same
    // movement - see {@link TransferLegs.mirroredInflows}, where the measured double count is.
    if (legId === pair.in.id) mirroredInflows.add(legId);
    if (legId !== pair.out.id) continue;
    verdicts.set(legId, verdictFor(pair.toAccount, 'pair'));
  }

  // SIGNAL B — one side only, so the provider must ASSERT a transfer and the row must name exactly
  // one other account the user owns. A pair already found wins, being the stronger reading.
  const accountIds = new Set(accounts.map(a => a.id));
  for (const txn of txns) {
    if (verdicts.has(txn.id)) continue;
    if (!txn.account_id || !accountIds.has(txn.account_id)) continue;
    if (!(Number(txn.amount) > 0)) continue; // outflow-positive (Stage A); inflows excluded by design
    if (!txn.category || !EXPLICIT_TRANSFER_CATEGORIES.has(txn.category)) continue;
    const destination = namedOwnedAccount(txn, accounts);
    if (!destination) continue;
    verdicts.set(txn.id, verdictFor(destination, 'name'));
  }

  return { verdicts, mirroredInflows };
}

/**
 * The verdict for a whole run of charges, or null if the run is not unanimously one transfer.
 *
 * UNANIMOUS, because the run is what the proposal writes ONE rule from. If two of three months look
 * like a transfer and the third looks like a purchase, the honest answer is that the app does not
 * know what this rule is — and the existing behaviour, an ordinary expense the user can see and
 * correct, is the safer of the two wrong-looking options. A rule typed `transfer` leaves `living`
 * SILENTLY, which is the harder error for a person to notice.
 */
export function transferVerdictForRun(
  chargeIds: readonly string[],
  verdicts: ReadonlyMap<string, TransferVerdict>,
): TransferVerdict | null {
  if (chargeIds.length === 0) return null;
  const found = chargeIds.map(id => verdicts.get(id));
  if (found.some(v => !v)) return null;
  const first = found[0]!;
  if (found.some(v => v!.ruleType !== first.ruleType)) return null;
  if (found.some(v => v!.destination?.id !== first.destination?.id)) return null;
  return first;
}
