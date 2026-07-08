# Handoff — 2026-07-07 (session 7) — branch debt-model-fixes-p0 — ALL 6 STEPS SHIPPED, live-verify pending

## Goal (unchanged, plan approved session 5)
Phase 2 Option C convergence: popup payments == accordion payments+surplus AND balances, every
month. All 6 plan steps are now implemented and committed. Only live verification remains.

## Session-7 state — code COMPLETE
- **Step 5 lib SHIPPED (54223143)**: `src/lib/forecast-convergence.ts` —
  `runDebtCashConvergence(base, engineInputs, { maxPasses=3, toleranceDollars=1, engine=calculateForecast })`
  → `{ cardProjection, projections, converged, passes }`. Month-0 NaN live-anchor rule; always
  resims from base (closure is stateless); exhausted budget ⇒ base pair (zero-regression
  fallback). Its 5 tests (`src/lib/__tests__/forecast-convergence.test.ts`) green.
- **Steps 4+6 wiring SHIPPED (b899c575)**:
  - CardProjectionContext.tsx: calls `useForecastEngineInputs` (step-4 hook, committed earlier in
    1e6707fb) + convergence useMemo keyed on [cardProjection, engineInputs]. Context value now
    publishes: CONVERGED `cardProjection` (base sim only on fallback/null), matching
    `projections`, `engineInputs` (cardProjectionData swapped to converged sim),
    `forecastInputsBundle` (all intermediates), `debtCashConverged`. Null sim ⇒ single base
    engine run, converged=false.
  - useForecastProjections.ts: slimmed 345 → 41 lines; thin context reader preserving EXACT
    return shape. Forecast.tsx:158 (only caller) untouched. DebtPayoff/Dashboard pick up
    convergence via context with zero changes.
- **Gates**: tsc clean; full suite green except the 3 known pre-existing activeLoanInsurance
  failures; golden Tier-A green (fixture present). Graphify updated.

## Next steps
1. **Live-verify (only remaining item)**: run the app; on Debt Payoff / Forecast check
   - popup payments == accordion payments+surplus, month by month (esp. Sep 2026);
   - Prime $4,060 / Discover $6,377 Sep 2026 balance anchors hold;
   - popup Prime payment $1,260 vs accordion $860+$98 gap CLOSES;
   - if numbers look wrong, `debtCashConverged` on the context tells you whether the loop
     converged or fell back to the base pair (fallback = pre-change behavior, zero regression).
2. Perf risk accepted (≈3 sims + 3 engine runs per data change); gate lazily later if it
   complains.
3. Never push (standing rule). Branch has NOT been pushed.

## Key anchors
- CardProjectionContext.tsx: convergence memo + engineInputs memo directly after the
  useCardProjection call; context interface gained 4 fields (projections, engineInputs,
  forecastInputsBundle, debtCashConverged).
- src/hooks/useForecastEngineInputs.ts: derivation extraction, parameterized on
  cardProjectionData; data hooks stay inside (react-query cached).
- resimulateWithDebtCash must NOT enter downstream useMemo dep arrays (fresh closure each
  compute) — consumers key on cardProjection object identity. Converged cardProjection is a
  stable object per convergence-memo compute, so identity keying still works.
- ForecastResult rows carry debtPayment and revolvingDebtCash (forecast-engine.ts :75, :1433).

## Constraints (unchanged)
Never push. Backups before edits (backups/2026-07-07_174315 covers both wired files, committed
in 1e6707fb). Golden re-pin only with live-data justification. Don't touch
cycling-classification live-balance gate. Supabase queries filter
user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'. 3 activeLoanInsurance failures are
pre-existing — don't chase.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance failures (pre-existing).
