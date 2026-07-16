# Handoff — 2026-07-16 ~00:00 — main

## ACTIVE TASK: Q6 (2028 Prime Visa full-statement underpayment) — FIXED OFFLINE, LIVE VERIFY PENDING

Tre reported: on his live account, Prime Visa misses a full statement-balance payment in 2028.
This is the 07-14 "finding 2 / save-up over-reserve" item reappearing (Feb–Jun 2028-style).

## ROOT CAUSE (diagnosed + reproduced offline on the 2026-07-15 golden fixture)
`computeFloorProtection` (src/lib/floor-protection.ts) cash walks assumed ALL surplus above the
floor flows to revolving debt FOREVER — modeled balance rides the floor for all 84 months. Real
converged cash is $15.7k–$27k after payoff (Jun 2027). From that phantom floor-riding balance,
Apr 2028's $2,738 cycling statement looked like a floor breach → save-up caps ($597/$25/$25) on
Jan–Mar 2028 → credit-card-engine's `allRevolvingClear` branch (line ~1107) applied the cap to
the cycling pool → PV paid $194 of an $831 Mar 2028 statement ($637 backlog, $14.58 interest).
Also m30 (Jan 2029): cap 720 for a $300 "breach" left a PERMANENT ~$35 backlog accruing interest
to end of horizon.

## FIX (committed this session)
New optional `reducibleDebtCapByMonth` param on computeFloorProtection: per-month upper bound =
revolving + cycling-backlog outstanding entering month m (engine can never pay more than owed).
- floor-protection.ts: `natural` (both walks) = min(debtCap(m), old value); `ccMin(m)` also
  min'd with debtCap (post-payoff real minimum is $0).
- forecast-engine.ts PASS-2: builds cap from cardProjectionData.monthlyRevolvingBalances +
  monthlyCyclingBacklog, shifted m−1; m0 = Infinity (live-anchored).
- useCardProjection.ts runLookAhead: same array from the previous outer-pass sim (same
  fixed-point sourcing as ccMinByMonth). Initial pre-loop lookAhead left capless (overwritten).

## VERIFIED OFFLINE
- Diagnostic (deleted q6-diagnostic.test.ts): 2028+2029 statements now ALL paid in full, zero
  backlog, zero cycling interest, no saveUp months post-payoff; caps become non-binding
  ($13.9k/$25.3k). Pre-payoff months byte-identical (Aug 2026 1165, payoff Jun 2027).
- converged=true passes=16 (unchanged). 185/185 tests pass, tsc clean, eslint clean.
- New regression test: forecast-convergence.manualISB.test.ts third case — post-payoff months
  must have cycling backlog ≤ $0.01 and cycling interest ≤ $0.01 on the converged run.

## NEXT STEPS (fresh session)
1. **LIVE VERIFY on http://localhost:8080** — Tre says his logged-in session is on the DEV
   SERVER :8080, NOT production getforgenta.com (prod tab in this session's MCP group had no
   session). Check: PV card projection rows Feb–Jun 2028 pay full statements (no "misses full
   statement balance" row), no new floor breaches, Q5 acceptance intact (PV Jul "—", Aug
   −$1,165), `__convergenceDebug` converged:true no fallback. Dev server may need starting
   (`npm run dev` — vite, port 8080).
2. If live shows a residual miss: live has debtPayoffOptions/overrides the fixture lacks
   (fidelity gap, see projection-harness.ts) — capture `__simDebug`/`__convergenceDebug`.
3. Optional carry-overs from 07-15 handoff still open: CAP-damping raw-stability rule (only if
   passes creep to 18), fold realData test onto projection-harness, remove __convergenceDebug
   eventually, Anomaly A/B design rulings (detail in f4f90234).

## Carry-over guardrails / gotchas
- vitest hides console.logs — use `--disable-console-intercept`.
- ctrl+a+type into month-payment inputs APPENDS — use form_input.
- Repo PUBLIC — never commit real financial data; fixture is gitignored. Supabase user_id
  a72f416e-433a-4055-9ab0-9feae4e60edf. Never push. Backups: backups/2026-07-15_235553/.
