# Handoff — 2026-07-20 (session 6) — Undershoot ROOT-CAUSED: fixture is missing paymentPlans

## State: on branch `q12-floor-cutoff` (5998c911) with UNCOMMITTED temp diagnostics

Main untouched. Q12 itself unchanged and still correct (see session-5 handoff, commit c897a231,
for its details). Working tree has TEMP instrumentation (all marked
`// TEMP Q12 DIAG — remove before merge`, gated on `(globalThis).__Q12_DIAG`, inert otherwise) in:

- `src/lib/credit-card-engine.ts` — 3 log points in simulateVariablePayoff (m===1): pool sizing
  (A), mandatory payments (B), final Step-5 payments (C).
- `src/lib/forecast-engine.ts` — m1 cashPreDebt component breakdown (after :1101).
- `src/hooks/useCardProjection.ts` — m1 expense composition + per-event dump in its
  forecastMonthEvents builder.
- `src/lib/__tests__/q12diag.realData.test.ts` — UNTRACKED throwaway harness (clone of
  forecast-convergence.realData.test.ts, no pinning assertions) that sets the flag and dumps
  engine per-pass m1 rows. Run:
  `npx vitest run src/lib/__tests__/q12diag.realData.test.ts --silent=false --reporter=verbose`

Revert instrumentation when done: `git checkout -- src/lib/credit-card-engine.ts
src/lib/forecast-engine.ts src/hooks/useCardProjection.ts` + delete the q12diag test.

## ROOT CAUSE of the Aug 2026 undershoot (the session-5 blocker)

**The golden fixture `forecast-inputs.real.json` has `planExpensesByMonth = [0, 228, 228, …]`
captured as an engine input, but does NOT carry the raw `paymentPlans` rows** (key absent).
The realData harness passes `paymentPlans: fx.paymentPlans ?? []` → the sim's
`planCashExpensesEarly` is all zeros → the sim's cash walk is exactly **$228/month richer**
than the engine's authoritative walk.

Verified numbers (post-Q12, m1 = Aug 2026):
- Sim: currentCash 3191.35 + income 4495.56 − monthExpenses 3220.12 = 4466.79 pre-debt.
- Engine: same start/income, outflows 2752 base (= events 2524 + **plan 228**) + 422.89 car loan
  + 173.23 insurance + 100 transfers → cashPreDebt 4238.79. Gap = 228.00 exactly.
- Both sides' scheduled-events m1 expenses are IDENTICAL (2524) — the sim-vs-engine event
  builders are NOT the problem. The $228 enters only via `baseExpenses += planExpensesByMonth[i]`
  (`forecast-engine.ts:689`); sim counterpart `planCashExpensesEarly[idx]` (useCardProjection
  :140-146, added into month expenses :642) is 0 because paymentPlans = [].

Why the engine can't correct it: **Aug is an ISB-pinned month.** `forecast-convergence.ts:61-66`
excludes manualIsbPins months from target feedback (NaN), so `mDebtTarget` is null in the sim for
m1 on every pass (confirmed in logs); the sim pays the 1164.79 pin + drains its own (inflated)
surplus (500 to the second card = 1664.79 total), landing the sim at exactly its floor+cushion
2802 while the engine lands at 2574 — below the 2800 base floor → breach milestone. PASS-3's
deficit branch computes the right correction (target 1665→1437) but it is deliberately never
delivered to a pinned month.

Implications:
1. **The undershoot is (at least in the harness) a fixture artifact, not an engine bug.** In the
   live app useCardProjection receives real paymentPlans, so sim and engine should agree.
   The session-5 pre-fix/post-fix breach table was measured in this same harness and carries the
   same $228 skew — including the 5 failing suites blocking Q12's merge.
2. The Q4-era design "pinned months get no feedback" makes the sim's internal walk the sole
   authority for pinned months — any sim/engine expense drift surfaces as an uncorrectable floor
   breach there first. Worth a guard, but fix the fixture before judging the engine.

## Next steps (in order)

1. **Confirm live parity**: check whether Tre's real account actually shows the Aug breach in the
   app with Q12's branch (it should NOT, if paymentPlans flow live). Alternatively synthesize the
   missing plan: inject a checking-sourced paymentPlan producing $228/mo into the harness
   (`getMonthlyPlanCashExpenses` must return [0,228,228,…] matching the fixture array — month 0
   is 0 because of the syncCutoffDate arg) and confirm the Aug breach disappears and floor
   convergence is clean. If yes → blocker dissolves.
2. **Fix the capture path**: add `paymentPlans` to the fixture serializer/revivers
   (`src/lib/__tests__/fixtures/forecast-fixture-io.ts` + wherever the app captures the fixture)
   so raw plan rows travel with the capture; then have Tre recapture the fixture live.
   (Q7 already added the harness override parameter — only the fixture content is missing.)
3. Re-run full suite on `q12-floor-cutoff` against the recaptured fixture; re-pin the 5 failing
   suites (goldenTierA, realData, manualISB) against correct behavior; then merge Q12 per
   session-5 plan.
4. Optional hardening (discuss with Tre first): for ISB-pinned months, clamp the sim's Step-5
   drain at the ENGINE's floor semantics or emit a warning when sim/engine walks diverge > $X —
   prevents silent recurrence of this class.

## Still queued (untouched)
- Anomaly A (pin clamp UX, UI-only) and Anomaly B (route overrideSim through
  runDebtCashConvergence) — see session-5 handoff (c897a231) for details.

## Gotchas (carry forward)
- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — use `--silent=false --reporter=verbose`; failure
  details on STDERR → Bash with 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- `pinnedMonths` (manualIsbPins) get NaN targets by DESIGN (payment↔clip two-cycle) — don't
  "fix" by feeding them targets without understanding forecast-convergence.ts:61-66.
- Sim monthExpenses already includes car loan/insurance/transfers/savings (useCardProjection
  :640-642) — the ONLY missing piece was planCashExpensesEarly.
- `dueSynced` current-month date semantics gotcha from session 5: orthogonal, still untouched.
