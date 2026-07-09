# Handoff — 2026-07-09 (session 2) — branch debt-model-fixes-p0 — m0 breach FIXED; Feb 2027 breach + pass budget remain

## WHAT HAPPENED THIS SESSION
Two fixes landed (both committed locally this session):

### FIX 1 — m0 breach RESOLVED (useCardProjection.ts) — the handoff item 1 / design decision
Root cause (confirmed via diagnostic): the sim's month-0 cash model omitted every non-debt
outflow the engine's PASS-3 month-0 step (`cashPreDebt`) subtracts — savings/car
contributions, transfers, car loan + vehicle costs, mortgage, and goal lump-sum transfers.
The sim was fed only `m0Expenses` (= forecastMonthEvents[0].expenses ≈ $54) + plan cash, while
`simulationMonthEvents` deliberately short-circuits idx 0 (returns `e` unchanged), so none of
those reached the sim. Result: sim's floor-safe m0 payment (ledger 4392) overshot the engine's
affordable m0 payment (4169) by ~$223, landing engine m0 cash below its $2800 floor.

**User decision (asked & answered this session): reconcile the expense models (option a).**
Implemented `m0ExtraOutflow` in useCardProjection.ts (right after `lumpTransferByMonth`,
~line 703): recomputes month-0 transfers (syncCutoff-scoped, non-cash-source excluded — mirrors
forecast-engine's own m0 monthTransfers loop exactly), savings, car saving, car loan, vehicle
extras, mortgage, lump transfers. Added to the sim's m0 expense at ALL FOUR call sites
(`m0Expenses + m0ExtraOutflow + (planCashExpensesEarly[0] ?? 0)`; the two capped-sim2 /
activeSimM0Expenses sites use `+ m0ExtraOutflow` without plan cash, matching their existing
shape). Verified: engine m0 endingCash now = exactly 2800 (at floor), m0 payment 4169, Jul 2026
"Cash below safe minimum" milestone GONE.

### FIX 2 — symmetric deficit-reduction (forecast-engine.ts ~:1116) — user approved ("Yes, add it")
PASS-3 Step 3 only ever ADDED surplus above monthMinSafe to the next-pass revolving target;
it never subtracted when a month's sim payment drove cash below the floor. Added the mirror
`else if` branch. **CRITICAL: keyed to `cashFloor` (hard $2800 floor, same threshold the
milestone checks), NOT `monthMinSafe`.** First attempt keyed it to `monthMinSafe` and it broke
convergence completely (8 passes, never settled) — on this fixture EVERY month's endingCash sits
below monthMinSafe (augmented floor 3200–3757 vs cash ~2800–2900), so a monthMinSafe-keyed
branch fires everywhere and slashes all payments. cashFloor-keyed leaves the buffer zone
(cashFloor..monthMinSafe) untouched; the surplus branch still spends DOWN to monthMinSafe, the
deficit branch only intervenes once cash falls past the hard floor. With cashFloor keying the
loop converges cleanly (geometric ~0.5/pass decay: 1370→1220→304→154→77→39→19→10→…).

## WHAT STILL FAILS (2 things, both need the next session)

### A. Feb 2027 breach — NOT structural, sim ignores the zeroed target
With the deficit fix + maxPasses bumped to 20 (temporarily, in the deleted diag), the loop
converges in **11 passes**, Dec 2026 breach CLEARS (cash 2801), but **Feb 2027 still breaches
(cash 2320 < 2800)**. Proven NOT structural:
- Feb (m7): start cash 2839 + income 4168 − non-debt expenses 3025 = 3982 available. Contract
  min for Feb revolving = **412**. At the min, cash would be 3570 (safe). Feb is a low-income
  2-paycheck month (takeHome 4168 vs Jan 5344 / Mar 6775), hence the dip.
- BUT the deficit branch already drove Feb `revolvingDebtCash` target to **0**, yet the sim STILL
  paid **1662** (ledgerTotal 1662.08, min only 412). So the sim's revolving cascade is NOT
  honoring the zeroed target down to the minimum — something makes it pay 1662 regardless.
- NEXT STEP: find what pins Feb's payment at 1662 despite target=0. Candidates: (1) the cycling
  mandatory pool (Step 2) — cycling statement payments ignore the revolving target; check
  ledgerEntry.cycling vs .revolving for m7. (2) the maxDebtPaymentByMonth cap for Feb isn't
  binding low enough. (3) `resimulateWithDebtCash`'s target isn't reaching the cascade for that
  month. This is the same area as OLD handoff item 3 (payment classification /
  cyclingPaymentByMonth). Instrument ledger.revolving vs .cycling per month first.

### B. Pass budget: 8 → needs ~11–12
The default `maxPasses = 8` in `runDebtCashConvergence` (forecast-convergence.ts:34) is now
too small — the deficit correction adds a large initial transient (~1370 @ Feb) that takes
~11 passes to decay under tolerance=1. Once Feb (item A) is solved the transient may shrink;
re-measure, then bump maxPasses (probably to 12) if still needed. Do NOT bump blindly before
A is fixed — each pass is an engine+resim on live data.

## Current State
- Branch `debt-model-fixes-p0`. Changes committed this session: useCardProjection.ts
  (m0ExtraOutflow) + forecast-engine.ts (deficit branch). tsc CLEAN (0 errors).
- The realData test (`forecast-convergence.realData.test.ts`) is STILL `.fails` and STILL red:
  it uses default maxPasses=8, so with the deficit change it does not converge in 8 → falls back
  to baseProj → base run shows the Dec 2026 breach. Once A+B are done: raise maxPasses if the
  test harness needs it (the test calls runDebtCashConvergence with default opts — may need to
  pass maxPasses, OR just fix the default), confirm converged + zero breaches + payoff Jun 2027,
  then remove `.fails` and the TODO(convergence-residual) block (lines 29-40).
- Backups: `backups/2026-07-09_080218/` (pre-change useCardProjection.ts, forecast-engine.ts,
  realData test).
- Temp diagnostic `src/lib/__tests__/m0diag.tmp.test.ts` + `m0diag.out.json` were DELETED. To
  re-instrument: render useCardProjection from the fixture (copy the realData test's renderHook
  block), run runDebtCashConvergence with `{ engine, maxPasses: 20 }`, and writeFileSync a JSON
  dump (console.log is SWALLOWED by this vitest config — must write to a file). Dump per-month
  endingCash/monthMinSafe/debtPayment and ledger.revolving-vs-cycling + perCardMinPayments.

## Active Files
- `src/hooks/useCardProjection.ts` — m0ExtraOutflow block (~:703, after lumpTransferByMonth) +
  4 call sites threading it into the sim's m0 expense.
- `src/lib/forecast-engine.ts` — deficit-reduction else-if (~:1116, keyed to cashFloor).
- `src/lib/forecast-convergence.ts` — maxPasses default (:34), damping 0.5 (working).
- `src/lib/__tests__/forecast-convergence.realData.test.ts` — the `.fails` harness / pin.

## Failed Attempts
- Deficit branch keyed to `monthMinSafe` (not cashFloor): fires every month on this fixture,
  slashes all payments, convergence never settles. REVERTED to cashFloor keying.

## Key anchors
- Never push. Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Fixture (gitignored, REAL USER DATA, never commit) anchor: payoff Jun 2027, zero breaches
  pre-Stage-3 (a7653967). Target end state: converged, payoff Jun 2027, zero floor breaches.
- Milestone floor check uses `cashFloor` ($2800), NOT `monthMinSafe` (forecast-engine.ts ~:1269).
