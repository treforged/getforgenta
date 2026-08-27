// A STAGED SAVINGS GOAL — one goal, N thresholds, one balance.
//
// Tre, 2026-08-26: fill the move fund, then three months of expenses, then STOP and throw
// everything at the cards, then come back for months four to six.
//
// REDESIGNED the same day: the move fund is a STOP IN ITS OWN RIGHT rather than a base the runway
// is measured up from, there can be any number of stops, and each carries its own date. The plan
// lives in `savings_goals.stages`; the two `emergency_months_stage1/2` columns are read only when
// that array is empty, and the tests below pin both readers producing the same thresholds.
//
// This is money math on a live balance, so what is pinned here is the DECISION at each step rather
// than one end-to-end total:
//   (a) what a month of essential cost is, one rule source at a time (`isEssentialExpenseRule`);
//   (b) where the stops land, cumulatively (`goalStages`, `openThresholdOf`);
//   (c) which one the goal is chasing right now (`stagedTargetFor`), including the hand-off;
//   (d) the engine funding a stop when its RANK comes up rather than when a flag opens, and
//       drawing nothing for a stop the user has not ticked;
//   (e) the annual IRA cap actually binding the waterfall, and paying level.
//
// Would-fail check for (b): make `openThresholdOf` return `stages.total` and five tests fail.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  goalStages, openThresholdOf, stagedTargetFor, goalRemainingNeed, revolvingRemainingOf,
  type GoalStageContext, type RankableGoal,
} from '../ranked-extra-payment-targets';
import {
  computeEssentialMonthlyExpenses, isEssentialExpenseRule, type EssentialRule,
} from '../essential-monthly-expenses';
import {
  buildSurplusRankRows, enforceStopOrder, moveSurplusRankRow, planAutoExtraDeselect,
  planSurplusRankWrites, setSurplusRankAutoExtra, type SurplusRankRow,
} from '../surplus-ranking';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { IRA_ANNUAL_LIMIT } from '../retirement-contribution-cap';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult, Month0Result } from '@/lib/debt-model-types';
import type { CarFund } from '../types';
import type { Tables } from '@/integrations/supabase/types';

// ── (a) WHAT COUNTS AS A MONTH OF KEEPING THE LIGHTS ON ──────────────────────

describe('isEssentialExpenseRule — one payment source at a time', () => {
  const CARDS = new Set(['card-1', 'account:card-1']);
  const CHK = 'chk-1';
  const rule = (over: Partial<EssentialRule> = {}): EssentialRule =>
    ({ active: true, rule_type: 'expense', amount: 100, frequency: 'monthly', ...over });

  it('counts a rule with NO source — every other reader treats that as the funding account', () => {
    expect(isEssentialExpenseRule(rule(), CARDS, CHK)).toBe(true);
  });

  it('counts a rule paid from the funding account, bare or `account:`-prefixed', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: CHK }), CARDS, CHK)).toBe(true);
    expect(isEssentialExpenseRule(rule({ payment_source: `account:${CHK}` }), CARDS, CHK)).toBe(true);
  });

  it('COUNTS a rule charged to a credit card — the card is how it is paid, not a reason it is '
    + 'optional. This is the ~$700/mo `baseExpenses` misses on Tre\'s own rows', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'card-1' }), CARDS, CHK)).toBe(true);
    expect(isEssentialExpenseRule(rule({ payment_source: 'account:card-1' }), CARDS, CHK)).toBe(true);
  });

  it('EXCLUDES a rule paid from another bank account — no cash impact, same as the month drawer', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'biz-1' }), CARDS, CHK)).toBe(false);
    expect(isEssentialExpenseRule(rule({ payment_source: 'account:biz-1' }), CARDS, CHK)).toBe(false);
  });

  it('excludes an inactive rule and anything that is not an expense', () => {
    expect(isEssentialExpenseRule(rule({ active: false }), CARDS, CHK)).toBe(false);
    expect(isEssentialExpenseRule(rule({ rule_type: 'income' }), CARDS, CHK)).toBe(false);
  });

  it('with NO funding account, excludes nothing — over-reporting a runway is the safe error', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'biz-1' }), CARDS, null)).toBe(true);
  });
});

describe('computeEssentialMonthlyExpenses', () => {
  const accounts = [
    { id: 'chk-1', account_type: 'checking', active: true },
    { id: 'card-1', account_type: 'credit_card', active: true },
    { id: 'biz-1', account_type: 'checking', active: true },
  ];
  const rule = (amount: number, payment_source: string | null): EssentialRule =>
    ({ active: true, rule_type: 'expense', amount, frequency: 'monthly', due_day: 1, payment_source });

  it('sums checking-paid and card-charged rules and drops the business account', () => {
    const monthly = computeEssentialMonthlyExpenses({
      rules: [rule(1_200, null), rule(300, 'account:card-1'), rule(100, 'account:biz-1')],
      accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'),
    });
    expect(monthly).toBe(1_500);
  });

  it('returns 0 when there is nothing to measure, rather than a guess', () => {
    expect(computeEssentialMonthlyExpenses({
      rules: [], accounts, carFunds: [], fundingAccountId: 'chk-1',
    })).toBe(0);
  });

  it('averages the window, so a weekly rule is not whichever of 4 or 5 the calendar produced', () => {
    // 52 weeks over 12 months is 4.333 occurrences a month, which no single month ever shows.
    const monthly = computeEssentialMonthlyExpenses({
      rules: [{ active: true, rule_type: 'expense', amount: 100, frequency: 'weekly', due_day: 1,
        start_date: '2026-01-01' }],
      accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 12,
    });
    expect(monthly).toBeGreaterThan(4 * 100);
    expect(monthly).toBeLessThan(5 * 100);
  });

  it('includes the vehicle loan payment and its insurance — both are cash out and neither is a rule', () => {
    const carFunds = [{
      id: 'cf-1', phase: 'loan', monthly_insurance: 173,
      insurance_start_date: '2026-01-01',
      loan_start_date: '2026-01-01', payment_start_date: '2026-01-01',
      loan_amount: 20_000, expected_apr: 6, loan_term_months: 60,
      actual_monthly_payment: 423, lump_sum_payments: [],
    } as unknown as CarFund];
    const withCar = computeEssentialMonthlyExpenses({
      rules: [rule(1_000, null)], accounts, carFunds, fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 1,
    });
    const withoutCar = computeEssentialMonthlyExpenses({
      rules: [rule(1_000, null)], accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 1,
    });
    expect(withCar - withoutCar).toBeCloseTo(423 + 173, 2);
  });
});

// ── (b) AND (c) THE TWO THRESHOLDS, AND WHICH ONE IS BEING CHASED ────────────

const staged = (over: Partial<RankableGoal> = {}): RankableGoal => ({
  id: 'g-1', target_amount: 5_730, current_amount: 0, auto_extra: true, sort_order: 0,
  emergency_months_stage1: 3, emergency_months_stage2: 6, ...over,
});

describe('goalStages — cumulative stops, the legacy columns read as three of them', () => {
  it('turns the two-column plan into base / +3E / +3E-after-cards, thresholds unchanged', () => {
    const s = goalStages(staged(), 1_000);
    expect(s.staged).toBe(true);
    expect(s.stops.map(x => x.threshold)).toEqual([5_730, 8_730, 11_730]);
    expect(s.stops.map(x => x.size)).toEqual([5_730, 3_000, 3_000]);
    expect(s.stops.map(x => x.afterCards)).toEqual([false, false, true]);
    expect(s.total).toBe(11_730);
  });

  it('is NOT staged when the goal has no stage 1 — every ordinary goal, and the whole opt-out', () => {
    const s = goalStages(staged({ emergency_months_stage1: null }), 1_000);
    expect(s.staged).toBe(false);
    expect(s.total).toBe(5_730);
    expect(s.stops).toHaveLength(1);
  });

  it('is NOT staged when there is no expense figure to multiply — a target nobody derived is not '
    + 'a target this app will move money against', () => {
    expect(goalStages(staged(), 0).staged).toBe(false);
    expect(goalStages(staged(), Number.NaN).staged).toBe(false);
  });

  it('collapses to two stops when only stage 1 is set — "and then stop"', () => {
    const s = goalStages(staged({ emergency_months_stage2: null }), 1_000);
    expect(s.stops.map(x => x.threshold)).toEqual([5_730, 8_730]);
    expect(s.total).toBe(8_730);
  });

  it('never lets a legacy stage 2 BELOW stage 1 add a stop, whatever is stored', () => {
    const s = goalStages(staged({ emergency_months_stage1: 6, emergency_months_stage2: 3 }), 1_000);
    expect(s.stops).toHaveLength(2);
    expect(s.total).toBe(11_730);
  });
});

// ── THE N-STAGE PLAN (Tre, 2026-08-26) ───────────────────────────────────────
//
// The move fund is stop #1 in its own right, there can be any number of stops, each is sized by a
// dollar amount OR a months multiplier, and each carries its own date. Thresholds are CUMULATIVE.

describe('goalStages — stored `stages` wins over everything', () => {
  const withStops = (stages: unknown, over: Partial<RankableGoal> = {}): RankableGoal => ({
    id: 'g-1', target_amount: 99_999, current_amount: 0, auto_extra: true, sort_order: 0,
    emergency_months_stage1: 3, emergency_months_stage2: 6, stages, ...over,
  });

  it('adds the stops up and IGNORES target_amount — which is a cached display total, so counting '
    + 'it would double the first stop', () => {
    const s = goalStages(withStops([
      { id: 'a', name: 'Move fund', amount: 5_730 },
      { id: 'b', name: 'Three months', months: 3 },
      { id: 'c', name: 'Three more', months: 3, after_cards: true },
    ]), 1_000);
    expect(s.staged).toBe(true);
    expect(s.stops.map(x => x.threshold)).toEqual([5_730, 8_730, 11_730]);
    expect(s.stops.map(x => x.name)).toEqual(['Move fund', 'Three months', 'Three more']);
    expect(s.total).toBe(11_730);
  });

  it('carries a per-stop date, which is the whole reason the goal-level one had to go', () => {
    const s = goalStages(withStops([
      { id: 'a', amount: 5_730, target_date: '2027-07-03' },
      { id: 'b', months: 3, target_date: '2028-01-31' },
    ]), 1_000);
    expect(s.stops.map(x => x.targetDate)).toEqual(['2027-07-03', '2028-01-31']);
  });

  it('takes five stops as happily as two — "be able to add multiple planned stops"', () => {
    const s = goalStages(withStops(
      [100, 200, 300, 400, 500].map((amount, i) => ({ id: `s${i}`, amount })),
    ), 1_000);
    expect(s.stops.map(x => x.threshold)).toEqual([100, 300, 600, 1_000, 1_500]);
  });

  it('DROPS a stop it cannot size rather than storing it as a zero — a zero-size stop reads as '
    + 'already filled the moment it is created', () => {
    const s = goalStages(withStops([
      { id: 'a', amount: 1_000 },
      { id: 'b' },                              // sized by neither
      { id: 'c', amount: 500, months: 2 },      // sized by both
      { id: 'd', months: -1 },                  // not a multiplier
      { id: 'e', amount: 250 },
    ]), 1_000);
    expect(s.stops.map(x => x.threshold)).toEqual([1_000, 1_250]);
  });

  it('drops a MONTHS stop when there is no expense figure, rather than multiplying nothing', () => {
    const s = goalStages(withStops([
      { id: 'a', amount: 1_000 },
      { id: 'b', months: 3 },
    ]), 0);
    expect(s.stops.map(x => x.threshold)).toEqual([1_000]);
    expect(s.total).toBe(1_000);
  });

  it('falls back to the legacy columns only when `stages` is empty or not an array', () => {
    expect(goalStages(withStops([]), 1_000).total).toBe(99_999 + 6_000);
    expect(goalStages(withStops('nonsense'), 1_000).total).toBe(99_999 + 6_000);
  });
});

describe('openThresholdOf — where the plan is cut in two by the hand-off', () => {
  const plan = (stages: unknown) => goalStages(
    { target_amount: 0, current_amount: 0, stages }, 1_000,
  );

  it('is the threshold BEFORE the first waiting stop', () => {
    expect(openThresholdOf(plan([
      { id: 'a', amount: 5_730 }, { id: 'b', months: 3 }, { id: 'c', months: 3, after_cards: true },
    ]))).toBe(8_730);
  });

  it('is the whole total when nothing waits', () => {
    expect(openThresholdOf(plan([{ id: 'a', amount: 100 }, { id: 'b', amount: 200 }]))).toBe(300);
  });

  it('is ZERO when the very first stop waits — a plan that starts blocked draws nothing', () => {
    expect(openThresholdOf(plan([{ id: 'a', amount: 100, after_cards: true }]))).toBe(0);
  });

  it('covers every stop after the first waiting one, because cards clear exactly once', () => {
    const p = plan([
      { id: 'a', amount: 100 },
      { id: 'b', amount: 200, after_cards: true },
      { id: 'c', amount: 300 },
    ]);
    expect(openThresholdOf(p)).toBe(100);
    expect(p.total).toBe(600);
  });
});

describe('stagedTargetFor — the hand-off to the cards', () => {
  const ctx = (revolvingRemaining: number): GoalStageContext =>
    ({ essentialMonthlyExpenses: 1_000, revolvingRemaining });

  it('chases stage 1 while it is still short, cards or no cards', () => {
    expect(stagedTargetFor(staged({ current_amount: 6_000 }), ctx(9_999))).toBe(8_730);
    expect(stagedTargetFor(staged({ current_amount: 6_000 }), ctx(0))).toBe(8_730);
  });

  it('HOLDS at stage 1 once it is reached while any revolving balance remains — capacity 0, which '
    + 'is already how a rank yields its dollars to the next one', () => {
    const g = staged({ current_amount: 8_730 });
    expect(stagedTargetFor(g, ctx(1))).toBe(8_730);
    expect(goalRemainingNeed(g, ctx(1))).toBe(0);
  });

  it('opens stage 2 the moment revolving debt is gone', () => {
    const g = staged({ current_amount: 8_730 });
    expect(stagedTargetFor(g, ctx(0))).toBe(11_730);
    expect(goalRemainingNeed(g, ctx(0))).toBe(3_000);
  });

  it('reports the BASE target with no context at all — a caller that cannot size the stages must '
    + 'not offer capacity it cannot explain', () => {
    expect(goalRemainingNeed(staged())).toBe(5_730);
  });
});

describe('revolvingRemainingOf', () => {
  it('sums positive balances and ignores a card on autopay-in-full', () => {
    expect(revolvingRemainingOf([
      { balance: 1_000 }, { balance: 500 },
      { balance: 900, autopayFullBalance: true },
      { balance: 0 }, { balance: -20 }, { balance: null },
    ])).toBe(1_500);
  });
});

// ── THE RANKED LIST AGREES WITH THE ENGINE ───────────────────────────────────

describe('buildSurplusRankRows — one row per unfilled stop, each one real', () => {
  const goalRowFor = (over: Partial<RankableGoal> = {}) =>
    ({ ...staged(over), name: 'Move fund, then emergency fund', created_at: '2026-01-01' });

  /** The list always carries the card BLOCK row too, so the goal is looked up rather than indexed. */
  const goalRow1 = (p: Parameters<typeof buildSurplusRankRows>[0]) =>
    buildSurplusRankRows(p).find(r => r.id === 'g-1')!;

  it('shows the FIRST STOP alone, not the whole plan — the move fund is a stop in its own right', () => {
    // Before the redesign this row printed 8,730: the move money and three months of expenses fused
    // into one number. Tre, 2026-08-26: "the original $5,730 should show as the first stage since
    // its only for the move fund part."
    expect(goalRow1({
      goals: [goalRowFor()], carFunds: [], essentialMonthlyExpenses: 1_000,
    }).remaining).toBe(5_730);
  });

  it('gives EVERY stop its own row, its own dollars and its own Auto extra tick', () => {
    // Tre, 2026-08-26: "each part of the stagger should always have the choice of extra payments."
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({
        auto_extra: true,
        stages: [
          { id: 'a', name: 'Move fund', amount: 5_730 },
          { id: 'b', name: 'Runway', months: 3, auto_extra: true },
          { id: 'c', name: 'Full runway', months: 3, auto_extra: false },
        ],
      })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    }).filter(r => r.kind === 'goal');
    expect(rows.map(r => r.id)).toEqual(['g-1', 'g-1::stop2', 'g-1::stop3']);
    // Each row carries its OWN dollars, so the rows sum to the plan rather than each restating it.
    expect(rows.map(r => r.remaining)).toEqual([5_730, 3_000, 3_000]);
    // Stop 1 inherits the goal's own column; the others read their own.
    expect(rows.map(r => r.autoExtra)).toEqual([true, true, false]);
    // And every one of them knows which jsonb entry a write should patch.
    expect(rows.map(r => r.stageId)).toEqual(['a', 'b', 'c']);
    expect(rows.every(r => r.goalId === 'g-1')).toBe(true);
  });

  it('seats a stop at its OWN stored rank — "emergency 2 should be behind all the credit cards, '
    + 'then 3 is behind the loan"', () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({
        sort_order: 1,
        stages: [
          { id: 'a', amount: 5_730, sort_order: 1 },
          { id: 'b', months: 3, sort_order: 6 },
          { id: 'c', months: 3, sort_order: 8 },
        ],
      })],
      carFunds: [],
      cards: [
        { id: 'visa', balance: 2_000, surplus_sort_order: 0 },
        { id: 'discover', balance: 2_000, surplus_sort_order: 3 },
      ],
      liabilities: [{ id: 'loan-1', name: 'Car loan', account_type: 'other_liability', balance: 9_000, surplus_sort_order: 7 }],
      essentialMonthlyExpenses: 1_000,
    });
    expect(rows.map(r => r.id)).toEqual(['visa', 'g-1', 'discover', 'g-1::stop2', 'loan-1', 'g-1::stop3']);
  });

  it('DEFAULTS an undragged stop to just under the one above it, and says the rank was not chosen', () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({ sort_order: 4, stages: [{ id: 'a', amount: 100 }, { id: 'b', amount: 200 }] })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    }).filter(r => r.kind === 'goal');
    expect(rows.map(r => r.id)).toEqual(['g-1', 'g-1::stop2']);
    expect(rows[0].sortOrder).toBeLessThan(rows[1].sortOrder);
  });

  it('drops a FILLED stop out of the list entirely — "that stage should immediately stop/drop once '
    + "its done\"", () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({ current_amount: 5_730 })],
      carFunds: [], cards: [{ id: 'card-1', balance: 2_000, surplus_sort_order: 4 }],
      cardsSortOrder: 4,
      essentialMonthlyExpenses: 1_000,
    });
    expect(rows.filter(r => r.goalId === 'g-1').map(r => r.stage)).toEqual([2, 3]);
  });

  it('keeps the LAST stop listed once every one is filled, rather than making the goal vanish', () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({ current_amount: 99_999 })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    }).filter(r => r.kind === 'goal');
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe(3);
    expect(rows[0].remaining).toBe(0);
  });

  it('emits ONE plain row for an UNSTAGED goal — every user until they plan a stop', () => {
    const plain = buildSurplusRankRows({
      goals: [goalRowFor({ emergency_months_stage1: null, emergency_months_stage2: null })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    });
    expect(plain.filter(r => r.kind === 'goal')).toHaveLength(1);
    expect(plain.find(r => r.id === 'g-1')!.remaining).toBe(5_730);
    expect(plain.find(r => r.id === 'g-1')!.stage).toBeUndefined();
    expect(plain.find(r => r.id === 'g-1')!.goalId).toBeUndefined();
  });
});

// ── THE ONE THING A DRAG MAY NOT DO ──────────────────────────────────────────

describe('enforceStopOrder / moveSurplusRankRow — stops may go anywhere but may not cross', () => {
  const stopRow = (stage: number, sortOrder: number): SurplusRankRow => ({
    id: stage === 1 ? 'g-1' : `g-1::stop${stage}`,
    kind: 'goal', name: 'Plan', sortOrder, autoExtra: true, remaining: 100, share: null,
    targetAmount: 100, targetDate: null, createdAt: '2026-01-01',
    goalId: 'g-1', stageId: `s${stage}`, stage, stageCount: 3,
  });
  const other = (id: string, sortOrder: number): SurplusRankRow => ({
    id, kind: 'card', name: id, sortOrder, autoExtra: true, remaining: 500, share: null,
    targetAmount: null, targetDate: null, createdAt: '2026-01-01',
  });

  it('leaves a legal order untouched', () => {
    const rows = [stopRow(1, 0), other('visa', 1), stopRow(2, 2), stopRow(3, 3)];
    expect(enforceStopOrder(rows).map(r => r.id))
      .toEqual(['g-1', 'visa', 'g-1::stop2', 'g-1::stop3']);
  });

  it('puts two crossed stops back into plan order WITHOUT moving anything else, and without '
    + 'giving up the positions they collectively won', () => {
    // stop 3 dragged above stop 2. Both positions are still the goal's; only which stop sits in
    // which is corrected — so the drag visibly moved the pair up, it just did not invert the plan.
    const rows = [stopRow(1, 0), other('visa', 1), stopRow(3, 2), other('discover', 3), stopRow(2, 4)];
    expect(enforceStopOrder(rows).map(r => r.id))
      .toEqual(['g-1', 'visa', 'g-1::stop2', 'discover', 'g-1::stop3']);
  });

  it('is applied by a real drag: dragging stop 3 to the top lands it as high as it legally can', () => {
    const rows = [other('visa', 0), stopRow(1, 1), stopRow(2, 2), stopRow(3, 3)];
    const after = moveSurplusRankRow(rows, 'g-1::stop3', 'visa');
    // Stop 3 asked for the top slot. The goal now occupies slots 0, 2 and 3, and the plan hands
    // those out in index order — so the drag really did move the goal's stops above the card, it
    // just refused to put stop 3 in front of stops 1 and 2.
    expect(after.map(r => r.id)).toEqual(['g-1', 'visa', 'g-1::stop2', 'g-1::stop3']);
  });

  it('lets a stop move freely when nothing would cross', () => {
    const rows = [stopRow(1, 0), stopRow(2, 1), other('visa', 2), other('discover', 3)];
    const after = moveSurplusRankRow(rows, 'g-1::stop2', 'discover');
    expect(after.map(r => r.id)).toEqual(['g-1', 'visa', 'discover', 'g-1::stop2']);
  });
});

describe('planSurplusRankWrites — a stop writes its jsonb entry, never the goal columns', () => {
  const goalRowFor = (over: Partial<RankableGoal> = {}) =>
    ({ ...staged(over), name: 'Plan', created_at: '2026-01-01' });
  const build = (over: Partial<RankableGoal> = {}) => buildSurplusRankRows({
    goals: [goalRowFor({
      stages: [{ id: 'a', amount: 5_730 }, { id: 'b', months: 3 }, { id: 'c', months: 3 }],
      ...over,
    })],
    carFunds: [], essentialMonthlyExpenses: 1_000,
  });

  it('emits a goalStages patch for a moved stop and NOTHING on `goals`', () => {
    const before = build();
    const after = moveSurplusRankRow(before, 'g-1::stop3', 'g-1');
    const w = planSurplusRankWrites(before, after);
    expect(w.goals).toEqual([]);
    expect(w.goalStages.length).toBeGreaterThan(0);
    expect(w.goalStages.every(x => x.goalId === 'g-1')).toBe(true);
    expect(new Set(w.goalStages.map(x => x.stageId)).size).toBe(w.goalStages.length);
  });

  it('emits a goalStages patch for a stop whose tick moved, including the FIRST stop — its rank '
    + 'and tick live on the stop now, not on `savings_goals`', () => {
    const before = build();
    // The fixture goal is ticked, so the change under test is the tick coming OFF.
    const w = planSurplusRankWrites(before, setSurplusRankAutoExtra(before, 'g-1', false));
    expect(w.goals).toEqual([]);
    expect(w.goalStages).toEqual([{ goalId: 'g-1', stageId: 'a', auto_extra: false }]);
  });

  it('still writes `savings_goals` columns for an UNSTAGED goal', () => {
    const before = buildSurplusRankRows({
      goals: [goalRowFor({ emergency_months_stage1: null, emergency_months_stage2: null })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    });
    const w = planSurplusRankWrites(before, setSurplusRankAutoExtra(before, 'g-1', false));
    expect(w.goalStages).toEqual([]);
    expect(w.goals[0]).toMatchObject({ id: 'g-1', auto_extra: false });
  });
});

describe('the legacy two-column plan still reads', () => {
  const goalRowFor = (over: Partial<RankableGoal> = {}) =>
    ({ ...staged(over), name: 'Plan', created_at: '2026-01-01' });

  it('produces the same three stops, in the same order, from the columns alone — a row the '
    + 'migration missed keeps its plan instead of silently losing it', () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor()], carFunds: [], essentialMonthlyExpenses: 1_000,
    }).filter(r => r.kind === 'goal');
    expect(rows.map(r => r.remaining)).toEqual([5_730, 3_000, 3_000]);
    expect(rows.map(r => r.stage)).toEqual([1, 2, 3]);
  });

  it('is byte-identical to the old list for an UNSTAGED goal', () => {
    const rows = buildSurplusRankRows({
      goals: [goalRowFor({ emergency_months_stage1: null, emergency_months_stage2: null })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    });
    expect(rows.find(r => r.id === 'g-1')!.remaining).toBe(5_730);
  });
});

// ── (d) THE ENGINE: STOP AT STAGE 1, RESUME AT STAGE 2 ───────────────────────

type GoalRow = Partial<Tables<'savings_goals'>>;

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const goalRow = (over: GoalRow): GoalRow => ({
  id: 'g-1', user_id: 'u', name: 'Move fund, then emergency fund',
  target_amount: 2_000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: true,
  ...over,
});

/**
 * One $1,000/month expense rule paid from checking, so the engine's own
 * `computeEssentialMonthlyExpenses` lands on exactly $1,000 and the thresholds below are readable:
 * base 2,000 + 1×E = stage 1 of 3,000; + 3×E = stage 2 of 5,000.
 */
const RULES = [{
  id: 'r-1', user_id: 'u', active: true, rule_type: 'expense', name: 'Bills',
  amount: 1_000, frequency: 'monthly', due_day: 1, category: 'Bills',
  payment_source: null, start_date: null, end_date: null,
}] as unknown as ForecastInputs['rules'];

/**
 * Month-0 stub carrying only what step 4c-ii reads, plus the revolving schedule the stage gate
 * consults. `revolvingByMonth` is what makes this test possible at all: the engine reads
 * `cardProjectionData.monthlyRevolvingBalances`, so a fixture can say exactly when the cards clear.
 */
function cardProjection(
  perTarget: Month0Result['autoExtraPerTarget'],
  revolvingByMonth: number[] = [],
): CardProjectionResult {
  const reserved = Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const hasCard = revolvingByMonth.length > 0;
  return {
    data: [],
    simCards: hasCard
      ? [{ id: 'visa', name: 'Visa', balance: revolvingByMonth[0], minPayment: 0, apr: 0 }]
      : [],
    allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
    monthlyRevolvingBalances: hasCard ? new Map([['visa', revolvingByMonth]]) : new Map(),
    monthlyBalances: new Map(),
    perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
    monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    month0: { autoExtraPerTarget: perTarget, chain: { autoExtraReserve: reserved } },
  } as unknown as CardProjectionResult;
}

function makeInputs(goals: GoalRow[], revolvingByMonth: number[] = [], extraAccounts: AccountRow[] = []): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [
      acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 200_000 }),
      acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1_000 }),
      ...extraAccounts,
    ],
    budgetItems: [],
    // ⚠️ `cards_sort_order` 5 puts the goal (sort_order 0) ABOVE the card block, which is the
    // arrangement the whole feature is about: the goal fills stage 1 FIRST and then hands the
    // dollars down to the cards. Left at the default 0 the cards win the tie, take everything, and
    // the goal is never funded at all — which looks like the stage gate working and is not.
    profile: { tax_rate: 0, paycheck_deductions: [] as never, cards_sort_order: 5 },
    assumptions: ASSUMPTIONS,
    rules: RULES,
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection([], revolvingByMonth),
    // Real income, because the essential-expense rule above is real cash out: a fixture with a
    // $1,000 bill and no paycheck has no surplus at all, and every assertion below would pass for
    // the wrong reason.
    payConfig: { weeklyGross: 5_000, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2025-12-31',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  };
}

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

/**
 * Three stops over one balance: $2,000, then one month of essentials, then two more.
 * Thresholds 2,000 / 3,000 / 5,000 — the same numbers the retired two-column plan produced.
 *
 * ⚠️ THE RANKS ARE THE POINT. Stops 1 and 2 sit ABOVE the card block (`cards_sort_order: 5`) and
 * stop 3 sits BELOW it, which is Tre's own arrangement: "emergency 2 should be behind all the
 * credit cards." There is no flag anywhere in this fixture — where a stop sits IS the hand-off.
 */
const STAGED_GOAL: GoalRow = {
  stages: [
    { id: 's1', name: 'Move', amount: 2_000, sort_order: 0, auto_extra: true },
    { id: 's2', name: 'Runway', months: 1, sort_order: 1, auto_extra: true },
    { id: 's3', name: 'Full runway', months: 2, sort_order: 6, auto_extra: true },
  ],
} as unknown as GoalRow;

describe('forecast-engine — a stop is funded when its RANK comes up, not when a flag opens', () => {
  afterEach(() => vi.useRealTimers());

  /** Every stop of one goal is its own ranked target, so the goal's total is the sum of its rows. */
  const totalForGoal = (rows: ReturnType<typeof calculateForecast>['data'], id: string) =>
    rows.reduce((s, r) => s + Object.entries(r.autoExtraByTarget ?? {})
      .filter(([k]) => k === id || k.startsWith(`${id}::`))
      .reduce((t, [, v]) => t + Number(v || 0), 0), 0);
  const totalFor = (rows: ReturnType<typeof calculateForecast>['data'], id: string) =>
    rows.reduce((s, r) => s + Number(r.autoExtraByTarget?.[id] ?? 0), 0);

  it('funds only the stops ABOVE the cards while the cards still owe revolving', () => {
    anchor();
    // Revolving never clears across the horizon, so the rank-6 stop never comes up.
    const rows = calculateForecast(
      makeInputs([goalRow(STAGED_GOAL)], new Array(120).fill(5_000)),
    ).data;
    expect(totalForGoal(rows, 'g-1')).toBeCloseTo(3_000, 2);
    expect(totalFor(rows, 'g-1::stop3')).toBeCloseTo(0, 2);
  });

  it('funds the stop BELOW the cards once the cards are clear, and stops there', () => {
    anchor();
    // Cards clear at month 6.
    const revolving = new Array(120).fill(0).map((_, i) => (i < 6 ? 5_000 : 0));
    const rows = calculateForecast(makeInputs([goalRow(STAGED_GOAL)], revolving)).data;
    expect(totalForGoal(rows, 'g-1')).toBeCloseTo(5_000, 2);
    // Nothing from the rank-6 stop arrives before the debt clears.
    const beforeClear = rows.slice(0, 6)
      .reduce((s, r) => s + Number(r.autoExtraByTarget?.['g-1::stop3'] ?? 0), 0);
    expect(beforeClear).toBeCloseTo(0, 2);
  });

  it('draws NOTHING for a stop the user has not ticked — "each part of the stagger should always '
    + 'have the choice of extra payments", and the choice has to be able to be no', () => {
    anchor();
    const goal = goalRow({
      stages: [
        { id: 's1', name: 'Move', amount: 2_000, sort_order: 0, auto_extra: true },
        { id: 's2', name: 'Runway', months: 1, sort_order: 1, auto_extra: false },
        { id: 's3', name: 'Full runway', months: 2, sort_order: 2, auto_extra: false },
      ],
    } as unknown as GoalRow);
    const rows = calculateForecast(makeInputs([goal], new Array(120).fill(0))).data;
    expect(totalForGoal(rows, 'g-1')).toBeCloseTo(2_000, 2);
  });

  it('never over-funds past the whole plan, whatever the month-by-month split', () => {
    anchor();
    const revolving = new Array(120).fill(0).map((_, i) => (i < 3 ? 5_000 : 0));
    const rows = calculateForecast(makeInputs([goalRow(STAGED_GOAL)], revolving)).data;
    expect(totalForGoal(rows, 'g-1')).toBeLessThanOrEqual(5_000 + 0.005);
  });

  it('leaves an UNSTAGED goal exactly as it was — the whole feature is opt-in', () => {
    anchor();
    const rows = calculateForecast(
      makeInputs([goalRow({})], new Array(120).fill(5_000)),
    ).data;
    expect(totalFor(rows, 'g-1')).toBeCloseTo(2_000, 2);
  });
});

// ── THE ANNUAL IRA CAP, IN THE ENGINE ────────────────────────────────────────
//
// The unit tests next door pin the arithmetic. What is pinned HERE is that the arithmetic actually
// binds the waterfall: an IRA goal with a $99,000 need and a big surplus must take the year's limit
// and no more, spread level rather than in one January lump.

describe('forecast-engine — a Roth IRA goal is capped per year and paid level', () => {
  afterEach(() => vi.useRealTimers());

  const rothAcct = acct({ id: 'roth-1', name: 'Roth IRA', account_type: 'roth_ira', balance: 0 });
  const brokerAcct = acct({ id: 'brk-1', name: 'Brokerage', account_type: 'brokerage', balance: 0 });

  const perMonth = (rows: ReturnType<typeof calculateForecast>['data'], id: string) =>
    rows.map(r => Number(r.autoExtraByTarget?.[id] ?? 0));

  it('never lets one CALENDAR year exceed the limit, however much surplus there is', () => {
    anchor(); // Oct 2026, so month 0..2 are 2026 and month 3.. are 2027
    const goal = goalRow({
      id: 'g-1', target_amount: 200_000, current_amount: 0, auto_extra: true,
      linked_account: 'roth-1', sort_order: 0,
    });
    const rows = calculateForecast(
      makeInputs([goal], new Array(120).fill(0), [rothAcct]),
    ).data;
    const months = perMonth(rows, 'g-1');
    // The fixture anchors at 15 Oct 2026: three months of 2026, then twelve of 2027.
    const y2026 = months.slice(0, 3).reduce((a, b) => a + b, 0);
    const y2027 = months.slice(3, 15).reduce((a, b) => a + b, 0);
    expect(y2026).toBeLessThanOrEqual(IRA_ANNUAL_LIMIT + 0.005);
    expect(y2027).toBeLessThanOrEqual(IRA_ANNUAL_LIMIT + 0.005);
    // And it is genuinely being funded, so the assertion above is not passing on zero.
    expect(y2027).toBeGreaterThan(0);
  });

  it('pays a LEVEL amount across a full year rather than filling in January and stopping — '
    + '"make the payments consistent so users can set up auto transfer and forget about it"', () => {
    anchor();
    const goal = goalRow({
      id: 'g-1', target_amount: 200_000, current_amount: 0, auto_extra: true,
      linked_account: 'roth-1', sort_order: 0,
    });
    const rows = calculateForecast(
      makeInputs([goal], new Array(120).fill(0), [rothAcct]),
    ).data;
    // Months 3..14 are the whole of 2027.
    const y2027 = perMonth(rows, 'g-1').slice(3, 15);
    const level = IRA_ANNUAL_LIMIT / 12;
    // Precision 1, not 2: the reserve rounds to cents, so a level $583.33 lands as $583.34 in some
    // months. Level to within a penny is the requirement; level to within a thousandth is an
    // assertion about rounding, not about the feature.
    for (const m of y2027) expect(m).toBeCloseTo(level, 1);
  });

  it('leaves a BROKERAGE goal with no date uncapped — "same auto transfer concept for investing '
    + 'but dont cap it"', () => {
    anchor();
    const goal = goalRow({
      id: 'g-1', target_amount: 20_000, current_amount: 0, auto_extra: true,
      linked_account: 'brk-1', target_date: null, sort_order: 0,
    });
    const rows = calculateForecast(
      makeInputs([goal], new Array(120).fill(0), [brokerAcct]),
    ).data;
    // No ceiling and no date, so the surplus fills it as fast as it can - exactly as before.
    expect(perMonth(rows, 'g-1')[1]).toBeGreaterThan(IRA_ANNUAL_LIMIT / 12);
  });

  it('leaves a goal linked to NOTHING and dated NOTHING exactly as it was — the whole feature is '
    + 'opt-in, so no existing user moves', () => {
    anchor();
    const capped = calculateForecast(
      makeInputs([goalRow({ id: 'g-1', target_amount: 20_000, auto_extra: true, sort_order: 0 })],
        new Array(120).fill(0)),
    ).data;
    expect(perMonth(capped, 'g-1')[1]).toBeGreaterThan(IRA_ANNUAL_LIMIT / 12);
  });
});

// ── ANY DATED TARGET IS PACED, NOT JUST AN INVESTING ONE ─────────────────────
//
// Tre: "only take exactly what it needs to reach the goal on time". The levelling shipped reading
// `brokerage`, because that is the account type the investing ask arrived attached to — but the
// sentence is about a DATE. A move fund in a savings account wants pacing for exactly the same
// reason, and front-loading it starves every rank below it for months.
//
// The fixture anchors at 15 Oct 2026 and the target date is 1 Sep 2027, i.e. eleven months out.
// Month 0's reserve comes from the month-0 stub (empty here), so every assertion reads month 1
// onwards, where the spread is over the eleven payments Nov..Sep.

describe('forecast-engine — a dated target takes only what it needs to arrive on time', () => {
  afterEach(() => vi.useRealTimers());

  const perMonth = (rows: ReturnType<typeof calculateForecast>['data'], id: string) =>
    rows.map(r => Number(r.autoExtraByTarget?.[id] ?? 0));
  const NEED = 12_000;
  /** Nov 2026 … Sep 2027 inclusive: what one payment has to be to land the need on the date. */
  const LEVEL = NEED / 11;
  const dated = (over: GoalRow = {}) => goalRow({
    id: 'g-1', target_amount: NEED, current_amount: 0, auto_extra: true, sort_order: 0,
    target_date: '2027-09-01', ...over,
  });

  it('spreads a plain savings goal over the months until its date instead of filling it at once', () => {
    anchor();
    const months = perMonth(
      calculateForecast(makeInputs([dated()], new Array(120).fill(0))).data, 'g-1',
    );
    expect(months[1]).toBeCloseTo(LEVEL, 1);
    // And it is genuinely paced rather than merely capped: still level most of a year later.
    expect(months[6]).toBeCloseTo(LEVEL, 1);
  });

  it('still ARRIVES on the date — the whole need is funded by the target month and no later', () => {
    anchor();
    const months = perMonth(
      calculateForecast(makeInputs([dated()], new Array(120).fill(0))).data, 'g-1',
    );
    const through = (n: number) => months.slice(0, n + 1).reduce((a, b) => a + b, 0);
    expect(through(11)).toBeCloseTo(NEED, 1); // month 11 IS Sep 2027
    expect(through(10)).toBeLessThan(NEED - 1);
  });

  it('takes it ALL when the date has already passed — a missed deadline is due now, not spread', () => {
    anchor();
    const months = perMonth(
      calculateForecast(makeInputs([dated({ target_date: '2026-07-01' })], new Array(120).fill(0))).data,
      'g-1',
    );
    expect(months[1]).toBeCloseTo(NEED, 1);
  });

  it('leaves an UNDATED goal filling as fast as the surplus allows — the levelling answers '
    + '"by when", and without a date there is no question', () => {
    anchor();
    const months = perMonth(
      calculateForecast(makeInputs([dated({ target_date: null })], new Array(120).fill(0))).data,
      'g-1',
    );
    expect(months[1]).toBeCloseTo(NEED, 1);
  });

  it('paces a STOP by its OWN date, not by the goal\'s — a staged plan\'s single `target_date` '
    + '"could only ever describe one of them"', () => {
    anchor();
    const goal = dated({
      target_date: '2026-11-01', // the goal's date, one month out, and NOT this stop's
      stages: [{ id: 's1', name: 'Move', amount: NEED, sort_order: 0, auto_extra: true, target_date: '2027-09-01' }],
    } as unknown as GoalRow);
    const months = perMonth(calculateForecast(makeInputs([goal], new Array(120).fill(0))).data, 'g-1');
    expect(months[1]).toBeCloseTo(LEVEL, 1);
  });

  it('falls back to the goal\'s date for STOP 1 ONLY — a plan written before stops had dates keeps '
    + 'pacing its first stop', () => {
    anchor();
    const goal = dated({
      stages: [{ id: 's1', name: 'Move', amount: NEED, sort_order: 0, auto_extra: true }],
    } as unknown as GoalRow);
    const rows = calculateForecast(makeInputs([goal], new Array(120).fill(0))).data;
    expect(perMonth(rows, 'g-1')[1]).toBeCloseTo(LEVEL, 1);
  });

  it('gives a LATER undated stop no deadline at all — inheriting the goal\'s date there would '
    + 'invent one for a runway nobody dated', () => {
    anchor();
    // Stop 1 is not ticked, so it takes nothing and holds up nothing; stop 2 is the paced-or-not
    // question. The goal carries a date eleven months out and stop 2 carries none.
    const goal = dated({
      stages: [
        { id: 's1', name: 'Move', amount: NEED, sort_order: 0, auto_extra: false },
        { id: 's2', name: 'Runway', amount: 9_000, sort_order: 1, auto_extra: true },
      ],
    } as unknown as GoalRow);
    const rows = calculateForecast(makeInputs([goal], new Array(120).fill(0))).data;
    expect(perMonth(rows, 'g-1::stop2')[1]).toBeCloseTo(9_000, 1);
    // …and it IS paced the moment that stop is given a date of its own.
    const withDate = dated({
      stages: [
        { id: 's1', name: 'Move', amount: NEED, sort_order: 0, auto_extra: false },
        { id: 's2', name: 'Runway', amount: 9_000, sort_order: 1, auto_extra: true, target_date: '2027-09-01' },
      ],
    } as unknown as GoalRow);
    expect(perMonth(calculateForecast(makeInputs([withDate], new Array(120).fill(0))).data, 'g-1::stop2')[1])
      .toBeCloseTo(9_000 / 11, 1);
  });

  it('PASSES THE REST DOWN to the next rank once it has taken this month\'s pace — an on-pace '
    + 'target has met its obligation for the month, so the ranks below it do not wait out the '
    + 'whole deadline (Tre, 2026-08-27)', () => {
    anchor();
    const goal = dated({
      stages: [
        { id: 's1', name: 'Move', amount: NEED, sort_order: 0, auto_extra: true },
        { id: 's2', name: 'Runway', amount: 9_000, sort_order: 1, auto_extra: true },
      ],
    } as unknown as GoalRow);
    const rows = calculateForecast(makeInputs([goal], new Array(120).fill(0))).data;
    // Stop 1 is capped at its level figure — the pacing itself is untouched by this change …
    expect(perMonth(rows, 'g-1')[1]).toBeCloseTo(LEVEL, 1);
    // … and the surplus above it now reaches stop 2 in the SAME month. This assertion used to be
    // `toBe(0)` with stop 2 opening at month 12; holding the queue for the whole eleven-month pace
    // is the behaviour Tre replaced.
    expect(perMonth(rows, 'g-1::stop2')[1]).toBeGreaterThan(0);
    // Stop 2 carries no date of its own, so nothing paces IT — it fills as fast as the surplus
    // allows, which is the undated contract two tests above.
    expect(perMonth(rows, 'g-1::stop2')[1]).toBeCloseTo(9_000, 1);
  });

  it('does NOT pass anything down while it is short of this month\'s pace — the obligation for the '
    + 'month is discharged by taking the pace, not by being offered it', () => {
    anchor();
    // A need so large that one month of its pace outruns every dollar the fixture has: stop 1 takes
    // the whole pool and is STILL short of the month's figure, so it has not discharged the month.
    const HUGE = 6_000_000;
    const PACE = HUGE / 11;
    const goal = dated({
      target_amount: HUGE,
      stages: [
        { id: 's1', name: 'Move', amount: HUGE, sort_order: 0, auto_extra: true },
        { id: 's2', name: 'Runway', amount: 9_000, sort_order: 1, auto_extra: true },
      ],
    } as unknown as GoalRow);
    const rows = calculateForecast(makeInputs([goal], new Array(120).fill(0))).data;
    const stop1 = perMonth(rows, 'g-1')[1];
    expect(stop1).toBeGreaterThan(0);
    expect(stop1).toBeLessThan(PACE - 1);
    expect(perMonth(rows, 'g-1::stop2')[1]).toBe(0);
  });

  it('binds a dated IRA goal by whichever limit is SMALLER — the year would allow more than the '
    + 'deadline needs, and taking the year\'s figure would over-fund it early', () => {
    anchor();
    const goal = dated({ linked_account: 'roth-1' });
    const roth = acct({ id: 'roth-1', name: 'Roth IRA', account_type: 'roth_ira', balance: 0 });
    const months = perMonth(
      calculateForecast(makeInputs([goal], new Array(120).fill(0), [roth])).data, 'g-1',
    );
    // Nov 2026 leaves two months of a $7,000 allowance ($3,500), and the deadline needs $1,090.91.
    expect(months[1]).toBeCloseTo(LEVEL, 1);
  });
});
