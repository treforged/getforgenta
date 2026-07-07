# Handoff — 2026-07-07 (session 6) — branch debt-model-fixes-p0 — steps 1-3 SHIPPED, step 4 file written, step 5 test RED

## Goal (unchanged, plan approved session 5)
Phase 2 Option C convergence: popup payments == accordion payments+surplus AND balances, every
month. 6-step plan in the session-5 handoff section below — still the authority.

## Session-6 state
- **Step 3 SHIPPED + committed (10b49d01)**: `resimulateWithDebtCash(target)` on
  CardProjectionResult. Pure builder `src/hooks/cardProjectionResim.ts` (buildResimOverrides:
  rebuilds data/totals/perCard*/maps/payoff months from a re-targeted sim — NO pass-3, NO
  scaling, surpluses all zero, forecastAdjustedRevolvingBalances = simT.monthlyRevolvingBalances
  verbatim, both payoff-month fields = first month simT total revolving hits 0; keeps the cycling
  save-up discretionary branch + save-up allPaymentTotals cap). Closure in useCardProjection.ts
  replays the ACTIVE sim variant via new locals `activeSimM0Expenses`/`activeSimMaxDebt`
  (set at the `let activeSim = sim` block; overwritten in the capped-retry branch), passes target
  as param #20, returns `{ ...hookResult, ...overrides, resimulateWithDebtCash }`. month0/saveUp/
  look-ahead/m0* kept from base. 7 hook-level tests in
  src/hooks/__tests__/useCardProjection.resimulateWithDebtCash.test.ts — all green via renderHook
  synthetic data (pattern copied from useCardProjection.month0income.test.ts). Full suite green
  except the 3 known pre-existing activeLoanInsurance failures; golden Tier-A green (fixture
  present); tsc clean. Backup backups/2026-07-07_172828.
- **Step 4 file WRITTEN, not committed, not yet consumed**: `src/hooks/useForecastEngineInputs.ts`
  — verbatim extraction of useForecastProjections' derivation body (data hooks stay inside,
  react-query cached), parameterized on { cardProjectionData, assumptions, pauseSavings,
  payConfig, cashFloor, forecastFundingAccountId, syncCutoffDate, scheduledEvents,
  debtPayoffOptions }. Returns { engineInputs, ...all intermediates, prePaycheckBillsInfo }
  (everything useForecastProjections returned EXCEPT projections). Exports
  ForecastEngineInputsBundle type. NOT typechecked yet. useForecastProjections.ts NOT yet
  touched.
- **Step 5 loop test WRITTEN (RED — implementation file missing)**:
  `src/lib/__tests__/forecast-convergence.test.ts`. Settled contract to implement in
  `src/lib/forecast-convergence.ts`:
  `runDebtCashConvergence(base: CardProjectionResult, engineInputs: ForecastInputs, opts?: { maxPasses=3, toleranceDollars=1, engine=calculateForecast (type ConvergenceEngine = (i: ForecastInputs) => ForecastResult, exported) })`
  → `{ cardProjection, projections, converged, passes }`. Algorithm: baseProj =
  engine({...inputs, cardProjectionData: base}); currentProj = baseProj; for pass 1..maxPasses:
  target = currentProj.data.map(r => r.revolvingDebtCash); **target[0] = NaN** (month-0
  live-anchor rule); resim = base.resimulateWithDebtCash(target) (ALWAYS from base — closure is
  stateless); resimProj = engine({...inputs, cardProjectionData: resim}); if max_m
  |resimProj.data[m].debtPayment − currentProj.data[m].debtPayment| ≤ tolerance → return
  { resim, resimProj, converged: true, passes: pass }; else currentProj = resimProj. Exhausted →
  return { base, baseProj, converged: false, passes: maxPasses } (zero-regression fallback).
  ⚠ Suite currently RED on this one file (import fails) — implement forecast-convergence.ts
  FIRST thing next session.

## Next steps (in order)
1. Implement src/lib/forecast-convergence.ts per contract above → its 5 tests green.
2. Typecheck step-4 file; commit steps 4-file + 5-lib together or separately.
3. Wire provider (CardProjectionContext.tsx, backup already at backups/2026-07-07_174315):
   call useForecastEngineInputs({ cardProjectionData: cardProjection, assumptions, pauseSavings,
   payConfig, cashFloor, forecastFundingAccountId, syncCutoffDate, scheduledEvents,
   debtPayoffOptions }); convergence useMemo keyed on [cardProjection, inputsBundle.engineInputs]
   running runDebtCashConvergence; context value publishes CONVERGED cardProjection (replacing
   raw one) + projections + engineInputs + intermediates bundle. DebtPayoff/Dashboard then pick
   up convergence with zero changes.
4. Step 6: slim useForecastProjections.ts to a thin context reader preserving its EXACT return
   shape { projections, engineInputs, monthlyAggregates, debtPaymentsByMonth,
   debtBalancesByMonth, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth,
   currentMonthRecommendedDebt, forecastMonthEvents, planExpensesByMonth,
   annualFederalWithheldFromBudget, prePaycheckBillsInfo } (Forecast.tsx:158 is its only caller —
   untouched).
5. Full suite + golden Tier-A green (fallback path must keep golden green even if convergence
   changes numbers — if golden changes, that means the PROVIDER path changed engine inputs;
   golden test itself runs the pure engine on the fixture so it should be untouched).
6. Commit, then live-verify: popup vs accordion Sep 2026; Prime $4,060 / Discover $6,377 balance
   anchors hold; popup Prime payment $1,260 vs accordion $860+$98 gap must close. Perf risk
   accepted (≈3 sims + 3 engine runs per data change); gate lazily later if it complains.

## Key anchors (verified this session)
- CardProjectionContext.tsx: provider body :50-196; cardProjection = useCardProjection(:152);
  context value useMemo :172-189; DebtPayoffOptions type local :26-31 (inputs hook re-declares it
  structurally to avoid a hooks→context import cycle).
- useForecastProjections.ts: 345 lines, whole derivation body now duplicated in
  useForecastEngineInputs.ts; slim it in step 6 (do NOT leave the duplicate).
- ForecastResult = { data: ForecastMonthRow[], milestones }; rows carry debtPayment and
  revolvingDebtCash (:75, emitted :1433 in forecast-engine.ts).
- resimulateWithDebtCash must NOT enter downstream useMemo dep arrays (fresh closure each
  compute) — consumers key on cardProjection object identity.

## Constraints (unchanged — see session-3 section + memory project-cycling-debt-engine)
Never push. Backups before edits (done for all files touched so far). Golden re-pin only with
live-data justification. Don't touch cycling-classification live-balance gate. Supabase queries
filter user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'. 3 activeLoanInsurance failures are
pre-existing — don't chase.

## ── Session-5 handoff (approved 6-step plan text — still the authority) ──

## FULL PLAN (approved)
1. forecast-engine.ts (additive): ForecastRow.revolvingDebtCash — DONE 8d81a9d6.
2. credit-card-engine.ts: simulateVariablePayoff param #20 debtCashTargetByMonth — DONE 8d81a9d6.
3. useCardProjection.ts: resimulateWithDebtCash — DONE 10b49d01.
4. New src/hooks/useForecastEngineInputs.ts: extract useForecastProjections' derivation body
   verbatim, parameterized on cardProjectionData. — file written, uncommitted.
5. CardProjectionContext.tsx: inputs hook + convergence useMemo: engine(base) → target =
   rows.revolvingDebtCash → resimulateWithDebtCash(target) → engine again → compare monthly
   debtPayment arrays; ≤3 passes, $1/month tolerance; converged ⇒ publish converged
   projection+projections, else ⇒ publish base (Option A machinery = zero-regression fallback).
   Context value gains projections/engineInputs/intermediates. — loop lib test written (RED).
6. useForecastProjections.ts: slim to thin context reader preserving return shape.
Live verify: Sep 2026 Prime $4,060 / Discover $6,377 hold; popup Prime payment $1,260 vs
accordion $860+$98 gap closes.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance failures (pre-existing).
