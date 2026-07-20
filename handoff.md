# Handoff — 2026-07-20 (session 8) — Q12 MERGED to main, suite 212/212 green

## State: on branch `main`, all committed, main is 5 commits ahead of origin (NOT pushed)

Q12 (pre-paycheck cutoff in loan/insurance/CC floor loops) is complete and merged:
- Merge commit `a08eb34b` (branch `q12-floor-cutoff` kept, can be deleted when Tre confirms).
- Tre decided the convergence-margin question: **bump maxPasses 18→24** (`8cf8fe6c`,
  forecast-convergence.ts:48 default). Observed pass counts unchanged (fixture still takes 18);
  the manualISB pin guards the observed 18, not the budget.
- Suite re-run green on main after merge: 212/212.

## Next steps

1. Tre pushes main when ready (never auto-push). Branch `q12-floor-cutoff` deletable after.
2. Optional: Tre recaptures the golden fixture live (capture path now carries paymentPlans) —
   then the harness `loadRealPaymentPlans()` fallback goes dormant. Re-pin if numbers move.
3. Optional hardening (discuss first): warn when sim/engine cash walks diverge > $X, or clamp
   Step-5 drain at engine floor semantics for ISB-pinned months (Q4 design: pinned months get
   NaN targets BY DESIGN — see forecast-convergence.ts:61-66).
4. Still queued: Anomaly A (pin clamp UX, UI-only), Anomaly B (route overrideSim through
   runDebtCashConvergence) — session-5 handoff (c897a231).

## Gotchas (carry forward)
- backups/ untracked — never git add (latest: backups/2026-07-20_175141). Repo PUBLIC — real
  fixtures gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`; failures on
  STDERR → Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- pinnedMonths (manualIsbPins) get NaN targets BY DESIGN.
- otherAccountExpense suite runs on the REAL clock by design — assertions are clock-robust
  (cumulative); new assertions there must not depend on which month payoff lands in.
- Payoff pins are Jul 2027 everywhere now; if a suite says Jun 2027 it predates the plans fix.
