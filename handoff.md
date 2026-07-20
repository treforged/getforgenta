# Handoff — 2026-07-20 (session 11) — Anomaly B CLOSED (live-verified end to end)

## Anomaly B: FULLY RESOLVED
Live verify completed this session on localhost:8080 /debt (Tre's dev session):
- Pin PV Aug 2026 → $100: clamp note rendered, payment -$511 "edited", Aug end $6,453,
  Sep -$1,215 → $5,428, "overrides" badge + Revert All appeared, PV interest $56→$103.
- UNPINNED Discover confirmed on converged basis: Aug -$303 → -$800 (exactly the $497 the
  clamped pin freed: $1,008−$511), Sep end $8,893→$8,387, all rows reconcile
  (start = prior end), Jul untouched, header interest $1,487→$1,465.
- Revert All restored the pre-pin view exactly on BOTH cards; badge/button gone.
Memory updated (project_cycling_debt_engine.md + MEMORY.md index). No source changes this session.

UI note discovered: card panels are an accordion (expanding one collapses the other); the
override/pin state persists across collapse. Pin is useState — page reload clears it.

## NEXT — triage new backlog from Tre (2026-07-20, not started)
- Supabase deprecation: GOTRUE_JWT_DEFAULT_GROUP_NAME not supported by GoTrue, removal soon —
  find where it's set (Supabase project auth config/env) and remove/migrate.
- Google Play (release 5.44) recommendations, Android 15 edge-to-edge: deprecated
  Window.setStatusBarColor / setNavigationBarColor (from minified "n1.c.a" — likely a Capacitor
  plugin, e.g. @capacitor/status-bar — check plugin versions before touching code); plus R8:
  optimization off, 25% obfuscation/shrink rates, AGP upgrade to 9.0+ suggested. Advisory, not
  blocking; builds are CI-owned (see reference_cicd.md).

## State: on `main`, clean except backups/ (untracked, never commit). Local commits NOT pushed
(`64a1182b` Anomaly A, `6459f258` Anomaly B, plus handoff/docs commits) — push only when Tre asks.

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
