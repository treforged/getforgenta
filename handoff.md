# Handoff — 2026-07-07 (session 7) — branch debt-model-fixes-p0 — damping SHIPPED (640dfc13), live-verify INTERRUPTED by logout

## Goal (unchanged)
Phase 2 Option C convergence: popup payments == accordion payments+surplus AND balances, every
month. All 6 plan steps + damping fix are implemented and committed. Only the FINAL live
verification (post-damping) remains.

## Session-7 results
- **Step 5 lib (54223143)** + **steps 4-6 wiring (b899c575)**: shipped, gates green (see git log).
- **Live verify round 1 (pre-damping) — loop did NOT converge on real data**:
  `converged=false passes=3` every run. Instrumented per-pass:
  pass 1 maxGap $1,423 @month 10 (2486→1063); pass 2 $196 @month 9 (2915→2719);
  pass 3 $201 @month 9 (2719→2920) — stable two-cycle, fallback engaged, so UI showed
  pre-change numbers: Sep 2026 popup Prime $702 / Discover $820 vs accordion $814 / $950.
  Balances: accordion Prime Sep 2026 END $4,060 (anchor holds exactly); Discover END $6,516 vs
  $6,377 anchor — data drift (Sep has $831 Discover purchases incl. one-time), NOT a regression
  (fallback = raw sim = pre-change by construction).
- **Damping fix SHIPPED (640dfc13)**: forecast-convergence.ts — after pass 1, target =
  0.5*new + 0.5*prev (option `damping`, default 0.5; damping:1 = old undamped behavior).
  TDD: updated pass-2 target expectation ([355,280,180], midpoint), new 900−t oscillator test
  (converges damped @pass 3, falls back undamped). 6/6 green, tsc clean, full suite at known
  baseline (3 pre-existing activeLoanInsurance failures). Backup backups/2026-07-07_232807.

## Next steps (in order)
1. **Live-verify round 2 (post-damping)** — BLOCKED this session: dev server (8080) full-page
   reload dropped the Supabase session; app sits at /auth sign-in and I can't enter credentials.
   Tre must sign in first. Then on /debt + /forecast check Sep 2026:
   - popup per-card payments == accordion payments (Prime + Discover), gap ≤ ~$1;
   - accordion balances shift is EXPECTED if convergence now succeeds (payments change ⇒
     balances change); sanity-check Prime near $4,060;
   - to confirm convergence status, temporarily add
     `console.debug('[convergence]', result.converged, result.passes)` in the convergence
     useMemo of CardProjectionContext.tsx (I did this and REMOVED it — repeat if needed) or
     read `debtCashConverged` from context.
   - If STILL not converged: try damping 0.4/0.6 or maxPasses 4-5 (cheap knobs, already
     parameterized). Oscillation was at months 9-10 (Apr/May 2027).
2. If verified: update memory project-cycling-debt-engine + roadmap; consider whether golden
   Tier-A needs re-pin ONLY if provider-path numbers feed it (it runs the pure engine on a
   fixture — should be untouched).
3. Session summary file per global CLAUDE.md if wrapping up.

## Key anchors
- forecast-convergence.ts: damped loop; prevTarget tracks last pass's target; month-0 always NaN.
- CardProjectionContext.tsx: convergence useMemo right after useCardProjection; publishes
  converged cardProjection/projections/engineInputs/forecastInputsBundle/debtCashConverged.
- useForecastProjections.ts: thin context reader (41 lines), exact old return shape.
- Debt Payoff accordion = per-card MONTHLY PROJECTION table on /debt (expand card section);
  popup = tap month row on /forecast MONTHLY BREAKDOWN.
- Dev server localhost:8080 (route is /debt NOT /debt-payoff).

## Constraints (unchanged)
Never push. Backups before edits. Golden re-pin only with live-data justification. Don't touch
cycling-classification live-balance gate. Supabase user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'.
3 activeLoanInsurance failures pre-existing — don't chase.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance failures (pre-existing).
