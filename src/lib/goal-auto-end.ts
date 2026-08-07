// 97.3 — per-goal "auto-end contributions once the goal is hit".
//
// Unlike goal-linkage.ts (4b), which computes a read-path exclusion and never writes, this
// layer decides real `recurring_rules.end_date` WRITES, so the user sees the stop date on the
// rule in Budget Control like any other end-dated rule. 4b stays exactly as is and remains the
// correctness layer for users who never turn this toggle on; the two agree by construction
// because both derive from `computeGoalCompletionIdx`.
//
// Two hard rules live here rather than in the caller:
//  1. An `end_date` this feature did not write is NEVER overwritten or cleared. Provenance
//     comes from the `previousStamped` map (ruleId -> the date we wrote), persisted on the
//     goal — a rule carrying any other date is reported as a conflict for the UI to surface.
//  2. Turning the toggle off clears exactly the dates we wrote, and only while they are still
//     ours (a date the user has since edited by hand is left alone).
//
// ⚠️ Callers must invoke `planAutoEndWrites` on explicit save events only (goal save, rule
// save/edit, balance sync landing) — never inside a `useMemo`/render path. The engines in this
// codebase re-run on nearly every input change, so a write from a render path would hammer
// Supabase.

import {
  computeGoalCompletionIdx,
  resolveLinkedRuleIds,
  type AccountLike,
  type GoalLike,
  type RuleLike,
} from './goal-linkage';

/** A rule as this layer sees it: goal-linkage's shape plus the end_date it may already carry. */
export type AutoEndRuleLike = RuleLike & { end_date?: string | null };

/** ruleId -> the `end_date` (YYYY-MM-DD) this feature last wrote onto that rule. */
export type StampedMap = Record<string, string>;

export type AutoEndPlan = {
  /** The `recurring_rules` updates to issue. `null` end_date clears a stamp we own. */
  ruleWrites: { id: string; end_date: string | null }[];
  /** The stamp map to persist back onto the goal after `ruleWrites` are applied. */
  stamped: StampedMap;
  /** Linked rules left untouched because they carry a date the user set by hand. */
  conflicts: { ruleId: string; end_date: string }[];
};

export type AutoEndPlanInput = {
  enabled: boolean;
  goal: GoalLike;
  previousStamped: StampedMap;
  rules: AutoEndRuleLike[];
  accounts: AccountLike[];
  today?: Date;
};

/** `YYYY-MM-DD` for the last day of the month `offset` months from `today`. */
function lastDayOfMonth(today: Date, offset: number): string {
  // Day 0 of the following month = the last day of the target month.
  const d = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The `end_date` to stamp on this goal's linked rules: the last day of the month whose
 * contribution completes the goal, so the rule fires through that month and stops after. A
 * goal already at target stamps the end of the PREVIOUS month (no further contribution is
 * wanted at all). null when the goal never completes within the projection horizon.
 */
export function projectedAutoEndDate(
  goal: GoalLike,
  rules: AutoEndRuleLike[],
  accounts: AccountLike[],
  today: Date = new Date(),
): string | null {
  const completionIdx = computeGoalCompletionIdx(goal, rules, accounts, today);
  if (completionIdx == null) return null;
  return lastDayOfMonth(today, completionIdx === 0 ? -1 : completionIdx);
}

/**
 * Decide the `recurring_rules.end_date` writes for one goal's auto-end toggle. Pure: it issues
 * nothing, it only returns the writes plus the stamp map the caller must persist alongside them.
 */
export function planAutoEndWrites({
  enabled,
  goal,
  previousStamped,
  rules,
  accounts,
  today = new Date(),
}: AutoEndPlanInput): AutoEndPlan {
  const ruleWrites: AutoEndPlan['ruleWrites'] = [];
  const conflicts: AutoEndPlan['conflicts'] = [];
  const stamped: StampedMap = {};

  const findRule = (id: string) => rules.find((r) => r.id === id) ?? null;
  /** Our stamp is only ours to clear while the rule still carries the date we wrote. */
  const clearIfStillOurs = (id: string) => {
    const rule = findRule(id);
    if (rule && rule.end_date === previousStamped[id]) {
      ruleWrites.push({ id, end_date: null });
    }
  };

  if (!enabled) {
    for (const id of Object.keys(previousStamped)) clearIfStillOurs(id);
    return { ruleWrites, stamped, conflicts };
  }

  const linkedIds = resolveLinkedRuleIds(goal);
  const projected = projectedAutoEndDate(goal, rules, accounts, today);

  for (const id of linkedIds) {
    const rule = findRule(id);
    if (!rule) continue;

    const ours = previousStamped[id];
    if (rule.end_date && rule.end_date !== ours) {
      // A date we did not write. Never win silently — hand it to the UI instead.
      conflicts.push({ ruleId: id, end_date: rule.end_date });
      continue;
    }

    if (projected == null) {
      // The goal no longer completes (target raised, contributions cut): drop our stale stamp.
      if (ours) clearIfStillOurs(id);
      continue;
    }

    // Idempotent: re-stamping the same date every save would hammer Supabase for nothing.
    if (rule.end_date !== projected) ruleWrites.push({ id, end_date: projected });
    stamped[id] = projected;
  }

  // Rules the goal used to link and no longer does: our stamp there is orphaned.
  for (const id of Object.keys(previousStamped)) {
    if (!linkedIds.includes(id)) clearIfStillOurs(id);
  }

  return { ruleWrites, stamped, conflicts };
}
