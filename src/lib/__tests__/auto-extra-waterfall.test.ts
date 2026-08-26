// AUTO EXTRA IS A WATERFALL — one target at a time, and it steps on when that target is met.
//
// Tre, 2026-08-25: "auto extra payments for the next item should only kick in after the previous
// payment goal is met. once it comes true it should auto deselect."
//
// Before this, `allocateRankedSurplus` filled each rank to its capacity and flowed the REMAINDER
// on to the next rank IN THE SAME MONTH. That is a waterfall in rank order but not in time: the
// month a goal is completed, the goal below it already starts receiving. The rule below is the
// stricter one Tre asked for — a rank that still had an unmet need when the month began takes the
// money and blocks every rank under it until a LATER month.
//
// Three things are pinned here, and they are the three halves of the ask:
//   (a) month 0's extra goes ONLY to the first incomplete target,
//   (b) the month AFTER the first target completes, the extra routes to the second,
//   (c) a target whose goal is met has its `auto_extra` flag planned OFF, exactly once.
//
// Would-fail check for (a)/(b): delete the `gateOpen` bookkeeping in `allocateRankedSurplus`'s
// PASS 2 and both come back with the second target funded in the same month as the first.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  allocateRankedSurplus, computeAutoExtraReserve, type RankedTarget,
} from '../ranked-surplus-allocation';
import { planAutoExtraDeselect, type SurplusRankRow } from '../surplus-ranking';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult, Month0Result } from '@/lib/debt-model-types';
import type { Tables } from '@/integrations/supabase/types';

const goal = (id: string, sortOrder: number, capacity: number): RankedTarget =>
  ({ id, kind: 'goal', sortOrder, minimum: 0, capacity, autoExtra: true });

const byId = (r: ReturnType<typeof allocateRankedSurplus>, id: string) =>
  r.allocations.find(a => a.id === id)!;

// ── (a) ONE TARGET AT A TIME ─────────────────────────────────────────────────

describe('allocateRankedSurplus — the extra goes to the FIRST incomplete target only', () => {
  it('holds the remainder rather than passing it to the next rank in the same month', () => {
    const r = allocateRankedSurplus(1_000, [goal('first', 0, 120), goal('second', 1, 5_000)]);
    expect(byId(r, 'first').extra).toBe(120);
    expect(byId(r, 'second').extra).toBe(0);
    // The money is not lost: it stays in the pool, which is the caller's own surplus again.
    expect(r.unallocated).toBe(880);
  });

  it('lets a target that was ALREADY met pass its rank straight through', () => {
    // Nothing to hand on and nothing to wait for: a rank with no need never blocks the one below.
    const r = allocateRankedSurplus(1_000, [goal('done', 0, 0), goal('next', 1, 5_000)]);
    expect(byId(r, 'next').extra).toBe(1_000);
  });

  it('an opted-OUT target does not block the ranks under it', () => {
    const r = allocateRankedSurplus(1_000, [
      { ...goal('off', 0, 9_999), autoExtra: false },
      goal('on', 1, 5_000),
    ]);
    expect(byId(r, 'off').extra).toBe(0);
    expect(byId(r, 'on').extra).toBe(1_000);
  });

  it('still settles every minimum first, whatever the gate does', () => {
    // The rule that must never break: PASS 1 is ahead of the waterfall, not inside it.
    const r = allocateRankedSurplus(1_000, [
      goal('greedy', 0, 60),
      { id: 'visa', kind: 'card', sortOrder: 9, minimum: 300, capacity: 5_000 },
    ]);
    expect(byId(r, 'visa').minimum).toBe(300);
    expect(byId(r, 'greedy').extra).toBe(60);
    expect(r.minimumShortfall).toBe(0);
  });

  it('reserves for the first opted-in target and nothing for the second', () => {
    // The production entry point, with the card block ranked below both goals.
    const r = computeAutoExtraReserve(2_000, 0, 20_000, [
      goal('move', 0, 150), goal('savings', 1, 10_000),
    ], 5);
    expect(r.perTarget).toEqual([{ id: 'move', kind: 'goal', amount: 150 }]);
    expect(r.reserved).toBe(150);
  });
});

// ── (b) THE HANDOVER, FORWARD IN TIME ────────────────────────────────────────
//
// The engine half. `autoExtraCapacity` already decays a target's remaining need month by month and
// DELETES it at zero, so a completed target stops being a target at all — which is what makes the
// gate above step on by itself in month K+1. This proves that, rather than assuming it.

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
  id: 'g-1', user_id: 'u', name: 'Goal', target_amount: 10000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: false,
  ...over,
});

/** Month-0 stub carrying only what step 4c-ii reads. Empty on purpose: every dollar the assertions
 *  below look at is therefore a LATER month's own decision. Same shape as
 *  `forecast-engine.autoExtraMultiMonth.test.ts`, which documents why the rest is absent. */
function cardProjection(perTarget: Month0Result['autoExtraPerTarget']): CardProjectionResult {
  const reserved = Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  return {
    data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
    monthlyRevolvingBalances: new Map(), monthlyBalances: new Map(),
    perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
    monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    month0: { autoExtraPerTarget: perTarget, chain: { autoExtraReserve: reserved } },
  } as unknown as CardProjectionResult;
}

function makeInputs(goals: GoalRow[], checking = 20000): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [
      acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: checking }),
      acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1000 }),
    ],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection([]),
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
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

describe('forecast-engine — the waterfall steps on the month AFTER the first target is met', () => {
  afterEach(() => vi.useRealTimers());

  /** Two opted-in goals, ranked. Cash is ample, so nothing but the ranking can hold `second` back. */
  const twoGoals = () => makeInputs([
    goalRow({ id: 'g-first', name: 'First', sort_order: 0, auto_extra: true, target_amount: 1200 }),
    goalRow({ id: 'g-second', name: 'Second', sort_order: 1, auto_extra: true, target_amount: 5000 }),
  ]);

  it('funds only the first target in the month it completes, and the second from the next month', () => {
    anchor();
    const rows = calculateForecast(twoGoals()).data;
    const extraFor = (i: number, id: string) => Number(rows[i].autoExtraByTarget?.[id] ?? 0);

    // Month 0's reserve is the (empty) stub, so the first month that decides anything is month 1.
    const done = rows.findIndex((_, i) => extraFor(i, 'g-first') > 0);
    expect(done, 'the first goal is funded somewhere in the horizon').toBeGreaterThan(0);
    expect(extraFor(done, 'g-first')).toBeCloseTo(1200, 2);
    // THE ASK: the second goal gets nothing in the month the first one is completed.
    expect(extraFor(done, 'g-second')).toBe(0);
    // …and takes over in the very next month.
    expect(extraFor(done + 1, 'g-second')).toBeGreaterThan(0);
    expect(extraFor(done + 1, 'g-first')).toBe(0);
  });

  it('never funds two ranked targets in the same month', () => {
    anchor();
    const rows = calculateForecast(twoGoals()).data;
    for (const [i, row] of rows.entries()) {
      const funded = Object.values(row.autoExtraByTarget ?? {}).filter(v => Number(v) > 0);
      expect(funded.length, `month ${i} funds at most one target`).toBeLessThanOrEqual(1);
    }
  });

  it('still delivers both targets in full across the horizon', () => {
    anchor();
    const rows = calculateForecast(twoGoals()).data;
    const total = (id: string) =>
      rows.reduce((s, r) => s + Number(r.autoExtraByTarget?.[id] ?? 0), 0);
    expect(total('g-first')).toBeCloseTo(1200, 2);
    expect(total('g-second')).toBeCloseTo(5000, 2);
  });
});

// ── (c) THE FLAG SWITCHES ITSELF OFF, ONCE ───────────────────────────────────

describe('planAutoExtraDeselect', () => {
  const row = (over: Partial<SurplusRankRow>): SurplusRankRow => ({
    id: 'g-1', kind: 'goal', name: 'Emergency Fund', sortOrder: 0, autoExtra: true,
    autoExtraAutoCleared: false,
    remaining: 0, share: null, targetAmount: 20000, targetDate: null, createdAt: '2026-01-01',
    ...over,
  });

  it('plans the flag off for a goal whose need is met', () => {
    expect(planAutoExtraDeselect([row({})])).toEqual([
      { id: 'g-1', kind: 'goal', name: 'Emergency Fund' },
    ]);
  });

  it('plans nothing a second time — the write it planned is what stops it', () => {
    const first = planAutoExtraDeselect([row({})]);
    expect(first).toHaveLength(1);
    // The write lands: `auto_extra` is false, so the row no longer qualifies. No loop.
    expect(planAutoExtraDeselect([row({ autoExtra: false })])).toEqual([]);
  });

  it('leaves a target the user has switched back on alone', () => {
    // Idempotence is the flag itself; this is the second guard, for the one session where the
    // user re-ticks a fully funded row on purpose. Flipping it straight back off would be a fight.
    expect(planAutoExtraDeselect([row({})], new Set(['g-1']))).toEqual([]);
  });

  it('leaves a target alone whose PERSISTED auto_extra_auto_cleared is already true — the guard'
    + "'s decision surviving a reload, not just this session's Set", () => {
    // 20260826_auto_extra_auto_cleared.sql: the in-session Set is what the row helper's second
    // argument stands in for above; this is the same guard read off the row itself instead, which
    // is what still applies after a reload rebuilds the Set from nothing. An EMPTY Set here is the
    // point -- the row's own field is doing all the work.
    expect(planAutoExtraDeselect([row({ autoExtraAutoCleared: true })])).toEqual([]);
  });

  it('leaves an unmet target alone', () => {
    expect(planAutoExtraDeselect([row({ remaining: 4_000 })])).toEqual([]);
  });

  it('never touches a card, the card block or a liability — none of them has the column', () => {
    expect(planAutoExtraDeselect([
      row({ id: '__cards__', kind: 'cards', name: 'Credit cards', remaining: null }),
      row({ id: 'c-1', kind: 'card', name: 'Visa', remaining: 0, targetAmount: null }),
      row({ id: 'l-1', kind: 'liability', name: 'Student loan', remaining: 0, targetAmount: null }),
    ])).toEqual([]);
  });

  it('switches a paid-off vehicle loan off, which has no target amount to reach', () => {
    expect(planAutoExtraDeselect([
      row({ id: 'cf-1', kind: 'loan', name: 'C5 loan', remaining: 0, targetAmount: null }),
    ])).toEqual([{ id: 'cf-1', kind: 'loan', name: 'C5 loan' }]);
  });

  it('leaves a goal with no target amount alone — unconfigured is not finished', () => {
    expect(planAutoExtraDeselect([row({ targetAmount: null })])).toEqual([]);
    expect(planAutoExtraDeselect([row({ kind: 'car_fund', targetAmount: 0 })])).toEqual([]);
  });
});
