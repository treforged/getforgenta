// §1B — two bank rows that are the two legs of ONE movement between accounts Tre owns. Pure, no I/O.
//
// WHAT THIS IS FOR. A transfer between your own accounts posts twice: money leaves TOTAL CHECKING
// and arrives at Prime Visa, and Plaid reports both, because from each bank's side each is a real
// event. The app then shows two rows in the review queue for one movement.
//
// ⚠️ WHAT THIS IS *NOT* FOR, because an earlier version of the request had it backwards: these rows
// are NOT double-counted in any total today. `synced_transactions` is a separate table from the
// ledger, and a bank row only becomes money via "Add to my ledger". A check on 2026-08-13 found
// ZERO imported transfer pairs in `transactions`. Nothing here corrects a miscount, and nothing
// here may be described as though it does.
//
// The three real costs, in the order they bite:
//   1. QUEUE NOISE. Both legs sit in a backlog Tre already cannot get through.
//   2. A LIVE TRAP. Pressing "Add to my ledger" on either leg books a transfer as spending or
//      income. That is the one control on the page that creates money, and on a transfer leg every
//      answer it can give is wrong.
//   3. ATTRIBUTION. Moving money between your own accounts is currently indistinguishable from a
//      purchase.
//
// DESIGN BIAS, inherited from `transaction-matching.ts` and load-bearing here for a sharper reason.
// That file prefers silence because a false badge asserts money moved. This one prefers silence
// because a false pair does something worse: it COLLAPSES TWO ROWS INTO ONE and takes a real
// purchase out of the queue. Tre's own data contains three of those (see below), so an ambiguity
// that resolves to "no pair" is not defensive nicety — it is the difference between hiding a
// 7-Eleven charge and not.
//
// GROUNDED IN THE REAL ROWS (2026-08-13, 586 settled synced rows, 53 candidate joins under the
// amount+date+different-account rule alone):
//   - "7-Eleven" $50 on Prime Visa vs a $50 credit to General Operations three days later.
//   - "Aamc" $36 on Discover vs a $36 Zelle FROM a third party (Ariana) the same day.
//   - "Patent and Trademark Svc" $350 vs another $350 Zelle from the same third party.
// All three are two genuinely separate movements that happen to be equal and adjacent. All three
// are rejected below, and each rejection is pinned by a test built from that exact row.
//
// ⚠️ DETECTION IS DERIVED AT READ TIME AND NEVER PERSISTED, exactly as `matchOccurrence`'s is. The
// inputs (accounts, categories, which rows have synced) change under it, and a stored pair would
// need invalidating on every one of those. What IS persisted is Tre's confirmation, and only after
// he gives it.

import { AMOUNT_EXACT_TOLERANCE, daysBetween } from './transaction-matching';

/**
 * Days either side a leg may land and still be the same movement.
 *
 * Three, not five. The two legs of one transfer are usually same-day and at worst span a weekend;
 * `transaction-matching`'s wider window exists to catch a bill settling late, which is a different
 * question. Widening this multiplies candidates, and more candidates means more ambiguity, which
 * under the unique-best rule below means FEWER pairs, not more — the knob points the opposite way
 * from the intuition, same as it does there.
 */
export const TRANSFER_DATE_WINDOW_DAYS = 3;

/**
 * Provider categories a transfer leg may carry.
 *
 * ⚠️ THIS IS THE GATE THAT REJECTS THE THREE FALSE POSITIVES ABOVE, and it is why "opposite signs,
 * equal amount, close dates, different accounts" is not sufficient on its own. A 7-Eleven purchase
 * is `GENERAL_MERCHANDISE`; the fees to Aamc and to the patent office are
 * `GOVERNMENT_AND_NON_PROFIT`. None of those is a thing money moves between your own accounts as.
 *
 * `LOAN_PAYMENTS` and `LOAN_DISBURSEMENTS` are in the set because that is how Plaid labels a credit
 * card payment from both sides. `OTHER` is in because Plaid genuinely returns it for Tre's
 * Zelle-to-himself credits ("TREVON L HINES"), and excluding it would drop four real pairs to
 * punish the provider for saying "I don't know" — but note it is an ADMISSION of ignorance, not
 * evidence, which is why it never suffices alone: the opposite leg still has to qualify.
 *
 * `INCOME` is deliberately ABSENT even though Plaid tags Tre's real $941.01 Prime Visa autopay
 * credit with it. That pair is kept by the credit-card rule below instead, which is structural and
 * does not depend on the provider having labelled a card payment correctly. Adding `INCOME` here
 * would additionally let a paycheck pair with any equal outflow that week.
 */
export const TRANSFER_CATEGORIES: ReadonlySet<string> = new Set([
  'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'LOAN_DISBURSEMENTS', 'OTHER',
]);

/** The `accounts.account_type` that makes a credit to an account a PAYMENT rather than a deposit. */
const CREDIT_CARD_TYPE = 'credit_card';

/** The fields of a `synced_transactions` row this detector reads. */
export interface PairableTransfer {
  id: string;
  account_id: string | null;
  /** `numeric` — arrives as a string. Stage A normalizes to OUTFLOW POSITIVE, inflow negative. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
  name?: string | null;
  merchant_name?: string | null;
  /** The provider's category bucket. Null means the provider said nothing, which is not evidence. */
  category?: string | null;
}

/** The fields of an `accounts` row this detector reads. */
export interface PairableAccount {
  id: string;
  name: string;
  account_type: string;
}

/** Two legs of one movement. `out` is where the money left; `in` is where it arrived. */
export interface TransferPair {
  /** Stable across renders and independent of row order, so it can key React state. */
  key: string;
  out: PairableTransfer;
  in: PairableTransfer;
  /** Positive, in dollars. The two legs agree on it to within a cent by construction. */
  amount: number;
  fromAccount: PairableAccount;
  toAccount: PairableAccount;
  /**
   * The card this movement PAID, or null if it moved between two non-card accounts.
   *
   * Present iff the inflow leg lands on a `credit_card`. This is what lets the UI offer linking the
   * movement to that card's payment obligation instead of asking for a spending category — a card
   * payment is not spending, and no category is the right answer to it.
   */
  paidCard: PairableAccount | null;
}

/** Absolute dollar amount of a leg, or null if the row carries nothing usable. */
function magnitude(txn: PairableTransfer): number | null {
  const signed = Number(txn.amount);
  if (!Number.isFinite(signed) || signed === 0) return null;
  return Math.abs(signed);
}

/** Outflow-positive (Stage A), so a negative amount is money arriving. */
function isInflow(txn: PairableTransfer): boolean {
  return Number(txn.amount) < 0;
}

/**
 * Could this leg plausibly be half of a movement between the user's own accounts?
 *
 * The credit-card escape is not a convenience. Plaid labels the SAME event inconsistently across
 * the two banks reporting it — Tre's $941.01 Chase autopay is `LOAN_PAYMENTS` leaving checking and
 * `INCOME` arriving at Prime Visa — so a category-only gate would reject the flagship case. A
 * credit landing on a credit card is structurally a payment or a refund; paired with an equal debit
 * from another account the user owns, within three days, it is a payment.
 */
function legLooksLikeTransfer(txn: PairableTransfer, account: PairableAccount): boolean {
  if (isInflow(txn) && account.account_type === CREDIT_CARD_TYPE) return true;
  return !!txn.category && TRANSFER_CATEGORIES.has(txn.category);
}

/** A candidate pairing, before ambiguity is resolved. */
interface Candidate {
  outId: string;
  inId: string;
  /** Days between the legs. Smaller is a better explanation of the same movement. */
  gap: number;
}

/**
 * Every pair of legs that is ONE movement between two accounts the user owns.
 *
 * Returns nothing rather than a guess wherever two readings are equally good — see the unique-best
 * rule below. `txns` may be the user's whole history; it is filtered here and never mutated.
 * Ordering of the result follows the outflow leg's date, newest first, so callers render stably.
 */
export function detectTransferPairs(
  txns: readonly PairableTransfer[],
  accounts: readonly PairableAccount[],
): TransferPair[] {
  const accountById = new Map(accounts.map(a => [a.id, a]));

  // Only rows on an account the app can name. A leg whose account is unknown cannot be shown to
  // belong to the user, and "between accounts you own" is the entire claim being made.
  const legs = txns.filter(t => !!t.account_id && accountById.has(t.account_id));
  const byId = new Map(legs.map(t => [t.id, t]));

  const outs = legs.filter(t => !isInflow(t));
  const ins = legs.filter(t => isInflow(t));

  const candidates: Candidate[] = [];
  for (const out of outs) {
    const target = magnitude(out);
    if (target === null) continue;
    const outAccount = accountById.get(out.account_id!)!;
    if (!legLooksLikeTransfer(out, outAccount)) continue;

    for (const inn of ins) {
      // Two DIFFERENT accounts. Two rows on one account are two events on that account, whatever
      // else they are.
      if (inn.account_id === out.account_id) continue;
      const arrived = magnitude(inn);
      if (arrived === null) continue;
      // The same tolerance `matchCharge` calls `exact`. A transfer moves one number; there is no
      // reason to accept the looser proportional band that exists for variable bills.
      if (Math.abs(arrived - target) > AMOUNT_EXACT_TOLERANCE) continue;

      const gap = Math.abs(daysBetween(out.date, inn.date));
      if (!Number.isFinite(gap) || gap > TRANSFER_DATE_WINDOW_DAYS) continue;

      const inAccount = accountById.get(inn.account_id!)!;
      if (!legLooksLikeTransfer(inn, inAccount)) continue;

      candidates.push({ outId: out.id, inId: inn.id, gap });
    }
  }

  // ⚠️ UNIQUE BEST ON BOTH SIDES, or nothing — `matchCharge`'s one-candidate rule, applied to a
  // two-sided problem. The tier is the date gap, which is this file's analogue of that file's
  // exact-vs-strong amount tier: of two rows that could be the same movement, the nearer one is the
  // better explanation.
  //
  // A pair survives only if the outflow's best candidate is uniquely this inflow AND the inflow's
  // best candidate is uniquely this outflow. Mutual agreement is what does the real work on the
  // live rows:
  //   - Three separate $500 debits sit within two days of ONE $500 Prime Visa credit. Only the
  //     same-day one is mutually best, and it is the one that is actually the payment; the two
  //     Discover e-payments are correctly left alone.
  //   - The $50 7-Eleven charge is three days from a General Operations credit that ALSO has a
  //     same-day $50 transfer next to it. The credit prefers the transfer, so the purchase is not
  //     collapsed — the mutual half of the rule is what saves it, not the category gate.
  //   - Two $50 Zelle debits on one day, both equally close to one credit: a tie, so no pair. A
  //     coin flip presented as "this is one movement" is worse than leaving both rows visible.
  const bestFor = (ids: string[], pick: (c: Candidate) => string) => {
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const key = pick(c);
      const group = groups.get(key);
      if (group) group.push(c);
      else groups.set(key, [c]);
    }
    const winner = new Map<string, Candidate | null>();
    for (const id of ids) {
      const group = groups.get(id) ?? [];
      if (group.length === 0) { winner.set(id, null); continue; }
      const bestGap = Math.min(...group.map(c => c.gap));
      const tied = group.filter(c => c.gap === bestGap);
      winner.set(id, tied.length === 1 ? tied[0] : null);
    }
    return winner;
  };

  const bestByOut = bestFor(outs.map(t => t.id), c => c.outId);
  const bestByIn = bestFor(ins.map(t => t.id), c => c.inId);

  const pairs: TransferPair[] = [];
  for (const candidate of candidates) {
    const fromOut = bestByOut.get(candidate.outId);
    const fromIn = bestByIn.get(candidate.inId);
    if (fromOut !== candidate || fromIn !== candidate) continue;

    const out = byId.get(candidate.outId)!;
    const inn = byId.get(candidate.inId)!;
    const fromAccount = accountById.get(out.account_id!)!;
    const toAccount = accountById.get(inn.account_id!)!;
    pairs.push({
      key: `${out.id}:${inn.id}`,
      out,
      in: inn,
      amount: magnitude(out)!,
      fromAccount,
      toAccount,
      paidCard: toAccount.account_type === CREDIT_CARD_TYPE ? toAccount : null,
    });
  }

  return pairs.sort((a, b) => (a.out.date < b.out.date ? 1 : a.out.date > b.out.date ? -1 : 0));
}

/**
 * Which pair, if any, each leg belongs to — keyed by `synced_transactions.id`, both legs pointing
 * at the same object.
 *
 * The list is the right shape for rendering and reviewing; this is the right shape for the question
 * every row in the queue has to ask ("am I half of something?"), and building it once beats a scan
 * per row over hundreds of rows.
 */
export function indexPairsByLeg(pairs: readonly TransferPair[]): Map<string, TransferPair> {
  const index = new Map<string, TransferPair>();
  for (const pair of pairs) {
    index.set(pair.out.id, pair);
    index.set(pair.in.id, pair);
  }
  return index;
}

/**
 * ONE MOVEMENT, ONE ROW — but only when BOTH legs are on screen.
 *
 * The inflow leg is dropped in favour of the outflow, which is the leg that says where the money
 * came from. When a filter has separated the two the surviving leg is KEPT, and still renders as a
 * transfer: an account filter always separates them, since the legs are on different accounts by
 * definition, and hiding the survivor would make a real bank row vanish from that account's own
 * list. Showing one half and saying it is a half is the lesser of those two.
 *
 * ⚠️ THE POPULATION IS THE ALREADY-FILTERED LIST, not the whole history. "On screen" is decided by
 * what survived the month and account filters, so this must be called last, on `rows` as they will
 * actually be rendered — called earlier it would collapse against legs the viewer cannot see, which
 * is the vanishing row above.
 *
 * Lives here rather than inline in `BankActivity` because it is the rule the collapsed row rests on
 * and it has an edge worth a test: the two legs are on different accounts BY CONSTRUCTION, so the
 * filtered-apart case is not exotic, it is what every account filter does.
 *
 * Returns a new array; `shown` is not mutated.
 */
export function collapseTransferLegs<T extends { id: string }>(
  shown: readonly T[],
  pairByLeg: ReadonlyMap<string, TransferPair>,
): T[] {
  const onScreen = new Set(shown.map(t => t.id));
  return shown.filter(t => {
    const pair = pairByLeg.get(t.id);
    if (!pair || t.id === pair.out.id) return true;
    return !onScreen.has(pair.out.id);
  });
}

/**
 * What one collapsed row says: what moved, from where, to where.
 *
 * Names the two accounts rather than the two merchant descriptions on purpose. The descriptions are
 * each bank's view of its own half ("Payment to Chase card ending in 56" / "Payment Thank You-
 * Mobile") and neither of them says where the money went — which is the only fact a person actually
 * wants back from a transfer.
 */
export function describeTransfer(pair: TransferPair): string {
  return `${pair.fromAccount.name} → ${pair.toAccount.name}`;
}
