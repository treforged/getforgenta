/**
 * RUN THE REAL FORECAST ENGINE ON THE COMMITTED DEMO FIXTURE.
 *
 * WHY THIS FILE EXISTS. The demo fixture is a marketing asset now (Tre, 2026-09-03):
 * every screenshot, App Store image and reel comes from it, because Forgenta's
 * strongest sentences compute from Tre's REAL accounts and those can never be filmed.
 * A claim in a published image therefore has to be reproducible by re-running the
 * engine on the fixture — and until this file there was no way to do that outside a
 * browser, so `demo-marketing-lines.test.ts` could only reach the parts of the app
 * that need no forecast.
 *
 * WHAT IT IS NOT. It is not a second math path. `calculateForecast` is the engine the
 * app runs; this only assembles its inputs, the way `useForecastEngineInputs` does in
 * React. The one part re-expressed here is `forecastMonthEvents`, which lives inside
 * that hook and cannot be imported without a renderer — kept deliberately close to the
 * original, and narrowed to what the demo fixture actually exercises:
 *
 *   - no confirmed/auto-matched occurrences (the demo has no captured bank links)
 *   - no payment plans, no car funds, no goals
 *   - `pauseSavings` false, so no savings rule is suppressed
 *
 * ⚠️ IF THE HOOK'S RULES CHANGE, THIS DRIFTS SILENTLY. That is the standing risk of any
 * second copy, so the copy is kept as small as possible and the divergence is listed
 * above rather than left to be discovered. The alternative — rendering the hook — buys
 * fidelity at the cost of a React tree in a fixture test, and the marketing lines this
 * feeds are about cash and dates, not about hook wiring.
 *
 * THE CLOCK IS ALWAYS PINNED BY THE CALLER. A filmed figure that moves with the wall
 * clock is a figure nobody can reproduce next week.
 */
import { calculateForecast, type ForecastInputs, type ForecastResult } from '@/lib/forecast-engine';
import { generateScheduledEvents, aggregateByMonth, PROJECTION_MONTHS, toLocalDateStr } from '@/lib/scheduling';
import { CC_DEFAULT_CATEGORIES } from '@/lib/credit-card-engine';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import { demoAccounts, demoRecurringRules, demoProfile } from '@/lib/demo-data';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '@/hooks/useCardProjection';

/** The forecast's own defaults — growth off, no bonus, no tax return. A demo that leans
 *  on an assumed raise is a demo whose numbers are assumptions. */
export const DEMO_ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

/** The demo's funding account: Northvale Checking. */
export const DEMO_FUNDING_ACCOUNT_ID = 'd1';

const accounts = () => demoAccounts as unknown as AccountRow[];
const rules = () => demoRecurringRules as unknown as RuleRow[];

/**
 * `useForecastEngineInputs`'s `forecastMonthEvents`, for the demo fixture.
 *
 * The exclusions are the load-bearing part: money charged to a CARD is a liability, not
 * a withdrawal from this walk's cash, and money paid from ANOTHER asset account never
 * touches the funding account at all. Dropping either would understate the demo's cash.
 */
function demoForecastMonthEvents(now: Date, syncCutoffDate: string) {
  const scheduled = generateScheduledEvents(rules(), accounts(), PROJECTION_MONTHS, now);

  const liquidAccountIds = new Set(
    accounts().filter(a => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type)).map(a => a.id),
  );
  const incomeToLiquidRuleIds = new Set(
    rules().filter(r => r.active && r.rule_type === 'income' && (!r.deposit_account || liquidAccountIds.has(r.deposit_account))).map(r => r.id),
  );
  const paycheckRuleIds = new Set(
    rules().filter(r => r.active && r.rule_type === 'income'
      && ['weekly', 'biweekly', 'semi_monthly'].includes(r.frequency)
      && (!r.deposit_account || liquidAccountIds.has(r.deposit_account))).map(r => r.id),
  );
  const ccPaymentSources = new Set(
    accounts().filter(a => a.active && a.account_type === 'credit_card').flatMap(a => [a.id, `account:${a.id}`]),
  );
  const ccRuleIds = new Set([
    ...rules().filter(r => r.active && r.rule_type === 'expense' && r.payment_source && ccPaymentSources.has(r.payment_source)).map(r => r.id),
    ...rules().filter(r => r.active && r.rule_type === 'expense' && !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category)).map(r => r.id),
  ]);
  const otherAccountRuleIds = new Set(
    rules().filter(r => {
      if (!r.active || r.rule_type !== 'expense' || !r.payment_source) return false;
      if (ccPaymentSources.has(r.payment_source)) return false;
      return String(r.payment_source).replace(/^account:/, '') !== DEMO_FUNDING_ACCOUNT_ID;
    }).map(r => r.id),
  );

  return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = scheduled.filter(e => e.date.startsWith(monthKey) && (i > 0 || e.date > syncCutoffDate));

    const income = inMonth
      .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
      .reduce((s, e) => s + e.amount, 0);
    const nonPaycheckIncome = inMonth
      .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId) && !paycheckRuleIds.has(e.ruleId))
      .reduce((s, e) => s + e.amount, 0);
    const expenses = inMonth
      .filter(e => e.type === 'expense'
        && !(e.ruleId && ccRuleIds.has(e.ruleId))
        && !(e.ruleId && otherAccountRuleIds.has(e.ruleId)))
      .reduce((s, e) => s + e.amount, 0);

    return { income, nonPaycheckIncome, expenses };
  });
}

export interface DemoForecastOptions {
  /** Pinned "today". Required in spirit: an unpinned run produces figures that move. */
  now: Date;
  /** The app's own card simulation for this fixture — see `runDemoCardProjection`. */
  cardProjection?: unknown;
}

/** The ForecastInputs the demo fixture produces at `now`. */
export function demoForecastInputs(opts: DemoForecastOptions): ForecastInputs {
  const { now } = opts;
  const syncCutoffDate = toLocalDateStr(now);
  return {
    debts: [], goals: [], carFunds: [],
    accounts: accounts(),
    budgetItems: [],
    profile: { ...demoProfile, paycheck_deductions: [] as never },
    assumptions: DEMO_ASSUMPTIONS,
    rules: rules(),
    monthlyAggregates: aggregateByMonth(generateScheduledEvents(rules(), accounts(), PROJECTION_MONTHS, now)),
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: (opts.cardProjection ?? null) as ForecastInputs['cardProjectionData'],
    payConfig: {
      weeklyGross: demoProfile.weekly_gross_income,
      taxRate: demoProfile.tax_rate,
      paycheckDay: demoProfile.paycheck_day,
      frequency: demoProfile.paycheck_frequency as 'weekly',
    },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: demoForecastMonthEvents(now, syncCutoffDate),
    forecastFundingAccountId: DEMO_FUNDING_ACCOUNT_ID,
    cashFloor: demoProfile.cash_floor,
    pauseSavings: false,
    syncCutoffDate,
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  } as unknown as ForecastInputs;
}

/** Run the engine on the fixture at a pinned instant.
 *
 * ⚠️ WITHOUT `cardProjection` THE CASH LINE IS OPTIMISTIC, and by a knowable amount:
 * card spend is excluded from the cash walk (it is a liability, not a withdrawal) while
 * no card PAYMENT is modelled, so the walk keeps money a real month would send to the
 * issuer. Pass the card projection — `runDemoCardProjection` below, which renders the
 * app's own hook — for anything that reads `endingCash`, `belowSafeMinimum` or a
 * cash-floor warning. Omit it only for questions that do not touch cash.
 */
export function runDemoForecast(opts: DemoForecastOptions): ForecastResult {
  return calculateForecast(demoForecastInputs(opts));
}

/**
 * A persona that replaces the fixture's profile and rules for ONE caller. It exists for tests whose
 * subject is the ENGINE (`payment-pin-semantics.test.ts`), so a re-tune of the marketing persona
 * cannot rewrite what they assert. Callers about the demo itself pass nothing.
 */
export interface DemoPersonaOverride {
  profile: typeof demoProfile;
  rules: readonly unknown[];
}

/**
 * THE APP'S OWN CARD SIMULATION, RUN ON THE DEMO FIXTURE.
 *
 * `useCardProjection` is a hook, so this needs a renderer: any caller must declare
 * `// @vitest-environment jsdom` at the top of its file. That cost buys the thing the
 * headless path cannot have — the card payments themselves. A cash line with card SPEND
 * excluded and card PAYMENTS missing is not a cautious estimate, it is a fixture that
 * looks several hundred dollars a month richer than the person it describes.
 */
export function runDemoCardProjection(now: Date, persona?: DemoPersonaOverride) {
  const profile = persona?.profile ?? demoProfile;
  const personaRules = (persona?.rules ?? demoRecurringRules) as unknown as RuleRow[];
  const payConfig = {
    weeklyGross: profile.weekly_gross_income,
    taxRate: profile.tax_rate,
    paycheckDay: profile.paycheck_day,
    frequency: profile.paycheck_frequency as 'weekly',
  };
  const scheduledEvents = generateScheduledEvents(personaRules, accounts(), PROJECTION_MONTHS, now);
  return renderHook(() => useCardProjection({
    accounts: accounts(),
    transactions: [],
    rules: personaRules,
    debts: [],
    goals: [],
    carFunds: [],
    profile: { ...profile, paycheck_deductions: [] as never },
    debtPayoffOptions: { cashFloor: profile.cash_floor },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: DEMO_FUNDING_ACCOUNT_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEMO_ASSUMPTIONS,
    syncCutoffDate: toLocalDateStr(now),
    paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current!;
}

/** The fixture's forecast WITH its cards — the only reading that may be quoted about cash. */
export function runDemoForecastWithCards(now: Date): ForecastResult {
  return calculateForecast(demoForecastInputs({ now, cardProjection: runDemoCardProjection(now) }));
}

/** What `runDemoAsApp` reads off the app's own provider. */
export interface DemoAsApp {
  forecast: ForecastResult;
  cardProjection: {
    simRevolvingPayoffMonth: number | null;
    month0?: { safeToPayTotal: number; endCash: number };
  };
  cashFloor: number;
  carFunds: number;
  converged: boolean;
}

/**
 * THE DEMO EXACTLY AS /demo RUNS IT: the app's real `CardProjectionProvider`, in demo mode, with no
 * signed-in user, so the app's own data hooks return the fixture. Nothing here assembles inputs.
 *
 * ⚠️ WHY THIS EXISTS (ask 16147de8). `runDemoCardProjection` / `runDemoForecastWithCards` above pass
 * debts, goals, car funds and transactions as EMPTY. The app passes all four. On 2026-09-23 that
 * difference made the marketing lines say the cards clear "Dec 2027" while /demo said "Not within 5
 * years", and nothing went red. Measured after this was written: this function returns
 * "CC Debt Free May 2028" then "Sep 2030 Vacation Fund Complete", which is what /demo showed that day.
 *
 * ⚠️ IT RE-IMPORTS EVERYTHING. demo-data.ts computes its dates at IMPORT time from the wall clock, so
 * the module registry is reset after the clock is set. React, Testing Library and React Query are
 * imported from the same fresh registry, or the hooks would run against a second React.
 *
 * Only `Date` is faked: React Query and `waitFor` need real timers. The caller must declare
 * `// @vitest-environment jsdom`. Call `vi.useRealTimers()` afterwards.
 */
export async function runDemoAsApp(now: Date): Promise<DemoAsApp> {
  const { vi } = await import('vitest');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.resetModules();
  window.sessionStorage.setItem('forged:demo_session', 'true');

  const React = await import('react');
  const { render, waitFor, cleanup } = await import('@testing-library/react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { DemoProvider } = await import('@/contexts/DemoContext');
  const { CardProjectionProvider, useCardProjectionContext } = await import('@/contexts/CardProjectionContext');
  const { demoCarFunds } = await import('@/lib/demo-data');

  let ctx: ReturnType<typeof useCardProjectionContext> | null = null;
  function Capture() {
    ctx = useCardProjectionContext();
    return null;
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const h = React.createElement;
  render(h(QueryClientProvider, { client: qc }, h(DemoProvider, null, h(CardProjectionProvider, null, h(Capture)))));

  // Wait for the SAME thing the page waits for: the fixture loaded AND the card projection built.
  await waitFor(() => {
    if (!ctx || ctx.carFunds.length !== demoCarFunds.length || !ctx.cardProjection) throw new Error('demo not loaded');
  }, { timeout: 20_000 });

  const c = ctx as unknown as ReturnType<typeof useCardProjectionContext>;
  const result: DemoAsApp = {
    forecast: c.projections,
    cardProjection: c.cardProjection as unknown as DemoAsApp['cardProjection'],
    cashFloor: c.cashFloor,
    carFunds: c.carFunds.length,
    converged: c.debtCashConverged,
  };
  cleanup();
  qc.clear();
  window.sessionStorage.removeItem('forged:demo_session');
  return result;
}
