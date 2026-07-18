# Handoff — 2026-07-18 — main — Q10 IN PROGRESS (partial fix committed, live NOT yet fixed)

## Goals

Q10: engine-layer revolving dust (Prime Visa holds $0.04 from m12 onward, forever) nulls
simRevolvingPayoffMonth / forecastRevolvingPayoffMonth and suppresses the CC Debt Free
milestone (live milestones array is COMPLETELY empty). Root-cause and fix at the engine layer.

## Current State

- CONFIRMED live (Jul 18, localhost:8080/forecast, window.__convergenceDebug):
  Prime Visa monthlyRevolvingBalances = 0.04 from m12 on; both payoff months null;
  forecastResult.milestones = []. Dust mechanism: convergence's whole-dollar
  debtCashTargetByMonth leaves the payoff payment cents short; the dust then self-sustains
  (sub-dollar target rounds to $0 next pass, so nothing ever pays it).
- FIX #1 APPLIED (in working tree, suite-green): credit-card-engine.ts statement-card
  paid-off transition tolerance widened from `revolvingFinalBal <= purchases + 0.01` to
  `< purchases + 1` (matches the engine's existing <$1 dust convention at the finalBal
  clear and cyclingBacklog clear). Regression test
  src/lib/__tests__/credit-card-engine.q10RevolvingDust.test.ts — 3 tests GREEN
  (dust clears, projectedPayoffMonths freezes at 2, >$1 carry NOT written off).
  Full suite 200/200, tsc clean.
- FIX #1 IS NOT ENOUGH LIVE: after HMR + reload (verified served code has the fix),
  Prime Visa STILL shows 0.04 at m12+. The transition is not firing for PV's real path —
  reason not yet diagnosed. PV card: statement pref, installmentBalance 5145.16 @ 510.50/mo
  (done ~m11), purchases ~147.99/mo, m0MinSettled true. Suspects: remainingInstAfterPay >
  0.01 at the dust month, or revolvingFinalBal < 0, or the transition month's endBal path
  differs (balTail m12 = 148.03 = purchases + 0.04).
- FIX #2 REJECTED (tried, reverted): dust-clearing the monthlyRevolvingBalances PUSH
  (report-only, `revolvingBalRaw < 1 → 0`) makes forecast-convergence.promoParity.test.ts
  FAIL — convergence no longer settles. Lesson: never make the REPORT disagree with the
  sim's internal state; the sim↔engine loop loses its fixed point. Any further fix must
  change the sim's real state (retire the card / actually pay the dust), not the report.
- LOCAL REPRO WORKS: src/lib/__tests__/q10-scratch2.test.ts (temp diagnostic, delete when
  Q10 closes) runs the 07-16 live fixture through renderProjectionFromFixture +
  runDebtCashConvergence and reproduces simRevolvingPayoffMonth null. Use it to instrument
  the transition block (console.log the six condition operands for PV at m10-13) with
  `npx vitest run src/lib/__tests__/q10-scratch2.test.ts --disable-console-intercept`.

## Next Steps

1. Instrument the paid-off transition (credit-card-engine.ts ~line 1577) under
   q10-scratch2 and find which condition blocks PV at the dust month.
2. Design a STATE-consistent fix for that path (candidates: let the cascade/mandatory
   statement payment absorb sub-dollar dust — i.e. round the statement payment UP to cover
   a <$1 revolving remainder; or dust-clear `balances` itself when the revolving portion is
   sub-dollar and installment is retired). Re-run: q10RevolvingDust (3), promoParity (Q7),
   realData (Jun 2027 pin), manualISB, goldenTierA, full suite, tsc.
3. Live-verify: payoff months non-null, CC Debt Free milestone fires, ETA sane.
4. Delete q10-scratch2.test.ts, update memory (project_cycling_debt_engine), commit.

## Answered this session (relay to Tre if asked again)

Aug 2026 cash floor miss (~$435): ending cash $3,388 vs floor $3,823. The floor is bills
due Sep 1-7 before the first Sep paycheck (rent 1915, car loan 422.89, car insurance
173.23, Prime Visa min 510.50, Discover min 192.09, groceries 300, utilities 255, life 54).
Aug carries $1,409.79 of MANDATORY card payments: Tre's manual ISB pin on Prime Visa
(1,164.79, honored to keep grace — pins are mandatory by Q4/Q5 design) + Discover 245
(min 192.09 moved to Aug by Q11 + plan extra). Floor protection only pulls back
discretionary extra; even cutting all of it (~$53) still misses by ~$381. It self-heals in
Sep (3,865 vs floor 3,469). Only lever: lower/remove the Aug Prime Visa ISB pin (costs
interest).

## Gotchas (carry forward)

- backups/ is now UNTRACKED (95d93a58) — do NOT git add backups/. This session's backup:
  backups/2026-07-17_141213/src/lib/credit-card-engine.ts (pre-fix original).
- Repo PUBLIC — real-data fixtures stay gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED by Tre (current-month floor) — do not re-propose next-month.
- `window.__simDebug.raw` is PASS-0; SIM side = `__convergenceDebug.convergedProjection`;
  ENGINE rows = `__convergenceDebug.forecastResult` (rows live at `.data[]`).
- Forecast page /forecast, Debt page /debt; dev server localhost:8080; vitest needs
  --disable-console-intercept to show console.logs; vitest failure details go to STDERR
  (PowerShell `2>$null` swallows them — use Bash `2>&1`).
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (currently 2 ≥ 1).
- simulateVariablePayoff positional param #20 is debtCashTargetByMonth (see
  q10RevolvingDust test for a working 21-arg call shape).
