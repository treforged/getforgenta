# Handoff — 2026-07-07 (session 3, context-gated mid-planning) — branch debt-model-fixes-p0

## Goal
Phase 2 Option C convergence rework (user said "lets do Phase 2 Option C"): converge the
forecast engine's cash walk and the card sim so popup payments == accordion payments+surplus
AND balances == every month, no ETA/milestone regression, Ending Cash consistent. Option A
display unification is SHIPPED + live-verified (commit 75eef32) — see git history and the
session notes at claudecontext/sessions/2026-07-07_forecast-cc-display-unification.md.

## State: mid-PLANNING, no code touched. Mechanics audit DONE (Explore agent). Design ~60%.

## Mechanics audit results (verified against current code — trust these anchors)
- **Data flow is one-way, NOT circular**: useCardProjection (hook) → CardProjectionContext.tsx:152
  → useForecastProjections.ts (assembles ForecastInputs :319-325, calls calculateForecast :327)
  → Forecast.tsx. The hook never sees engine output; its PASS-3 replica re-simulates the cash
  walk itself — that is THE structural divergence source.
- **CRITICAL architectural finding**: `useForecastProjections` is called ONLY by Forecast.tsx:158.
  DebtPayoff/CreditCardEngine consume `cardProjection` from CardProjectionContext. So a
  convergence loop living in useForecastProjections would NOT reach the Debt Payoff tab unless
  the converged projection is threaded back into the context (or convergence moves into the
  provider). THIS IS THE MAIN UNRESOLVED DESIGN QUESTION.
- **Engine** (forecast-engine.ts): month loop :1053-1184. Step 2 :1096-1146 — prefers hook's
  summed perCardPaymentsScaled (`hookScaledTotal`) when it fits its own floor ceiling, else
  clamps to its re-derived revolvingPayment+cyclingPayment. Step-3 surplus routing :1148-1184
  (`cumulativeStep3Extra`, emits `revolving3Extra`). Display adj :1194-1201 uses step3-display
  helpers with `hookCumSurplusByCard` (:1051). Engine does cash math on TOTALS only
  (allPaymentTotals/debtPaymentTotals); per-card data is display-only. Row outputs :1345-1424
  (debtPayment :1351, ccDisplayBalance :1396, revolving3Extra :1423).
- **Hook** (useCardProjection.ts): bootstrap sim :936; outer refinement loop ×3 :968-994
  (augmented floor + ccMinInFloor fed back); PASS-3 replica :1197-1268 (own p3Cash/p3RevBal
  cash reconstruction from simulationMonthEvents/mortgage/lump/one-time — "roughly mirrors"
  engine, comments at :1213/:1243 admit it); capped-retry sim2 :1282, activeSim :1309; pass-3
  re-run vs sim2 :1348-1403; extraPerCardByMonth :1449-1483 (avalanche-priority distribution of
  pass3 surplus, capped at remainingBal); protectedPerCardByMonth :1491-1510;
  perCardPaymentsScaled build :1512-1557 (payments = simAmt*scale+extra, scale =
  min(1, pass3RevTotals/debtPaymentTotals); surpluses = extraPerCardByMonth).
- **simulateVariablePayoff** (credit-card-engine.ts :547-671): 19 positional params; relevant:
  #8 monthEvents (per-month income/expense — the cash input), #15 maxDebtPaymentByMonth (CAP
  only, can't force paying MORE), #16 cashFloorByMonth, #17 ccMinAlreadyInFloorByMonth,
  #18 installmentChargeByMonth, #19 upfrontPayByMonth. New params go at END (#20+). Returns
  monthlyPayments/Balances/RevolvingBalances/Interest/CyclingOwed/CyclingInterest/
  perCardMinPayments/monthlyMandatoryCyclingPayment/monthlyCyclingBacklog Maps +
  projectedPayoffMonths etc.
- **Tests**: forecast-engine.goldenTierA.test.ts + step3-display.test.ts self-skip without
  gitignored fixture `src/lib/__tests__/fixtures/forecast-inputs.real.json`; loader
  `forecast-fixture-io.ts` (`reviveForecastCapture`, fake timers pinned to capturedAt).

## Draft design direction (NOT final — next session must settle the architecture question)
- New optional sim param at END, e.g. `debtCashTargetByMonth?: number[]`: when present, the
  sim allocates exactly min(target, owed) of revolving debt cash per month through its normal
  per-card cascade — sim becomes the per-card allocator of the ENGINE's authoritative monthly
  debt cash (both clamp months AND surplus months; note maxDebtPaymentByMonth alone can't do
  surplus months since it's only a cap).
- Iteration: hook sim as today → engine run → extract actual monthly revolving debt cash
  (engine needs to emit revolvingPayment+step3Surplus per row, per month — currently only
  cumulative revolving3Extra) → re-run sim with target → rebuild per-card plan (payments =
  sim.monthlyPayments directly; surpluses → 0 at fixed point) → engine run → compare totals;
  bounded passes (≤3?), $1-ish tolerance.
- At the fixed point the step3-display adjustments become no-ops (cum surpluses = 0), accordion
  reconciles natively, popup payments == accordion payments. KEEP Option A display machinery as
  the safety fallback when convergence fails within the pass budget — zero-regression property.
- 2026-06-19 lesson satisfied by construction: the sim actually PAYS the real cash, so PASS-3
  scaling decisions and min-payment safety see true balances (but VERIFY min-payment safety
  months where engine clamps below hook plan — sim must still enforce minimums; if engine
  target < sum of minimums some month, that's a floor-forced reality the sim must represent
  without violating its own min-payment invariants — check how Step 2 handles this).
- UNRESOLVED: where the loop lives. Options: (a) move/lift ForecastInputs assembly so
  CardProjectionContext can run engine passes (heavy refactor, check what data the provider
  already has vs useForecastProjections' needs); (b) run loop in useForecastProjections and
  thread converged projection back into context state (setter; Debt Payoff then needs Forecast's
  inputs assembled even when Forecast page not mounted — problem); (c) expose a
  `resimulateWithDebtCash(target)` closure from useCardProjection and orchestrate at provider
  level with a lifted inputs-builder. Leaning (c)+(a) hybrid; must read CardProjectionContext.tsx
  and useForecastProjections.ts:1-330 first to see what data each already has.

## Constraints (from memory project-cycling-debt-engine — READ IT, it's long but load-bearing)
- 2026-06-19 revert: display-layer fix on uncorrected recommendation = min-payment violations.
- "sim3" precedent: re-running the sim with real cash caps worked in isolation; sanctioned start.
- Do NOT touch the cycling-classification live-balance gate (`c.balance > 0`) — 2 failed attempts.
- Golden Tier-A re-pin only with live-data justification. Never push. Supabase queries filter
  user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'.
- Backups to ./backups/YYYY-MM-DD_HHMMSS/ before edits; TDD against the real fixture.

## Next steps (next session, in order)
1. Read CardProjectionContext.tsx fully + useForecastProjections.ts:1-330 (inputs assembly) —
   settle where the convergence loop lives (the unresolved question above).
2. Decide engine changes: emit per-month actual revolving debt cash (revolvingPayment + that
   month's step-3 surplus) on each row (new row field, additive).
3. Write the full plan (files, param positions, iteration + fallback semantics, test list),
   present for approval, THEN implement TDD-first against the fixture.
4. Live-verify per Option A's checklist (popup vs accordion Sep 2026 + payment lines now too —
   Option A reference numbers: Sep 2026 Prime $4,060 / Discover $6,377; popup Prime payment
   $1,260 vs accordion $860+$98 is the gap Phase 2 closes).

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance test failures (pre-existing — don't chase).
