# Handoff — 2026-07-20 (session 10) — Anomaly B SHIPPED; live verify MOSTLY DONE

## LIVE VERIFY RESULT (this session, context-gated mid-verify)
On localhost:8080 /debt (Tre logged into DEV server), pinned Prime Visa Aug 2026 → $100:
- Anomaly A clamp note RENDERS: "Pinned $100 raised to this month's required payment";
  payment shows -$511 with "edited" badge (matches the $510.50 mandatory-obligation clamp).
- Rows rebalanced on the new basis with NO errors: Aug end $6,453 (was $5,956 pre-pin),
  Sep -$1,215 end $5,428; TOTAL INTEREST $58→$103; toast "Payment override applied — other
  cards rebalanced"; "overrides" badge + "Revert All" appeared.
- REMAINING (quick): (1) scroll to an UNPINNED card (Discover) and confirm its rows also sit
  on the converged basis (payments shift vs pre-pin, rows reconcile); (2) click Revert All and
  confirm restore to the unpinned converged view (pre-pin PV: Aug -$1,008 end $5,956, Sep
  -$1,215 end $4,919). Pin is ephemeral component state (useState) — a page reload also clears
  it, so re-pin if needed. Then mark Anomaly B fully live-verified in
  memory/project_cycling_debt_engine.md + MEMORY.md index line.

## NEW BACKLOG from Tre (2026-07-20, not started — triage next session)
- Supabase deprecation: GOTRUE_JWT_DEFAULT_GROUP_NAME not supported by GoTrue, removal soon —
  find where it's set (Supabase project auth config/env) and remove/migrate.
- Google Play (release 5.44) recommendations, Android 15 edge-to-edge: deprecated
  Window.setStatusBarColor / setNavigationBarColor (from minified "n1.c.a" — likely a Capacitor
  plugin, e.g. @capacitor/status-bar — check plugin versions before touching code); plus R8:
  optimization off, 25% obfuscation/shrink rates, AGP upgrade to 9.0+ suggested. Advisory, not
  blocking; builds are CI-owned (see reference_cicd.md).

## State: on `main`, clean except backups/ (untracked, never commit). Local commits NOT pushed
(`64a1182b` Anomaly A, `6459f258` Anomaly B, plus handoff/docs commits) — push only when Tre asks.

## Done this session — Anomaly B, commit `6459f258` (implemented exactly as designed, no deviations)
- `src/lib/debt-model-types.ts`: `CardProjectionResult.withPaymentOverrides?` (optional,
  fixture-compat) — rebuilds the result with user month-pins baked into BOTH the base sim and
  its `resimulateWithDebtCash` closure, so convergence's FROM-BASE resims keep pins every pass.
- `src/hooks/useCardProjection.ts`: factored `replayActiveSim(target?, cap?, pins?)` +
  `makeResimulate(pins?)`; pins thread as sim param #21 (`paymentOverridesByMonth`);
  `withPaymentOverrides` added to hookResult.
- `src/components/debt/CreditCardEngine.tsx`: `overrideSim` → `overrideData` memo — reads the
  context's RAW `forecastInputsBundle.engineInputs.cardProjectionData`, runs
  `runDebtCashConvergence(rawBase.withPaymentOverrides(overrides), engineInputs)`, exposes
  `paymentsById` + the five monthly maps; legacy single-pass `variableSim.runSim(overrides)`
  kept only as the no-context fallback. Consumers at projections/debtChartData updated
  (dep arrays included); zero `overrideSim` references remain.
- New test `src/lib/__tests__/forecast-convergence.pinnedOverride.test.ts` (harness cloned from
  realData test, self-skips without fixture): picks pinnable card+month from the unpinned
  converged run, pins payment−$25, asserts converged AND pin survives ±$1. Passed first try:
  Prime Visa m1, pin $983, converged 18 passes.
- Verify: `tsc` clean, 213/213 green (212 prior + new), goldens untouched. graphify updated.
- Backups: `backups/2026-07-20_182906/` (taken last session, still valid for these files).

## NEXT — live verify (only remaining Anomaly B step)
On localhost:8080 /debt (Tre's dev-server session; prod has no session): pin a month (e.g. PV
Aug 2026 → $100), confirm pinned AND unpinned rows shift to the converged basis and reconcile,
Anomaly A clamp note ("Pinned $X raised to …") still renders, Revert All restores. Then mark
Anomaly B live-verified in memory.

## Design notes that survive (don't re-derive)
- Pins live in the closure, NOT a per-call arg — convergence always resims FROM BASE.
- Deliberately NOT extending convergence's `pinnedMonths` NaN-exclusion to user pins: a user pin
  fixes ONE card, others still need target feedback; exhaustion fallback (pinned single-pass
  base) covers a fully-pinned oscillating month.
- runDebtCashConvergence's exhaustion path returns the pinned base — zero-regression guard.

## Gotchas (carry forward)
- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push unless asked.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- otherAccountExpense suite runs on the REAL clock — assertions must stay cumulative/clock-robust.
- Payoff pins are Jul 2027 everywhere (incl. goldenTierA). Fixture has native paymentPlans
  (recaptured 07-20); harness loadRealPaymentPlans() fallback is dormant.
- manualISB test titles say "(2026-07-15)" — cosmetically stale, clock derives from capturedAt.
- perCardPayments are ROUNDED ints; Anomaly A clamp-note threshold is 0.5 — fine with ±$1 tolerance.

## Also queued (unchanged)
- Optional hardening (discuss first): sim/engine cash-walk divergence warning; Step-5 drain
  clamp for ISB-pinned months (pinned months get NaN targets BY DESIGN, forecast-convergence.ts:61-66).
- Stages 4-5 on hold.
