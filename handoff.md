# Handoff — 2026-07-08 ~00:00 — branch debt-model-fixes-p0 — maxPasses fix SHIPPED; popup gap = design issue; activeLoanInsurance fix DIAGNOSED, not started

## Goals
1. Phase 2 Option C convergence: popup payments == accordion payments, every month. (Partially
   resolved this session — see Current State.)
2. NEW user request this session: "fix the preexisting active loan issues" = the 3 failing tests
   in `src/hooks/__tests__/useCardProjection.activeLoanInsurance.test.ts`.

## Current State
- **Convergence maxPasses fix SHIPPED + LIVE-VERIFIED** (commit after 640dfc13, message
  "[convergence]: default pass budget 3 -> 8 ..."): damping 0.5 + maxPasses 8 → live app logs
  `converged=true passes=6` on both /debt and /forecast (verified in browser, signed-in session).
  Gap trajectory: 1423 → 159 → 91 → 133 → 29 → 1. Damping 0.6 tested live: WORSE (gap 6 at pass
  8, drifting at month 12) — keep 0.5. 7/7 convergence tests green, tsc clean.
  Backup: backups/2026-07-07_234634. All temp console.debug instrumentation REMOVED.
- **Popup ≠ accordion REMAINS even at converged=true — this is a DESIGN issue, not a knob.**
  Live numbers Sep 2026: accordion (sim) Prime $906 / Discover $1,133 (sum $2,039); popup Prime
  $676 / Discover $846 (sum $1,522 = engine row.debtPayment). Cause: Forecast.tsx ~line 962-980
  scales sim per-card payments so they sum to engine row.debtPayment. Engine debtPayment =
  revolvingDebtCash + engine's OWN cycling model; sim payments = revolving target + ACTUAL
  purchase paybacks ($148 Prime + $831 Discover incl one-time). The two cycling models differ
  (~$517 in Sep) so no pass count closes it. `debtCashConverged` is published by
  CardProjectionContext (line ~222) but consumed by NOTHING. Options need Tre's decision (see
  Next Steps 3). Popup cash math is internally consistent (Starting+income−lines=Ending ✓).
- **activeLoanInsurance failures DIAGNOSED, fix NOT started.** 3 of 4 tests fail:
  `month0.vehicleInsurance` = 0, expected ≥150. Root cause confirmed in
  `src/hooks/useCardProjection.ts` lines ~588-595 (carLoanInsuranceByMonth month-0 gate) and the
  analogous gate at lines ~541-547 (getVehicleExtrasForMonth / insuranceSynced): month-0 skips
  insurance when its due date `<=` m0SyncCutoff. Tests set syncCutoffDate = 1st of current month
  AND anchor insurance dates to the 1st → `"YYYY-MM-01" > "YYYY-MM-01"` is false → zeroed.
  This is the known "due-day-1 zeroing" backlog item (see memory project_forecast_engine_refactor).
  Real-app semantics: syncCutoffDate (CardProjectionContext.tsx lines 123-132) = Plaid
  last_synced_at date, or today if no Plaid. So cutoff = date THROUGH which transactions are
  settled; a due-day-1 item with cutoff on the 1st IS arguably already captured — the open
  question is whether product behavior (`<=`, drop it) or the tests (expect it present) are
  right. NOT resolved; decide at the design layer, not by patching tests blindly.
- Working tree at handoff commit: only handoff.md changed; all other work committed.

## Active Files
- `src/hooks/useCardProjection.ts` — lines ~541-547 (insuranceSynced/paymentSynced gates in
  getVehicleExtrasForMonth) and ~578-597 (carLoanInsuranceByMonth month-0 gate). The fix for the
  activeLoanInsurance failures goes here (or in the tests, pending the semantics decision).
- `src/hooks/__tests__/useCardProjection.activeLoanInsurance.test.ts` — the 3 failing tests;
  they build "today" as the 1st of the current month and pass syncCutoffDate = 1st.
- `src/lib/forecast-convergence.ts` — damped loop, default maxPasses now 8, damping 0.5.
- `src/lib/__tests__/forecast-convergence.test.ts` — 7 tests; new default-budget test @pass 5;
  fallback test pins maxPasses: 3 explicitly.
- `src/contexts/CardProjectionContext.tsx` — convergence useMemo (~line 196); publishes
  debtCashConverged (unconsumed); syncCutoffDate memo (lines 123-132).
- `src/pages/Forecast.tsx` — lines ~948-981: popup per-card scaling to row.debtPayment + the
  "Adjusted to keep cash safely above your floor" note. This is where a converged-mode display
  change would land IF Tre chooses that option.

## Changes Made
- Commit "[convergence]: default pass budget 3 -> 8 — damped loop verified converging on live
  data at pass 6" (HEAD before this handoff commit): forecast-convergence.ts default maxPasses
  3→8 with comment; test file: header ≤3→≤8, new 'default pass budget of 8' test (converges
  pass 5), fallback test now passes maxPasses: 3 explicitly. Backup backups/2026-07-07_234634.
- Temp instrumentation (console.debug in CardProjectionContext + per-pass log in
  forecast-convergence.ts) added for live-verify and fully removed before commit.

## Failed Attempts
- damping 0.6 (live, temp override): does NOT converge in 8 passes — gap stuck ~$6-15 drifting
  to month 12. Do not retry. 0.4 untested (0.5 already converges; no need).
- Raising passes does NOT close the popup-vs-accordion gap — it's structural (cycling model
  mismatch), verified live at converged=true.
- Browser console read_console_messages with clear=true returns the OLD buffer then clears —
  reload the page AFTER clearing, or filter by timestamp, to avoid stale reads.

## Next Steps
1. **activeLoanInsurance fix** (user-requested): decide the due-day-1 boundary semantics.
   Recommendation: treat the cutoff as exclusive for same-day dues is ambiguous — but note the
   REAL bug pattern: with no Plaid, syncCutoff = today, so ANY insurance due earlier this month
   is dropped from month 0 (probably correct: it was paid). The tests construct a fund whose
   loan STARTS today (the 1st) with cutoff also the 1st — arguably the payment hasn't happened.
   Options: (a) change gates to strict `<` only when the due date equals loan_start_date /
   insurance_start_date month-start (first-ever charge can't have been synced before it exists);
   (b) simpler: change both gates from `<=` to `<` (dues ON the cutoff day count as NOT yet
   captured); (c) fix tests to set syncCutoffDate one day earlier. Per CLAUDE.md ambiguity rule,
   ask Tre which semantics he wants — (b) is the minimal-diff candidate but shifts real-app
   behavior for anything due exactly on the Plaid sync date. Then TDD: adjust/add tests, fix
   both gates (lines ~541-547 AND ~588-595 must stay consistent), backup first, commit.
2. Full-suite regression check after the fix (baseline: only these 3 failures pre-existing).
3. **Popup-vs-accordion design decision** (ask Tre): at converged=true, should the popup show
   the sim's actual per-card payments (Prime $906/Discover $1,133, matching the accordion) with
   the cash lines rebalanced (bills/one-time lines would need the card-routed purchase amounts
   removed to keep Starting→Ending arithmetic true), or keep engine-cash-consistent scaled lines
   (current behavior, internally consistent but ≠ accordion)? This decides whether Phase 2
   Option C's original acceptance criterion (popup == accordion ≤ $1) is achievable via display
   wiring (consume debtCashConverged in Forecast.tsx) or needs engine cycling-model alignment.
4. Update memory (project_cycling_debt_engine) + roadmap once 1-3 land; session summary file per
   global CLAUDE.md when wrapping up.

## Key anchors (unchanged from prior handoff)
- Dev server localhost:8080, signed in; route /debt (accordion = expand card → Monthly
  Projection table), /forecast (popup = tap Monthly Breakdown row).
- Never push. Backups before edits. Supabase user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'.
- Golden Tier-A untouched (pure engine on fixture — provider-path changes don't feed it).

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
