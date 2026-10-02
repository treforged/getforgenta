// Shared primitive behind handoff item 4b: once a savings_goals row (linked to one or more
// recurring_rules transfer/investment rules via linked_rule_ids / legacy linked_rule_id) has
// reached its target_amount, the linked rule should stop being counted as an ongoing
// contribution — in the Forecast projection, the Dashboard tile, the Debt Payoff engine's
// mirror sim, and the Goals page's own display. Nothing previously checked this.
//
// Non-destructive by design (see handoff.md): this never writes to recurring_rules or
// savings_goals. It only tells each read-path consumer which month index to stop COUNTING a
// rule's dollars from, mirroring how `end_date` already works everywhere else — a computed
// exclusion in the read path, not a stored one. Reversible the moment the goal's target rises.

import { contributionCutoffIdx, estimateGoalCompletionMonths, getGoalEffectiveApyPercent, type ApyAccountLike } from './savings-growth';

export type GoalLike = {
  id?: string | null;
  target_amount?: number | null;
  current_amount?: number | null;
  monthly_contribution?: number | null;
  linked_account?: string | null;
  also_linked_accounts?: string[] | null;
  linked_rule_id?: string | null;
  linked_rule_ids?: string[] | null;
  contribution_start_date?: string | null;
  lump_sum_payments?: unknown;
};

export type RuleLike = {
  id?: string | null;
  amount?: number | null;
  frequency?: string | null;
  start_date?: string | null;
};

export type AccountLike = ApyAccountLike & { id?: string | null; balance?: number | null };

const toMonthly = (amount: number, freq: string | null | undefined): number =>
  freq === 'weekly' ? amount * 52 / 12
  : freq === 'biweekly' ? amount * 26 / 12
  : freq === 'yearly' ? amount / 12
  : amount;

/**
 * The live balance a goal tracks: its PRIMARY `linked_account` plus every resolvable account in
 * `also_linked_accounts` (ask 4674b24a). Null when the primary does not resolve, so callers keep
 * falling back to `current_amount` exactly as before. An extra that does not resolve (deleted,
 * inactive) adds nothing rather than a confident $0 claim about it, and duplicates or the primary
 * repeated in the list are counted once.
 */
export function goalLinkedBalance(
  goal: Pick<GoalLike, 'linked_account' | 'also_linked_accounts'>,
  balanceOf: (accountId: string) => number | null | undefined,
): number | null {
  if (!goal.linked_account) return null;
  const primary = balanceOf(goal.linked_account);
  if (primary == null || !Number.isFinite(Number(primary))) return null;
  const seen = new Set<string>([goal.linked_account]);
  let total = Number(primary);
  for (const id of goal.also_linked_accounts ?? []) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const b = balanceOf(id);
    if (b != null && Number.isFinite(Number(b))) total += Number(b);
  }
  return total;
}

export function resolveLinkedRuleIds(goal: GoalLike): string[] {
  return (goal.linked_rule_ids ?? []).length > 0
    ? (goal.linked_rule_ids as string[])
    : goal.linked_rule_id ? [goal.linked_rule_id] : [];
}

/**
 * The month index (0 = the current month, same base as forecast-engine's `i` and
 * useCardProjection's `idx`) whose contribution first carries `goal` to its target, or null if
 * it never gets there within the horizon. 0 means "already at/above target before any
 * contribution is simulated".
 *
 * When the goal has linked rules, their combined monthly amount and earliest start date are
 * used (matching what actually funds the goal); otherwise falls back to the goal's own
 * `monthly_contribution`/`contribution_start_date` fields, so a goal with no linked rule at
 * all is still covered.
 *
 * Exported so 97.3's `goal-auto-end.ts` stamps its `end_date` off the SAME projection 4b's
 * cutoffs read — a second hand-rolled projection is how the two would silently drift.
 */
export function computeGoalCompletionIdx(
  goal: GoalLike,
  rules: RuleLike[],
  accounts: AccountLike[],
  today: Date,
): number | null {
  const ruleIds = resolveLinkedRuleIds(goal);
  const linkedRules = ruleIds
    .map((id) => rules.find((r) => r.id === id))
    .filter((r): r is RuleLike => r != null);
  const linkedAcct = goal.linked_account ? accounts.find((a) => a.id === goal.linked_account) : null;
  const effectiveApyPercent = getGoalEffectiveApyPercent(linkedAcct ?? null);

  const earliestStart = linkedRules
    .map((r) => r.start_date)
    .filter((d): d is string => d != null)
    .sort()[0] ?? null;
  const contributionStartDate = earliestStart ?? goal.contribution_start_date ?? null;

  const monthlyContribution = linkedRules.length > 0
    ? linkedRules.reduce((s, r) => s + toMonthly(Number(r.amount), r.frequency), 0)
    : Number(goal.monthly_contribution);
  const linkedTotal = goalLinkedBalance(goal, (id) => {
    const a = accounts.find((x) => x.id === id);
    return a ? Number(a.balance) : null;
  });
  const currentAmount = linkedTotal ?? Number(goal.current_amount);
  const lumpSums = Array.isArray(goal.lump_sum_payments)
    ? (goal.lump_sum_payments as { date: string; amount: number }[]).map((ls) => ({ date: ls.date, amount: Number(ls.amount) }))
    : [];

  const completionIdx = estimateGoalCompletionMonths(
    {
      id: goal.id ?? '',
      name: '',
      currentAmount,
      monthlyContribution,
      annualApyPercent: effectiveApyPercent,
      contributionStartDate,
      lumpSums,
    },
    Number(goal.target_amount),
    { today },
  );
  return completionIdx;
}

/**
 * The first month index at which `goal`'s contributions should STOP being counted. 0 means
 * "stop immediately, including month 0". k>0 means month k's contribution was the one that
 * tipped it over, so months 0..k still count and only k+1 onward is excluded. null = never
 * completes within the horizon.
 */
function computeGoalCutoffIdx(
  goal: GoalLike,
  rules: RuleLike[],
  accounts: AccountLike[],
  today: Date,
): number | null {
  // The +1 / 0 rule itself lives in savings-growth so the Goals chart stops contributing in the
  // same month these engine cutoffs do. null = never completes within the horizon.
  return contributionCutoffIdx(computeGoalCompletionIdx(goal, rules, accounts, today));
}

/**
 * ruleId -> the first month index at which that rule should STOP contributing, because every
 * goal it funds has already reached its target by then. Absent from the map = never stops
 * (goal never completes within the horizon, or the rule isn't goal-linked) — i.e. current
 * behavior, unchanged.
 *
 * If a rule funds more than one goal (rare — linked_rule_ids is goal->rules, so this is
 * theoretically possible), takes the MAX cutoff across those goals: keep transferring until
 * the LAST goal it feeds is done, never the first.
 */
export function buildGoalTransferCutoffs(
  goals: GoalLike[],
  rules: RuleLike[],
  accounts: AccountLike[],
  today: Date = new Date(),
): Map<string, number> {
  const cutoffs = new Map<string, number>();

  for (const goal of goals) {
    const ruleIds = resolveLinkedRuleIds(goal);
    if (ruleIds.length === 0) continue;

    const cutoffIdx = computeGoalCutoffIdx(goal, rules, accounts, today);
    if (cutoffIdx == null) continue;

    for (const ruleId of ruleIds) {
      cutoffs.set(ruleId, Math.max(cutoffs.get(ruleId) ?? -Infinity, cutoffIdx));
    }
  }

  return cutoffs;
}

/**
 * goalId -> the first month index at which a goal with NO linked rule (a raw
 * `monthly_contribution`, per forecast-engine.ts's "unlinked-goal path") should stop being
 * counted, because it has already reached its target by then. Companion to
 * `buildGoalTransferCutoffs` for the sites that separately sum unlinked goals' own
 * contributions. Absent from the map = never stops.
 */
export function buildGoalOwnCompletionCutoffs(
  goals: GoalLike[],
  rules: RuleLike[],
  accounts: AccountLike[],
  today: Date = new Date(),
): Map<string, number> {
  const cutoffs = new Map<string, number>();
  for (const goal of goals) {
    if (!goal.id) continue;
    const cutoffIdx = computeGoalCutoffIdx(goal, rules, accounts, today);
    if (cutoffIdx == null) continue;
    cutoffs.set(goal.id, cutoffIdx);
  }
  return cutoffs;
}
