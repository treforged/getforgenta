// §1B Stage 7B — RULE DRIFT. When a rule and the bank have disagreed for months, say so. Pure, no I/O.
//
// THE TWO REAL CASES, from Tre's live rows on 2026-08-13:
//   Rent        rule $1,915  ·  Invitationhomes billed 2,049.95 / 2,104.08 / 2,082.82 / 2,079.48 /
//                               2,082.82 / 2,117.82 / 2,079.48 across 2026-02…2026-08 (avg 2,085.21)
//   Electricity rule $100    ·  Duke Energy billed 123.52 / 99.69 / 111.91 / 141.84 / 169.52 /
//                               197.93 across 2026-03…2026-08 (avg 140.74, last three 169.76)
//
// ⚠️ ONLY ONE OF THOSE TWO IS REAL DRIFT, AND FINDING THAT OUT IS WHY `bundleExplainsBetter` EXISTS.
// Tre, 2026-08-13: "my base rent, internet, water, and home ring system are included in my monthly
// rent charge. electricity is the only separate thing." Four rules — Rent 1,915, Internet 85, Smart
// Home 40, Water/Sewer/Trash 30 — share one account and one due day and TOGETHER model that single
// Invitationhomes charge, summing 2,070 against an actual 2,085. The bundle is already right to
// within ~$15. Reporting Rent alone as "$1,915 should be $2,085" was therefore an invitation to
// press a button that leaves the other three rules in place and overstates housing by $155/month —
// on the surface built to make the budget MORE truthful. The real total the budget cannot see is
// about $85/mo, essentially all of it Electricity, not the ~$250 first claimed.
//
// ⚠️ CORRECTION TO THE PREMISE THIS WAS ASKED UNDER, AND IT CHANGED THE DESIGN.
// The card said "the matches are already computed, so this is presentation over existing work."
// That is not true, and it is not true BECAUSE of the drift. `matchCharge`'s amount gate is
// `max($0.05, 1% of the rule)` — $19.15 on the Rent rule — and Invitationhomes is $135–$200 away
// every month. NEITHER of these bills matches today, and neither ever could: a rule far enough out
// to be worth reporting is by definition too far out for a matcher tuned to assert "this bill was
// paid". So drift needs its own, deliberately wider comparison, and the important thing is what that
// does NOT do:
//
//   ⚠️ NOTHING HERE TOUCHES `matchCharge` AND NOTHING HERE IS FED BACK INTO IT. No badge changes, no
//   suggestion changes, no capture gate changes, no projected number changes. The matcher's output
//   is an ASSERTION ("this charge settled that bill") and must stay silent when unsure. This file's
//   output is a QUESTION with the evidence attached ("this has billed 2,085 for seven months — update
//   the rule?"), and the user answers it. A wider band is safe in the second shape and would be
//   dangerous in the first, which is exactly why they are two functions and not one tolerance
//   constant somebody later "unifies".

import { normalizeMerchant, type MerchantCharge } from './merchant-memory';
import { ruleChargeAccountId } from './transaction-matching';

/** Consecutive months a merchant must have billed before the app says anything. */
export const MIN_CONSECUTIVE_MONTHS = 3;

/** Months averaged into the recommendation. See `observedAmount`. */
export const RECENT_WINDOW_MONTHS = 3;

/**
 * The band a charge must sit in to be a candidate for a rule, as a multiple of the rule's amount.
 *
 * ASYMMETRIC ON PURPOSE. Drifting UPWARD is the observed failure mode and the one that hurts — rent
 * rises, power rises, and the budget quietly under-projects — so the ceiling is generous enough to
 * catch a rule that has fallen to half of reality (Electricity, $100 against $197.93). The floor is
 * tight because a charge well BELOW the rule is far more likely to be a different, smaller bill on
 * the same account than the same bill shrinking; on Tre's checking account a symmetric band pulled
 * in Banner Life ($54.07/mo) as a rival candidate for the $100 Electricity rule, and two candidates
 * means the app says nothing at all.
 */
export const DRIFT_BAND_LOW = 0.75;
export const DRIFT_BAND_HIGH = 2.0;

/** Below this, a difference is noise the user should not be interrupted for. */
export const MIN_DRIFT_DOLLARS = 10;
export const MIN_DRIFT_PCT = 0.05;

/** The fields of a `recurring_rules` row the drift detector reads. */
export interface DriftRule {
  id: string;
  name: string;
  amount: number | string;
  frequency: string;
  rule_type: string;
  payment_source?: string | null;
  deposit_account?: string | null;
  active?: boolean;
  /** Day of the month. Used ONLY to group a bundle — see {@link bundleExplainsBetter}. */
  due_day?: number | null;
}

/** The fields of a settled `synced_transactions` row the drift detector reads. */
export interface DriftCharge extends MerchantCharge {
  id: string;
  account_id: string | null;
  /** OUTFLOW POSITIVE, inflow negative — Stage A's convention. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** One month of a merchant's billing history against a rule. */
export interface DriftMonth {
  month: string;
  amount: number;
  date: string;
  chargeId: string;
}

/** A rule the bank has been contradicting, and the evidence for saying so. */
export interface RuleDrift {
  ruleId: string;
  ruleName: string;
  ruleAmount: number;
  /** The merchant doing the billing, as it reads on the statement. */
  merchantLabel: string;
  merchantKey: string;
  /** The consecutive run, oldest first. Always at least `MIN_CONSECUTIVE_MONTHS` long. */
  months: DriftMonth[];
  /** Mean across the whole run — the "has billed about X for N months" figure. */
  averageAmount: number;
  /** Mean of the last `RECENT_WINDOW_MONTHS`. THE NUMBER THE ACCEPT BUTTON WRITES. */
  observedAmount: number;
  /** `observedAmount - ruleAmount`. Positive means the rule under-states the bill. */
  delta: number;
}

const monthOf = (date: string) => date.slice(0, 7);

/** The month `n` months after `YYYY-MM`. Built from parts — `new Date('YYYY-MM')` is UTC midnight. */
function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** Round to cents, so a recommendation is a number a person could type into the rule. */
const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * A decision the user already recorded on Bank Activity: "this charge settles that rule."
 *
 * The fields of a `synced_transaction_reviews` row this module reads. Only `linked_rule` rows carry
 * a rule, and only those are consulted.
 */
export interface DriftRuleLink {
  synced_transaction_id: string;
  status: string;
  rule_id?: string | null;
}

/** A set of rules that are billed together as one charge, and what they come to. */
export interface RuleBundle {
  total: number;
  ruleIds: string[];
  ruleNames: string[];
}

/**
 * The bundle this rule belongs to, when several rules together explain the charge BETTER than this
 * rule alone — otherwise null.
 *
 * ⚠️ THIS IS THE GUARD AGAINST THE WORST THING THIS FILE COULD DO. Drift identifies by merchant and
 * would otherwise assume one rule per charge. Tre's landlord bills base rent, internet, water and
 * the smart-home system as a SINGLE Invitationhomes debit, and he models it as four rules that sum
 * to 2,070 against an actual 2,085 — correct to within $15. Reported per-rule, that reads as "Rent
 * is $170 low", and accepting it leaves the other three rules untouched and overstates housing by
 * $155/month. A one-tap accept must never be able to do that.
 *
 * The app already knows charges can be bundled — split link exists for exactly this, and
 * `synced-transaction-review.ts`'s own header cites this very charge. This is the same fact reaching
 * the detector.
 *
 * GROUPING is same charge account + same direction + monthly + same `due_day`: rules paid from one
 * account on one day are what a bundled debit looks like from the rules' side. The TEST is simply
 * whether the bundle lands closer to what the bank actually billed than the single rule does. That
 * is deliberately not a tolerance anyone has to tune — either the sum explains the charge better or
 * it does not, and when it does, this file has nothing safe to say about the rule on its own.
 */
export function bundleExplainsBetter(
  rule: DriftRule,
  siblings: readonly DriftRule[],
  observedAmount: number,
): RuleBundle | null {
  const accountId = ruleChargeAccountId({
    rule_type: rule.rule_type,
    payment_source: rule.payment_source ?? null,
    deposit_account: rule.deposit_account ?? null,
  });
  if (!accountId) return null;

  const members = siblings.filter(s => {
    if (s.active === false) return false;
    if (s.frequency !== 'monthly') return false;
    // Direction must match: an income rule and an expense rule are never one debit.
    if ((s.rule_type === 'income') !== (rule.rule_type === 'income')) return false;
    if ((s.due_day ?? null) !== (rule.due_day ?? null)) return false;
    const sid = ruleChargeAccountId({
      rule_type: s.rule_type,
      payment_source: s.payment_source ?? null,
      deposit_account: s.deposit_account ?? null,
    });
    return sid === accountId;
  });

  // The rule itself must be in the group, and a "bundle" of one is just the rule.
  if (members.length < 2) return null;
  if (!members.some(m => m.id === rule.id)) return null;

  const total = cents(members.reduce((sum, m) => sum + Math.abs(Number(m.amount) || 0), 0));
  const ruleAmount = Math.abs(Number(rule.amount));
  if (Math.abs(total - observedAmount) >= Math.abs(ruleAmount - observedAmount)) return null;

  return {
    total,
    ruleIds: members.map(m => m.id),
    ruleNames: members.map(m => m.name),
  };
}

/**
 * The drift for one rule, or null.
 *
 * ⚠️ MATCHING IS BY CALENDAR MONTH, NOT BY A ±5-DAY WINDOW AROUND `due_day`, and that is a
 * deliberate departure from `matchCharge` rather than a copy of it that drifted. The two ask
 * different questions. `matchCharge` must identify ONE occurrence, so it needs the day. Drift asks
 * "what did this bill cost in August", which is a per-month aggregate — and the day is precisely the
 * thing that moves: Duke Energy's `due_day` is 1 and it posts on the 4th, 5th, 6th and 7th, so a
 * ±5-day window drops 2026-05-07 and breaks the very run this is trying to observe.
 *
 * ⚠️ IDENTIFICATION IS BY MERCHANT, AND IT IS WHAT MAKES THE WIDE BAND SAFE. A candidate merchant
 * must have billed this account EXACTLY ONCE in each of at least three CONSECUTIVE months ending at
 * its most recent month, with every one of those charges inside the band. A discretionary purchase
 * that happens to land near the rule's amount cannot do that; a recurring bill does it by nature.
 * Publix (21 charges) and Amazon (89) are excluded automatically by the once-a-month rule rather
 * than by a category list somebody has to maintain.
 *
 * ⚠️ TWO QUALIFYING MERCHANTS MEANS SILENCE, exactly as two equally good candidates do in
 * `matchCharge`. "Your Electricity rule is wrong, it is either Duke Energy or Banner Life" is worse
 * than saying nothing, and a one-tap accept on a coin flip would write the wrong number into a rule
 * that feeds every forecast surface.
 */
export function detectRuleDrift(
  rule: DriftRule,
  charges: readonly DriftCharge[],
  /** Every rule, so a bundled charge can be recognised. Omitted = no bundle check (old behaviour). */
  siblings: readonly DriftRule[] = [],
): RuleDrift | null {
  if (rule.active === false) return null;
  // Monthly only in v1. A weekly or biweekly rule's "month" is two or four billings, so the
  // once-a-month identification rule does not describe it and averaging would compare unlike things.
  if (rule.frequency !== 'monthly') return null;
  // ⚠️ A MERCHANT DOES NOT BILL YOU FOR A TRANSFER OR AN INVESTMENT. Seen live on 2026-08-13: the
  // panel told Tre "Roth IRA has billed about $140.74 for 6 months" — those are Duke Energy's power
  // bills, and the card offered to rewrite a $100/mo Roth IRA contribution to $170. `investment` and
  // `transfer` rules move money between the user's OWN accounts on a schedule they choose; there is
  // no merchant on the other end whose price could drift, so any merchant matching one is a
  // coincidence of amount. Three of the seven cards on screen were this.
  if (rule.rule_type !== 'expense' && rule.rule_type !== 'income') return null;

  // `RuleRow` leaves both columns optional while the matcher's contract is `string | null`; the two
  // mean the same thing here and the adapter says so once rather than at every call site.
  const accountId = ruleChargeAccountId({
    rule_type: rule.rule_type,
    payment_source: rule.payment_source ?? null,
    deposit_account: rule.deposit_account ?? null,
  });
  if (!accountId) return null;

  const ruleAmount = Math.abs(Number(rule.amount));
  if (!Number.isFinite(ruleAmount) || ruleAmount <= 0) return null;

  const wantsInflow = rule.rule_type === 'income';
  const low = ruleAmount * DRIFT_BAND_LOW;
  const high = ruleAmount * DRIFT_BAND_HIGH;

  /** key → month → the charges of that merchant in that month. */
  const byMerchant = new Map<string, { label: string; labelDate: string; months: Map<string, DriftMonth[]> }>();
  for (const charge of charges) {
    if (charge.account_id !== accountId) continue;
    const signed = Number(charge.amount);
    if (!Number.isFinite(signed) || signed === 0) continue;
    // Direction is a hard gate here for the same reason it is in `matchCharge`: a refund must never
    // be read as the month this bill got cheaper.
    if (wantsInflow !== signed < 0) continue;
    const magnitude = Math.abs(signed);
    if (magnitude < low || magnitude > high) continue;

    const label = (charge.merchant_name || charge.name || '').trim();
    const key = normalizeMerchant(label);
    if (!key) continue;

    const entry = byMerchant.get(key) ?? { label, labelDate: '', months: new Map<string, DriftMonth[]>() };
    const month = monthOf(charge.date);
    const list = entry.months.get(month) ?? [];
    list.push({ month, amount: magnitude, date: charge.date, chargeId: charge.id });
    entry.months.set(month, list);
    // The most recent spelling of the name — what the statement reads like today, not in January.
    if (label && charge.date >= entry.labelDate) { entry.label = label; entry.labelDate = charge.date; }
    byMerchant.set(key, entry);
  }

  // ⚠️ "STILL BILLING" IS INFERRED FROM THE ROWS, NOT FROM A CLOCK. A bill that stopped in February
  // is history, and recommending a new amount for it would be advice about a bill that is gone — but
  // this module is pure and has no `today`, and taking one would make every test time-dependent. The
  // latest month in the synced set is the honest proxy: it is when the bank last reported anything.
  // One month of slack, because a bill due on the 1st can post after the newest row in the feed.
  const latestObserved = charges.reduce((max, c) => (c.date > max ? c.date : max), '');
  const freshEnough = latestObserved ? addMonth(monthOf(latestObserved), -1) : '';

  const qualifying: RuleDrift[] = [];
  for (const [key, entry] of byMerchant) {
    // Exactly one charge in a month, or that month does not count as an observation.
    const clean = new Map<string, DriftMonth>();
    for (const [month, list] of entry.months) {
      if (list.length === 1) clean.set(month, list[0]);
    }
    if (clean.size < MIN_CONSECUTIVE_MONTHS) continue;

    // The run ENDING AT THE LATEST OBSERVED MONTH. A bill that stopped six months ago is history,
    // not drift, and recommending a new amount for it would be advice about a bill that is gone.
    const latest = [...clean.keys()].sort().pop()!;
    if (latest < freshEnough) continue;
    const run: DriftMonth[] = [];
    for (let back = 0; ; back++) {
      const month = addMonth(latest, -back);
      const observed = clean.get(month);
      if (!observed) break;
      run.unshift(observed);
    }
    if (run.length < MIN_CONSECUTIVE_MONTHS) continue;

    const recent = run.slice(-RECENT_WINDOW_MONTHS);
    qualifying.push({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleAmount,
      merchantLabel: entry.label || key,
      merchantKey: key,
      months: run,
      averageAmount: cents(mean(run.map(m => m.amount))),
      observedAmount: cents(mean(recent.map(m => m.amount))),
      delta: 0,
    });
  }

  // See the header: ambiguity is silence, never a coin flip.
  if (qualifying.length !== 1) return null;

  const drift = qualifying[0];

  // ⚠️ SILENCE, NOT A BUNDLE CARD, WHEN SEVERAL RULES SHARE THIS CHARGE. Reporting the bundle was
  // considered and rejected for v1: the accept button writes ONE rule's amount, so a card the user
  // cannot act on is an interruption without a remedy, and splitting ~$15 across four rules is a
  // decision only the user can make. Saying nothing leaves a budget that is already correct to
  // within $15 alone; saying something risks a press that puts it $155 wrong. Same instinct as the
  // two-qualifying-merchants rule above.
  if (bundleExplainsBetter(rule, siblings, drift.observedAmount)) return null;

  const delta = cents(drift.observedAmount - drift.ruleAmount);
  // Worth interrupting for? Both gates, so a big percentage of a tiny rule and a rounding error on a
  // large one are both left alone.
  if (Math.abs(delta) < MIN_DRIFT_DOLLARS) return null;
  if (Math.abs(delta) < drift.ruleAmount * MIN_DRIFT_PCT) return null;
  return { ...drift, delta };
}

/**
 * Every rule the bank has been contradicting, worst first.
 *
 * Ordered by the monthly dollars the budget cannot see, because that is the order in which fixing
 * them matters — not alphabetically and not by percentage, which would put a $12 subscription above
 * a $178 rent gap.
 */
export function linkedRulesByMerchant(
  charges: readonly DriftCharge[],
  links: readonly DriftRuleLink[],
): Map<string, Set<string>> {
  const merchantOfCharge = new Map<string, string>();
  for (const charge of charges) {
    const key = normalizeMerchant((charge.merchant_name || charge.name || '').trim());
    if (key) merchantOfCharge.set(charge.id, key);
  }
  const out = new Map<string, Set<string>>();
  for (const link of links) {
    if (link.status !== 'linked_rule' || !link.rule_id) continue;
    const key = merchantOfCharge.get(link.synced_transaction_id);
    if (!key) continue;
    const set = out.get(key) ?? new Set<string>();
    set.add(link.rule_id);
    out.set(key, set);
  }
  return out;
}

export function detectAllRuleDrift(
  rules: readonly DriftRule[],
  charges: readonly DriftCharge[],
  /**
   * `synced_transaction_reviews` rows. THE TIEBREAKER FOR A CONTESTED MERCHANT, and the reason it is
   * allowed to break a tie at all: a `linked_rule` row is the user saying "this charge settles that
   * rule" in their own words. It is recorded fact, not a heuristic, so preferring it is not the
   * merchant-name guessing `plaid-category-map.ts` forbids.
   *
   * Omitted = no tiebreak, and a contested merchant stays silent.
   */
  links: readonly DriftRuleLink[] = [],
): RuleDrift[] {
  const out: RuleDrift[] = [];
  for (const rule of rules) {
    // The whole list goes in as siblings: a rule can only be recognised as part of a bundle by
    // looking at the others, and this is the one call site that has them all.
    const drift = detectRuleDrift(rule, charges, rules);
    if (drift) out.push(drift);
  }

  // ⚠️ THE MIRROR AMBIGUITY, AND IT IS THE ONE THAT ACTUALLY BIT. `detectRuleDrift` guards the
  // ambiguity it can see from where it stands — two merchants competing for ONE rule is silence.
  // It cannot see the other direction, because it is called once per rule and never learns that the
  // merchant it just claimed was claimed by four others too. Live on 2026-08-13, Duke Energy was
  // claimed by Electricity, Internet, Roth IRA, Robinhood Contributions and Owners Contribution;
  // Banner Life by Water/Sewer/Trash, Phone Bill to Mom and Smart Home. Seven cards, every one
  // wrong, each with a one-tap accept writing a number into a rule that feeds every forecast.
  //
  // ⚠️ THIS IS THE SAME BUG THE BANK-ACTIVITY QUEUE FOUND AND FIXED ON THE SAME DAY — three
  // identical CFX tolls each confidently claiming the one $10 ledger entry, because `matchCharge`
  // guards candidates and not claimants. Two surfaces, one blind spot, and it is worth naming so the
  // third one does not repeat it.
  //
  // A contested merchant yields silence for EVERY claimant, including the one that happens to be
  // right. That is a real loss — Electricity genuinely has drifted — and it is still the correct
  // trade while the tiebreaker is amount: two rules of $100 on one account cannot be told apart by
  // arithmetic. The principled fix is to prefer a rule the user has already LINKED to that merchant
  // in `synced_transaction_reviews`, which is recorded fact rather than a guess; until that is
  // wired in, saying nothing beats naming the wrong rule.
  const claimants = new Map<string, RuleDrift[]>();
  for (const drift of out) {
    const list = claimants.get(drift.merchantKey) ?? [];
    list.push(drift);
    claimants.set(drift.merchantKey, list);
  }

  const linked = linkedRulesByMerchant(charges, links);
  const kept: RuleDrift[] = [];
  for (const [merchantKey, rivals] of claimants) {
    if (rivals.length === 1) { kept.push(rivals[0]); continue; }
    // Contested. The user's own recorded links decide it, and ONLY if they decide it outright —
    // two linked rivals is still a coin flip, and silence is the house answer to a coin flip.
    const byLink = rivals.filter(r => linked.get(merchantKey)?.has(r.ruleId));
    if (byLink.length === 1) kept.push(byLink[0]);
  }

  return kept.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * The sentence a drift is shown as.
 *
 * Kept here rather than in the component so the number in the copy and the number the accept button
 * writes are produced by one function and cannot drift apart — which is, with some irony, the exact
 * class of bug this whole file is about.
 */
export function describeDrift(drift: RuleDrift): string {
  const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const trend = Math.abs(drift.observedAmount - drift.averageAmount) >= drift.averageAmount * 0.05
    ? ` (the last ${Math.min(RECENT_WINDOW_MONTHS, drift.months.length)} average ${money(drift.observedAmount)})`
    : '';
  return `${drift.ruleName} has billed about ${money(drift.averageAmount)} for ${drift.months.length} months${trend}`
    + `, and your rule says ${money(drift.ruleAmount)}.`;
}
