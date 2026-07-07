# Handoff — 2026-07-07 (session 5, PLAN APPROVED, steps 1-2 SHIPPED, step 3 designed) — branch debt-model-fixes-p0

## Session-5 state: USER APPROVED the full plan below. Steps 1-2 implemented TDD-first and committed.
- Commit 8d81a9d6: engine emits ForecastRow.revolvingDebtCash (= max(0, monthDebtPayment −
  cyclingPayment), post-step-3, emitted at data.push in forecast-engine.ts; type at ForecastRow
  end near :70) AND simulateVariablePayoff param #20 debtCashTargetByMonth (override placed right
  AFTER the mDebtCap block ~:1135 in credit-card-engine.ts: availableCash = max(target, totalMins)
  when finite; NaN/undefined entries skip the override — that's deliberate, see month-0 note).
- Tests: credit-card-engine.debtCashTarget.test.ts (7) + forecast-engine.revolvingDebtCash.test.ts
  (1, fixture self-skip) — all green. Full suite: only the 3 known pre-existing
  activeLoanInsurance failures. Golden Tier-A green. Backups: backups/2026-07-07_165741/.

## Step 3 design (SETTLED this session, not yet coded) — resimulateWithDebtCash in useCardProjection.ts
- Expose on CardProjectionResult: `resimulateWithDebtCash(target: number[]): CardProjectionResult`
  — a closure defined INSIDE the useMemo (captures all pipeline locals). CardProjectionResult
  interface is at useCardProjection.ts:52-112 (read it — lists every field to override).
- The closure: re-run simulateVariablePayoff mirroring ACTIVE sim's exact args (refined-loop call
  at :994-1014 uses m0Expenses + planCashExpensesEarly[0] and lookAhead.maxDebtPaymentByMonth;
  the capped-retry sim2 at :1282-1302 uses bare m0Expenses and cappedMaxDebt with
  cappedMaxDebt[0]=m0TotalBudget — capture which variant activeSim used and replay it) + target
  as param #20. NO pass-3, NO scaling, NO extra-distribution in the resim result: payments ARE
  the plan.
- Fields to override in the returned result (spread base result, replace these):
  data rows (rebuild via projectCardVariable from simT, same as :1018-1073 incl. displayCCBalance),
  debtPaymentTotals + allPaymentTotals (from simT/projsT, same derivation :1080-1103, then apply
  the save-up discretionary cap block :1407-1423 with computeCyclingPaymentByMonth(simT)),
  perCardPayments (round simT.monthlyPayments), perCardPaymentsScaled (payments = round simT
  monthlyPayments DIRECTLY for revolving cards but KEEP the cycling save-up branch :1517-1538;
  surpluses = all zeros), all the sim maps (monthlyRevolvingBalances/Balances/Interest/
  CyclingOwed/CyclingInterest/CyclingBacklog/MandatoryCyclingPayment/perCardMinPayments from simT),
  forecastAdjustedRevolvingBalances = simT.monthlyRevolvingBalances verbatim (surpluses are 0),
  simRevolvingPayoffMonth + forecastRevolvingPayoffMonth = first month simT total revolving hits 0.
  KEEP from base: month0 (live-anchored machinery, untouched), saveUpMonths/strict/reason,
  maxDebtPaymentByMonth, m0Income/m0Expenses/m0SafeFloor, cards/simCards.
- MONTH-0 RULE: the provider must pass target[0] = NaN (isFinite check skips it) — month 0 is
  live-anchored (m0AllSettled would send target 0 and force min-only payments, wrong). The
  Sep-2026 gap Phase 2 closes lives in months 1+.
- resimulateWithDebtCash must NOT be in useMemo dep arrays downstream (it's a new function each
  compute — provider consumes it inside its own useMemo keyed on cardProjection object identity).

## Steps 4-6 (unchanged from approved plan, not started)
4. Extract useForecastEngineInputs.ts from useForecastProjections.ts (verbatim, parameterized on
   cardProjectionData). 5. Provider convergence loop (≤3 passes, $1/month tolerance on monthly
   debtPayment arrays; fallback = base projection → Option A machinery = zero-regression).
   6. Slim useForecastProjections to context reader, same return shape.

## Next steps (in order)
1. TDD: test for resimulateWithDebtCash (fixture-based or synthetic through the hook is hard —
   consider testing via a pure extracted builder, or integration-test at provider level in step 5).
2. Implement step 3 per design above. Full suite + golden Tier-A must stay green.
3. Steps 4-6, then live-verify (popup vs accordion Sep 2026; Prime $4,060/Discover $6,377 anchors;
   popup Prime payment $1,260 vs accordion $860+$98 is the gap that must close).

## ── Original session-3/4 handoff below (audit anchors + approved plan text still valid) ──

## RESOLVED (session 4): where the convergence loop lives → (c)+(a) hybrid, loop in CardProjectionProvider
Verified session 4: useForecastProjections is called ONLY by Forecast.tsx:158 (its docstring
claiming "both pages" is stale). Provider already owns EVERY ForecastInputs dependency except
`useBudgetItems` (one cached react-query hook — cheap to add). calculateForecast is pure; the
only hook barrier is useCardProjection, solved by exposing a plain `resimulateWithDebtCash`
closure from it. So: extract inputs assembly into a shared hook, run the loop synchronously in
one provider useMemo, publish the CONVERGED cardProjection + projections through context —
DebtPayoff/Dashboard pick up convergence with zero changes.

## FULL PLAN (presented for approval end of session 4)
1. forecast-engine.ts (additive): new ForecastRow field `revolvingDebtCash` =
   round(monthDebtPayment - cyclingPayment) captured AFTER step-3 surplus routing (surplus is
   all revolving); 0 when m0AllSettled or no revolving activity. cyclingPayment is already in
   scope at :1101; emit at the data.push (:1343).
2. credit-card-engine.ts: simulateVariablePayoff param #20 `debtCashTargetByMonth?: number[]`.
   When present for month m: revolving cash = min(max(target[m], activeMinSum), totalOwed),
   allocated through the EXISTING avalanche/snowball per-card cascade. Min-payment invariant
   always wins over a lower target (floor-forced months). Param absent ⇒ byte-identical.
3. useCardProjection.ts: expose `resimulateWithDebtCash(target): CardProjectionResult` on the
   result — re-runs activeSim with param #20 and rebuilds perCardPaymentsScaled with
   payments = sim.monthlyPayments directly and surpluses = 0 (extraPerCardByMonth zeroed).
4. New src/hooks/useForecastEngineInputs.ts: extract useForecastProjections' derivation body
   (annualFederalWithheld, monthlyAggregates, planExpensesByMonth, debtPayments/BalancesByMonth,
   currentMonthRecommendedDebt, forecastMonthEvents, oneTime/ccOneTime/ccScheduledByMonth,
   engineInputs assembly) verbatim, parameterized on cardProjectionData.
5. CardProjectionContext.tsx: add useBudgetItems + inputs hook; convergence useMemo:
   engine(base) → target = rows.revolvingDebtCash → resimulateWithDebtCash(target) → engine
   again → compare monthly debtPayment arrays; ≤3 passes, $1/month tolerance; converged ⇒
   publish converged projection+projections, else ⇒ publish base (Option A display machinery
   stays as zero-regression fallback). Context value gains projections/engineInputs/intermediates.
6. useForecastProjections.ts: slim to a thin context reader preserving its return shape
   (Forecast.tsx untouched).
Tests (TDD-first vs real fixture): engine emits revolvingDebtCash & reconciles with cumulative
revolving3Extra; sim target honored / min-invariant / cap-at-owed / absent ⇒ identical;
integration: at fixed point per-card surpluses = 0, popup == accordion payments AND balances,
golden Tier-A unchanged (fallback path keeps it green).
Live verify (Option A checklist): Sep 2026 Prime $4,060 / Discover $6,377 balances hold; popup
Prime payment ($1,260) now equals accordion ($860+$98 gap closed).
Risk flag: engine passes now run app-wide in provider (~3 sims + 3 engine runs per data change);
acceptable, gate lazily later if perf complains.

## ── Original session-3 handoff below (audit anchors still valid) ──

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
