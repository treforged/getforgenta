# Handoff — 2026-07-20 (session 7) — Q12 blocker DISSOLVED, suite 212/212 green

## State: on branch `q12-floor-cutoff`, all changes committed, suite fully green

Main untouched. TEMP Q12 diagnostics from session 6 reverted; q12diag test deleted.

## What happened this session (session-6 handoff steps 1–3, all done)

1. **Undershoot confirmed as fixture artifact.** Synthesized the missing $228/mo plan in the
   diag harness → sim/engine walks agreed exactly, Aug 2026 breach vanished, convergence clean.
   Then found the REAL rows already in the repo:
   `fixtures/forecast-inputs.real.payment-plans-2026-07-16.json` contains
   "payback for my half of downpayment to mom" — $228/mo × 5 from 2026-08-20, checking-sourced —
   exactly matching the golden fixture's `planExpensesByMonth [0,228×5,0…]`. No recapture needed
   to unblock (recapture still worthwhile later, see below).

2. **Capture-path fix (src):**
   - `forecast-engine.ts`: `ForecastInputs.paymentPlans?: PaymentPlan[]` — optional
     pass-through; engine never reads it, it rides along so future fixture captures carry the
     raw rows the SIM side needs.
   - `useForecastEngineInputs.ts`: includes `paymentPlans: paymentPlans ?? []` in engineInputs.
   - So the NEXT fixture recapture (from `window.__convergenceDebug.engineInputs`) will carry
     paymentPlans automatically; harnesses already read `fx.paymentPlans`.

3. **Harness fix (tests):** `fixtures/projection-harness.ts` gained `loadRealPaymentPlans()`
   (loads the 07-16 plans fixture, [] when absent — it's gitignored) and uses it as the last
   fallback: `overrides.paymentPlans ?? fx.paymentPlans ?? loadRealPaymentPlans()`.
   `forecast-convergence.realData.test.ts` (inline harness) uses the same fallback.

4. **Re-pins (verified on a temp main worktree that the shifts come from the plans, NOT Q12 —
   main-with-plans produces identical Jul 2027 / no breaches):**
   - realData: payoff Jun→**Jul 2027** (Jun was the plans-missing artifact), converged, 0 breaches.
   - manualISB clock=0: payoff **Jul 2027**; passes pin 16→**18**.
   - manualISB clock=+11d: payoff **Jul 2027** (passes ≤12 unchanged, still passes).

5. **otherAccountExpense fix (root-caused, not a re-pin):** its 2 "funding-account expense must
   reduce cash" tests asserted on `allPaymentTotals[2]` alone; near payoff a month is
   BALANCE-limited, so paying less in m0–1 leaves more balance and RAISES m2's payment. The
   suite doesn't pin the clock, so the payoff boundary drifts with the real date (passed 07-18,
   failed 07-20 — engine behavior was correct and monotone in CUMULATIVE payments: 5698 < 6242
   through m2). Rewrote both assertions as cumulative-through-m2. Diagnosed via temp test
   (deleted).

## ⚠️ Open concern for the merge decision (raise with Tre)

**Convergence now lands AT the maxPasses=18 budget** on this fixture (realData 18/18, manualISB
clock=0 18/18; main-with-plans took 10). Q12's lower floors slow convergence measurably; zero
margin remains before the non-converged fallback. Options: bump maxPasses (engine change —
worst-case CPU), tune damping, or accept (converged=true is still asserted). Decide BEFORE
merging Q12. The manualISB pass-pin comment documents this.

## Next steps

1. Ask Tre: maxPasses/damping decision (above), then merge `q12-floor-cutoff` → main per
   session-5 plan (c897a231).
2. Optional: Tre recaptures the golden fixture live (it will now include paymentPlans via the
   capture-path fix) — then the harness fallback becomes dormant. Re-pin if numbers move.
3. Optional hardening (discuss first): warn when sim/engine cash walks diverge > $X, or clamp
   Step-5 drain at engine floor semantics for ISB-pinned months (Q4 design: pinned months get
   NaN targets BY DESIGN — see forecast-convergence.ts:61-66).
4. Still queued: Anomaly A (pin clamp UX, UI-only), Anomaly B (route overrideSim through
   runDebtCashConvergence) — session-5 handoff (c897a231).

## Gotchas (carry forward)
- backups/ untracked — never git add (this session's backup: backups/2026-07-20_173308). Repo
  PUBLIC — real fixtures gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`; failures on
  STDERR → Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- pinnedMonths (manualIsbPins) get NaN targets BY DESIGN.
- otherAccountExpense suite runs on the REAL clock by design — its assertions are now
  clock-robust (cumulative), but new assertions there must not depend on which month payoff
  lands in.
- Payoff pins are Jul 2027 everywhere now; if a suite says Jun 2027 it predates the plans fix.
