// §1C — THE RULES YOUR BANK HISTORY ALREADY IMPLIES. Pure, no I/O, no React.
//
// A linked bank arrives with up to two years of transactions and no budget. Somewhere in those rows
// are the user's paycheck, their rent, their power bill and their subscriptions — every one of them
// a recurring rule they would otherwise type in by hand. This file reads them out.
//
// ⚠️ A PROPOSAL IS A FIRST DRAFT THE USER CORRECTS, NEVER A CLAIM. Carried verbatim from
// `plaid-category-map.ts`: the app is guessing from a merchant name and a rhythm, and it says so.
// Nothing here writes anything, nothing is pre-applied, and every proposal is one the user can
// change or drop on the card it is shown on.
//
// ⚠️ TWO PLAUSIBLE READINGS OF ONE PATTERN MEANS NEITHER IS OFFERED. The house rule, and
// `rule-drift.ts`'s two-qualifying-merchants silence is the model: a one-tap accept on a coin flip
// writes a rule into the budget that feeds every forecast surface, and a wrong rule is far more
// expensive than a missing one — the missing one is the state the user is already in.
//
// ⚠️ NOTHING HERE RE-DERIVES MACHINERY THE APP ALREADY HAS, and that is deliberate to the point of
// being awkward in places. Coverage ("does a rule already exist for this?") is answered by the app's
// own matcher through `buildRuleSuggestionIndex` and by `detectAllRuleDrift`, not by a second
// similarity test. Cadence is confirmed against `getRuleOccurrenceDatesInMonth`, the app's one
// definition of where a rule's occurrences land, so a proposal cannot describe a schedule the rest
// of the app would then place somewhere else. Merchant identity is `normalizeMerchant`. No tolerance
// anywhere in this file is looser than the one the matcher already uses.

import { normalizeMerchant } from './merchant-memory';
import {
  detectAllRuleDrift, linkedRulesByMerchant, RECENT_WINDOW_MONTHS,
  type DriftRule, type DriftCharge, type DriftRuleLink,
} from './rule-drift';
import { buildRuleSuggestionIndex, monthOf } from './bank-activity-queue';
import {
  MIN_PROPOSAL_MONTHS, PROPOSAL_BAND_LOW, PROPOSAL_BAND_HIGH,
  type HistoryCharge, type ProposalRule, type ProposalDirection, type RuleProposal,
} from './rule-proposal';
import { getRuleOccurrenceDatesInMonth } from './pay-schedule';
import { daysBetween } from './transaction-matching';
import { suggestCategory } from './plaid-category-map';
import type { Category } from './types';

// Re-exported so this file stays the one place a caller has to know about: the thresholds and the
// shape are the contract of what it returns, and they live next door only to keep this file short.
export { MIN_PROPOSAL_MONTHS, PROPOSAL_BAND_LOW, PROPOSAL_BAND_HIGH } from './rule-proposal';
export type { HistoryCharge, ProposalRule, ProposalDirection, RuleProposal } from './rule-proposal';

/** Days between charges that read as one cadence. Tight — a wobble, not a schedule change. */
const WEEKLY_GAP = { min: 6, max: 8 } as const;
const BIWEEKLY_GAP = { min: 13, max: 15 } as const;

const cents = (value: number) => Math.round(value * 100) / 100;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The month `n` months after `YYYY-MM`. Built from parts — `new Date('YYYY-MM')` is UTC midnight. */
function addMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Local-time day parts of a `YYYY-MM-DD`. `new Date(iso)` is UTC midnight and shifts a day here. */
function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function dayOfWeek(date: string): number {
  const { year, month, day } = parts(date);
  return new Date(year, month - 1, day).getDay();
}

/** `Duke Energy` from `DUKE ENERGY`. The statement shouts; a budget line should not. */
function titleCase(label: string): string {
  return label.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

/**
 * Every merchant an existing rule is ALREADY about, by all four things the app already knows.
 *
 * ⚠️ COVERAGE IS NOT A SIMILARITY TEST WRITTEN HERE. Proposing a rule for a bill that already has
 * one double-counts it in every forecast, so this asks the surfaces that already answer the
 * question: the matcher (through the queue's own index), the drift detector (a rule with the WRONG
 * amount still covers its merchant — that is drift, not a missing rule), the user's own recorded
 * links, and finally the rule's name, which catches a rule whose account or day was never filled in.
 */
export function coveredMerchants(
  rules: readonly ProposalRule[],
  charges: readonly HistoryCharge[],
  links: readonly DriftRuleLink[],
): Set<string> {
  const covered = new Set<string>();
  const keyOf = new Map<string, string>();
  for (const charge of charges) {
    const key = normalizeMerchant((charge.merchant_name || charge.name || '').trim());
    if (key) keyOf.set(charge.id, key);
  }

  // 1. The app's own matcher: any charge a rule settles belongs to that rule.
  const months = [...new Set(charges.map(c => monthOf(c.date)))];
  const matchable = charges.map(c => ({
    id: c.id, account_id: c.account_id, amount: c.amount, date: c.date, pending: false,
  }));
  for (const chargeId of Object.keys(buildRuleSuggestionIndex(rules, months, matchable))) {
    const key = keyOf.get(chargeId);
    if (key) covered.add(key);
  }

  // 2. Drift: a rule whose amount has fallen behind its bill matches nothing, and still covers it.
  for (const drift of detectAllRuleDrift(rules as readonly DriftRule[], charges as readonly DriftCharge[], links)) {
    covered.add(drift.merchantKey);
  }

  // 3. The user's own words: a charge they linked to a rule by hand.
  for (const key of linkedRulesByMerchant(charges as readonly DriftCharge[], links).keys()) covered.add(key);

  // 4. The rule's name. Catches a rule that names no account and so can never match anything.
  for (const rule of rules) {
    const key = normalizeMerchant(rule.name);
    if (key) covered.add(key);
  }

  return covered;
}

/** One merchant's charges on one account in one direction — the unit a proposal is drawn from. */
interface ChargeGroup {
  merchantKey: string;
  merchantLabel: string;
  accountId: string;
  direction: ProposalDirection;
  /** Oldest first. */
  charges: HistoryCharge[];
}

function groupCharges(charges: readonly HistoryCharge[]): ChargeGroup[] {
  const groups = new Map<string, ChargeGroup>();
  for (const charge of charges) {
    if (!charge.account_id) continue;
    const signed = Number(charge.amount);
    if (!Number.isFinite(signed) || signed === 0) continue;
    const label = (charge.merchant_name || charge.name || '').trim();
    const merchantKey = normalizeMerchant(label);
    if (!merchantKey) continue;

    const direction: ProposalDirection = signed < 0 ? 'income' : 'expense';
    const id = `${merchantKey}|${charge.account_id}|${direction}`;
    const group = groups.get(id)
      ?? { merchantKey, merchantLabel: label, accountId: charge.account_id, direction, charges: [] };
    group.charges.push(charge);
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.charges.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
    // The most recent spelling of the name — what the statement reads like today, not in January.
    group.merchantLabel = (group.charges.at(-1)!.merchant_name || group.charges.at(-1)!.name || '').trim();
  }
  return [...groups.values()];
}

/** A cadence that fits a group, before it has been confirmed against the app's own calendar. */
interface Cadence {
  frequency: RuleProposal['frequency'];
  dueDay: number;
}

/**
 * The monthly reading: EXACTLY ONE charge in each of a run of consecutive calendar months.
 *
 * ⚠️ CALENDAR MONTHS, NOT A WINDOW AROUND A DAY — the same departure from `matchCharge`
 * `rule-drift.ts` makes, and for the same reason: the day is the thing that moves. Duke Energy is
 * due on the 1st and posts on the 4th, 5th, 6th and 7th. The once-a-month requirement is what makes
 * this safe without a category list: Publix and Amazon are excluded by their own frequency.
 */
function monthlyCadence(group: ChargeGroup, run: string[]): Cadence | null {
  if (run.length < MIN_PROPOSAL_MONTHS) return null;
  const days = run.map(month => parts(group.charges.find(c => monthOf(c.date) === month)!.date).day);
  // The median day, not the latest: one bill that slid to a Monday should not move the whole rule.
  return { frequency: 'monthly', dueDay: Math.round(median(days)) };
}

/** The 7- and 14-day readings: one weekday, held for the whole run. */
function rhythmCadence(group: ChargeGroup, run: string[]): Cadence | null {
  const dates = group.charges.filter(c => run.includes(monthOf(c.date))).map(c => c.date);
  if (dates.length < MIN_PROPOSAL_MONTHS * 2) return null;

  const weekday = dayOfWeek(dates[0]);
  if (dates.some(d => dayOfWeek(d) !== weekday)) return null;

  // `daysBetween` rather than a second date subtraction: `new Date('YYYY-MM-DD')` is UTC midnight
  // and shifts a day in every US timezone, which is exactly the bug that helper exists to hold.
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const fits = (band: { min: number; max: number }) => gaps.every(g => g >= band.min && g <= band.max);
  if (fits(WEEKLY_GAP)) return { frequency: 'weekly', dueDay: weekday };
  if (fits(BIWEEKLY_GAP)) return { frequency: 'biweekly', dueDay: weekday };
  return null;
}

/**
 * Does the app's own calendar produce this cadence, month for month?
 *
 * ⚠️ INTERIOR MONTHS ONLY. The first month of a run starts wherever the sync's history begins and
 * the last one is cut wherever the feed currently ends, so both are partial by construction and
 * comparing counts against them would reject every correct biweekly schedule. Everything between
 * them is a month we know we saw whole. A run of `MIN_PROPOSAL_MONTHS` always has at least one.
 *
 * Note this makes the three-month minimum true TWICE — the constant above, and the fact that a
 * two-month run has no interior month to confirm against and so can never be confirmed. That is
 * belt and braces on the one threshold worth being paranoid about, not an accident.
 */
function confirmedByCalendar(cadence: Cadence, group: ChargeGroup, run: string[], anchorDate: string): boolean {
  const interior = run.slice(1, -1);
  if (interior.length === 0) return false;
  for (const month of interior) {
    const [year, monthNumber] = month.split('-').map(Number);
    const generated = getRuleOccurrenceDatesInMonth(
      {
        frequency: cadence.frequency,
        due_day: cadence.dueDay,
        due_month: null,
        start_date: anchorDate,
        end_date: null,
        created_at: anchorDate,
      },
      year,
      monthNumber - 1,
    );
    const observed = group.charges.filter(c => monthOf(c.date) === month).length;
    if (generated.length !== observed) return false;
  }
  return true;
}

/**
 * THE FIGURE THE ACCEPT BUTTON WRITES: the MEDIAN of the recent window, not its average.
 *
 * Recent, because a bill's current price is the one the budget has to carry — the same
 * `RECENT_WINDOW_MONTHS` `rule-drift.ts` recommends from. MEDIAN rather than mean because this is a
 * FIRST DRAFT nobody has checked against anything: one month where the merchant billed a deposit, a
 * late fee or two cycles at once drags an average somewhere the user then has to notice and correct,
 * while the median of the same three months is still the price of the thing. Drift can afford the
 * mean because it is correcting a bill the user already told the app about; this cannot.
 */
function proposalAmount(group: ChargeGroup, run: string[]): number {
  const recentMonths = run.slice(-RECENT_WINDOW_MONTHS);
  const amounts = group.charges
    .filter(c => recentMonths.includes(monthOf(c.date)))
    .map(c => Math.abs(Number(c.amount)));
  return cents(median(amounts));
}

/** The consecutive months ending at the group's most recent, oldest first. */
function consecutiveRun(group: ChargeGroup): string[] {
  const months = new Set(group.charges.map(c => monthOf(c.date)));
  const latest = [...months].sort().pop()!;
  const run: string[] = [];
  for (let back = 0; ; back++) {
    const month = addMonth(latest, -back);
    if (!months.has(month)) break;
    run.unshift(month);
  }
  return run;
}

export interface ProposalInput {
  /** Every settled synced row, all accounts, all history. */
  charges: readonly HistoryCharge[];
  /** Every existing rule — read ONLY to exclude what is already covered. */
  rules: readonly ProposalRule[];
  /** `synced_transaction_reviews` rows: the user's own "this charge settles that rule". */
  links?: readonly DriftRuleLink[];
}

/**
 * The rules this history implies, best first.
 *
 * Income leads: a paycheck is the single most valuable rule a new user can have, and every cash
 * projection in the app is built on top of it. Within a direction, the biggest monthly figure first
 * — the order in which accepting one changes the picture most.
 */
export function proposeRulesFromHistory(input: ProposalInput): RuleProposal[] {
  const { charges, rules, links = [] } = input;
  if (charges.length === 0) return [];

  const covered = coveredMerchants(rules, charges, links);

  // ⚠️ "STILL BILLING" IS INFERRED FROM THE ROWS, NOT FROM A CLOCK — `rule-drift.ts`'s reasoning,
  // and taking a `today` would make every test time-dependent. One month of slack, because a bill
  // due on the 1st can post after the newest row in the feed.
  const latestObserved = charges.reduce((max, c) => (c.date > max ? c.date : max), '');
  const freshEnough = addMonth(monthOf(latestObserved), -1);

  const proposals: RuleProposal[] = [];
  for (const group of groupCharges(charges)) {
    if (covered.has(group.merchantKey)) continue;

    const run = consecutiveRun(group);
    if (run.length < MIN_PROPOSAL_MONTHS) continue;
    if (run[run.length - 1] < freshEnough) continue;

    // One amount has to describe the whole run, or there is nothing honest to put on the card.
    const amounts = group.charges
      .filter(c => run.includes(monthOf(c.date)))
      .map(c => Math.abs(Number(c.amount)));
    const centre = median(amounts);
    if (centre <= 0) continue;
    if (amounts.some(a => a < centre * PROPOSAL_BAND_LOW || a > centre * PROPOSAL_BAND_HIGH)) continue;

    const anchorDate = group.charges.find(c => monthOf(c.date) === run[0])!.date;
    // ⚠️ TWO CADENCES THAT BOTH FIT MEANS NEITHER IS OFFERED — the same shape as the two-qualifying-
    // merchants rule. In practice they are near-exclusive (a biweekly rhythm cannot also be one
    // charge a month), which is exactly why the guard costs nothing and is worth keeping honest.
    const fitting = [monthlyCadence(group, run), rhythmCadence(group, run)]
      .filter((c): c is Cadence => c !== null)
      .filter(c => confirmedByCalendar(c, group, run, anchorDate));
    if (fitting.length !== 1) continue;

    const cadence = fitting[0];
    const recent = group.charges.at(-1)!;
    proposals.push({
      id: `${group.merchantKey}|${group.accountId}|${group.direction}`,
      name: titleCase(group.merchantLabel),
      merchantLabel: group.merchantLabel,
      merchantKey: group.merchantKey,
      amount: proposalAmount(group, run),
      direction: group.direction,
      frequency: cadence.frequency,
      dueDay: cadence.dueDay,
      anchorDate,
      accountId: group.accountId,
      months: run,
      occurrences: group.charges.filter(c => run.includes(monthOf(c.date))).length,
      category: suggestCategory(recent.category),
    });
  }

  // ⚠️ ONE MERCHANT, TWO QUALIFYING PATTERNS, NO CARD. A merchant billing on two accounts leaves the
  // card with an account to name and the history refusing to say which — and the accept button
  // writes that account into a rule the matcher then uses to decide what settles it. Preferring the
  // longer or the newer run is a coin flip dressed as a heuristic. Every claimant goes quiet,
  // including the one that is right, exactly as `detectAllRuleDrift` does with a contested merchant.
  const claimants = new Map<string, number>();
  for (const proposal of proposals) {
    claimants.set(proposal.merchantKey, (claimants.get(proposal.merchantKey) ?? 0) + 1);
  }

  const monthlyEquivalent = (p: RuleProposal) =>
    p.amount * (p.frequency === 'weekly' ? 4.33 : p.frequency === 'biweekly' ? 2.17 : 1);

  return proposals
    .filter(p => claimants.get(p.merchantKey) === 1)
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'income' ? -1 : 1;
      return monthlyEquivalent(b) - monthlyEquivalent(a) || a.name.localeCompare(b.name);
    });
}
