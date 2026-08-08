// Guard for the 4b goal-auto-stop deferral (session 110).
//
// `calcCashOnlyMonthlyExpenses` (debt-transaction-generator.ts) and
// `buildCurrentMonthRecommendationSummary` (credit-card-engine.ts) both keep counting a
// transfer/investment rule as a cash outflow after its savings goal is fully funded, because
// `goals` are not in scope on either call chain. The debt engine therefore UNDER-recommends debt
// payments for any window between a goal completing and its funding rule ending.
//
// That was closed as a deliberate skip because the effect is $0 on real data: no goal completes
// inside the 60-month projection horizon, and 97.3's auto-end toggle already writes a real
// `recurring_rules.end_date` (which both sites DO honour) for goals that opt in.
//
// Both halves of that argument are properties of Tre's DATA, not of the code, so they can stop
// being true without anyone touching this repo. This file is the trigger: it fails the moment a
// goal would complete while its funding rule keeps running, which is exactly when threading a
// completion cutoff into the convergence loop starts being worth its risk.
//
// The predicate deliberately reuses `projectedAutoEndDate` rather than re-deriving completion
// math. That function IS 97.3's answer to "when should this goal's rules stop?", so the question
// below reduces to: would auto-end want to stamp a date these rules do not already satisfy?

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectedAutoEndDate, type AutoEndRuleLike } from '@/lib/goal-auto-end';
import {
  computeGoalCompletionIdx,
  resolveLinkedRuleIds,
  type GoalLike,
  type AccountLike,
} from '@/lib/goal-linkage';
import { PROJECTION_MONTHS } from '@/lib/scheduling';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

/**
 * Goals that complete within the projection horizon while at least one linked rule keeps
 * contributing past that point — i.e. the cases the deferred debt-engine sites get wrong.
 *
 * A rule is "still running" if it carries no `end_date` at all, or an `end_date` later than the
 * month the goal completes. Both are compared against `projectedAutoEndDate`, so this stays
 * consistent with what 97.3 would stamp by construction.
 */
function goalsWithUnendedContributions(
  goals: GoalLike[],
  rules: AutoEndRuleLike[],
  accounts: AccountLike[],
  today: Date,
): { goalId: string; completesBy: string; ruleIds: string[] }[] {
  const offenders: { goalId: string; completesBy: string; ruleIds: string[] }[] = [];

  for (const goal of goals) {
    // `computeGoalCompletionIdx` is NOT bounded by the debt engine's horizon — it happily returns
    // an index 14 years out. The deferred sites only project `PROJECTION_MONTHS`, so a goal that
    // completes past that is irrelevant to them and must not trip this guard. Bounding here rather
    // than treating a non-null result as in-horizon is the whole correctness of the predicate.
    const completionIdx = computeGoalCompletionIdx(goal, rules, accounts, today);
    if (completionIdx == null || completionIdx > PROJECTION_MONTHS) continue;

    const completesBy = projectedAutoEndDate(goal, rules, accounts, today);
    if (completesBy == null) continue;

    const overrunning = resolveLinkedRuleIds(goal)
      .map((id) => rules.find((r) => r.id === id))
      .filter((r): r is AutoEndRuleLike => r != null)
      .filter((r) => !r.end_date || r.end_date > completesBy)
      .map((r) => r.id as string);

    if (overrunning.length > 0) {
      offenders.push({ goalId: goal.id ?? '(unnamed)', completesBy, ruleIds: overrunning });
    }
  }

  return offenders;
}

const TODAY = new Date(2026, 7, 8); // 2026-08-08, local — the helpers all do local date math.

/** A goal funded only by `ruleId`, with no linked account so APY does not enter the arithmetic. */
const goal = (id: string, target: number, current: number, ruleId: string): GoalLike => ({
  id,
  target_amount: target,
  current_amount: current,
  linked_rule_ids: [ruleId],
});

const rule = (id: string, amount: number, end_date: string | null = null): AutoEndRuleLike => ({
  id,
  amount,
  frequency: 'monthly',
  start_date: '2026-01-01',
  end_date,
});

describe('4b deferral guard — goals whose funding outlives them', () => {
  it('flags a goal that completes in-horizon while its rule runs on', () => {
    // $1,000 to go at $100/mo => done in ~10 months, rule never ends.
    const goals = [goal('g1', 1000, 0, 'r1')];
    const rules = [rule('r1', 100)];

    const found = goalsWithUnendedContributions(goals, rules, [], TODAY);

    expect(found).toHaveLength(1);
    expect(found[0].goalId).toBe('g1');
    expect(found[0].ruleIds).toEqual(['r1']);
  });

  it('does not flag the same goal once its rule carries an end_date that stops in time', () => {
    const goals = [goal('g1', 1000, 0, 'r1')];
    const completesBy = projectedAutoEndDate(goals[0], [rule('r1', 100)], [], TODAY);
    expect(completesBy).not.toBeNull();

    // The end_date both deferred sites already honour. This is the 97.3 auto-end case.
    const found = goalsWithUnendedContributions(goals, [rule('r1', 100, completesBy)], [], TODAY);

    expect(found).toEqual([]);
  });

  it('still flags a rule whose end_date is LATER than completion', () => {
    const goals = [goal('g1', 1000, 0, 'r1')];
    const found = goalsWithUnendedContributions(goals, [rule('r1', 100, '2099-12-31')], [], TODAY);

    expect(found).toHaveLength(1);
  });

  it('does not flag a goal that completes only BEYOND the debt engine horizon', () => {
    // $2,500 at $25/mo is ~100 months: past the debt engine's 60, but still inside
    // `computeGoalCompletionIdx`'s own (much longer) horizon, so it DOES return an index here.
    // The bound in the predicate is what keeps it out — this is the exact shape that made the
    // first version of this guard fail against real data, where goals complete 9-14 years out.
    const goals = [goal('g1', 2500, 0, 'r1')];
    const rules = [rule('r1', 25)];

    expect(computeGoalCompletionIdx(goals[0], rules, [], TODAY)).toBeGreaterThan(PROJECTION_MONTHS);
    expect(goalsWithUnendedContributions(goals, rules, [], TODAY)).toEqual([]);
  });
});

// ── The actual trigger, against Tre's real captured data ────────────────────────────────────────
// The fixture is gitignored (it is real financial data and this repo is public), so this skips
// wherever it is absent — CI included. It is the local run that matters: that is where the data
// lives and where the deferral would need revisiting.

const FIXTURE = resolve(__dirname, 'fixtures/forecast-inputs.real.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

describe('4b deferral guard — real data', () => {
  maybeIt('no real goal completes while its funding rule keeps running', () => {
    const capture = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    const { goals = [], rules = [], accounts = [] } = capture.inputs as unknown as {
      goals?: GoalLike[];
      rules?: AutoEndRuleLike[];
      accounts?: AccountLike[];
    };

    // Pin the clock to the capture, as the other fixture tests do — completion is measured in
    // months from "now", so a drifting clock would slowly change the answer on its own.
    const found = goalsWithUnendedContributions(
      goals,
      rules,
      accounts,
      new Date(capture.capturedAt),
    );

    expect(
      found,
      'A savings goal now completes inside the projection horizon while its linked rule keeps '
        + 'contributing. That is the REOPEN trigger for the 4b goal-auto-stop deferral: the debt '
        + 'engine will under-recommend payments between completion and the rule ending. See the '
        + 'note on calcCashOnlyMonthlyExpenses in debt-transaction-generator.ts.',
    ).toEqual([]);
  });
});
