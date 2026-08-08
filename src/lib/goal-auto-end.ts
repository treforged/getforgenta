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
//
// All three of those sites are now wired. Goal save calls `planAutoEndWrites` directly (it owns
// the toggle, so it is the only site allowed to CLEAR stamps); the other two go through
// `planAutoEndReconcile` below, which re-plans every enabled goal and never clears anything.

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

/**
 * `savings_goals.auto_end_stamped_rules` (jsonb, so `unknown` at the type level) narrowed to the
 * ruleId -> end_date map. Lives here rather than on a page because all three trigger sites read
 * the same column and a second narrowing would be a place for them to disagree.
 */
export function toStampedMap(value: unknown): StampedMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

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

/** A `savings_goals` row as the reconcile layer sees it. */
export type AutoEndGoalRow = GoalLike & {
  auto_end_contributions?: boolean | null;
  /** Raw jsonb; narrowed with `toStampedMap`. */
  auto_end_stamped_rules?: unknown;
};

export type AutoEndReconcilePlan = {
  /** `recurring_rules` updates to issue. Never contains a clear — reconcile only re-stamps. */
  ruleWrites: { id: string; end_date: string }[];
  /** `savings_goals` stamp-map updates, emitted only for goals whose map actually moved. */
  goalWrites: { id: string; auto_end_stamped_rules: StampedMap }[];
  conflicts: { goalId: string; ruleId: string; end_date: string }[];
};

const sameMap = (a: StampedMap, b: StampedMap): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/**
 * Re-plan the stamps for every goal with the toggle ON, for the two trigger sites that are not
 * the goal form: a linked rule being saved in Budget Control, and freshly synced balances
 * landing. Pure — the caller issues the writes.
 *
 * Deliberately narrower than `planAutoEndWrites`:
 *  - a goal with the toggle OFF is skipped entirely, never cleared. Clearing is the goal form's
 *    job, because only the form knows the user just turned the toggle off; a rule save or a
 *    balance sync must never be able to strip an end_date.
 *  - `goalWrites` is emitted only when the map genuinely changed. Together with
 *    `planAutoEndWrites`'s own idempotence this makes a steady-state reconcile issue ZERO
 *    writes, which is what lets the sync-landing caller run from an effect without looping.
 */
export function planAutoEndReconcile({
  goals,
  rules,
  accounts,
  today = new Date(),
}: {
  goals: AutoEndGoalRow[];
  rules: AutoEndRuleLike[];
  accounts: AccountLike[];
  today?: Date;
}): AutoEndReconcilePlan {
  const plan: AutoEndReconcilePlan = { ruleWrites: [], goalWrites: [], conflicts: [] };

  for (const goal of goals) {
    if (!goal.auto_end_contributions || !goal.id) continue;

    const previousStamped = toStampedMap(goal.auto_end_stamped_rules);
    const goalPlan = planAutoEndWrites({
      enabled: true,
      goal,
      previousStamped,
      rules,
      accounts,
      today,
    });

    for (const w of goalPlan.ruleWrites) {
      // enabled:true only ever clears an ORPHANED stamp (a rule the goal no longer links). A
      // rule save or balance sync is not evidence of unlinking, so drop clears defensively and
      // leave them to the goal form.
      if (w.end_date != null) plan.ruleWrites.push({ id: w.id, end_date: w.end_date });
    }
    for (const c of goalPlan.conflicts) {
      plan.conflicts.push({ goalId: goal.id, ruleId: c.ruleId, end_date: c.end_date });
    }
    if (!sameMap(goalPlan.stamped, previousStamped)) {
      plan.goalWrites.push({ id: goal.id, auto_end_stamped_rules: goalPlan.stamped });
    }
  }

  return plan;
}
