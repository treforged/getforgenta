# Handoff — 2026-07-11 (session 4) — branch main — Discover 2yr-payoff: REPRODUCED HEADLESS, floor-protection hypothesis DISPROVEN

## STATUS — major pivot
Built the headless harness. **Bug reproduced with live data**: CC Debt Free **Feb 2029 (~m31)**, cash
balloons to **$38k** by m39. The prior sessions' whole premise — that `computeFloorProtection`
back-propagates a giant phantom `reserveNeeded` that caps Discover payments — is **DISPROVEN by the
dump**. The real throttle is the **`revolvingDebtCash` target collapsing to ~$218/mo (near CC
minimums)** while surplus cash piles up unbounded. Root cause is NOT in floor-protection. NO fix applied.

## THE TASK (unchanged)
Discover CC pays off ~2.5yr out on Debt Payoff + Forecast while cash balloons; payments stuck near CC
minimums across 2027–2028 instead of scaling up to kill Discover. Cash floor $2,800. HEAD live = cc6d7cbc.

## WHAT I BUILT THIS SESSION
1. **Headless harness (TEMP — DELETE before shipping, never commit to src/):**
   `src/lib/__tests__/discdiag.tmp.test.ts` (@vitest-environment jsdom). It:
   - `vi.mock('@/hooks/useSupabaseData')` returning the live rows from scratchpad/livedata.json.
   - Pins Date to 2026-07-11, builds config exactly like CardProjectionContext (buildPayConfig,
     cashFloor 2800, funding acct 933cbc10…, assumptions = DEFAULT ∪ profile.forecast_assumptions,
     avalanche, syncCutoff 2026-07-11), renders `useCardProjection` → base, renders
     `useForecastEngineInputs` → engineInputs, clears `globalThis.__floorDumps`, runs
     `runDebtCashConvergence(base, engineInputs, {engine: calculateForecast})`, writes everything
     (dumps + milestones + per-month engineRows) to scratchpad/floordump.json.
   - Run it: `npx vitest run src/lib/__tests__/discdiag.tmp.test.ts` (passes in ~1.3s).
   - It is UNTRACKED (not committed). floordump.json has an emoji → read with
     `PYTHONIOENCODING=ascii:backslashreplace python -c "...io.open(...,encoding='utf-8')..."`.
2. **Consolidated live data** (fresh re-pull via Supabase MCP, today's balances 2026-07-11 13:00):
   `<MY-SCRATCHPAD>/livedata.json` = {accounts(12), transactions(20), debts(2), savings_goals(4),
   car_funds(1 w/24 lumps), budget_items(1), payment_plans(4), recurring_rules(30), profile}.
   MY-SCRATCHPAD = `C:\Users\tvonh\AppData\Local\Temp\claude\C--Users-tvonh-Desktop-getforgenta\0ef571e5-5c67-40d2-8bb5-4d1f2c64ba94\scratchpad`
   (the harness hardcodes this absolute path — update DATA/OUT consts if scratchpad changes).
   NOTE: prior session's txns-rules.json had truncated txn IDs + a placeholder for recurring_rules;
   I re-pulled everything fresh, so livedata.json is authoritative. Repo is PUBLIC — never commit scratchpad.
3. floor-protection.ts still has the TEMP dump instrumentation (L198-217, before the return). It is
   currently COMMITTED (in cc6d7cbc/c7ecd7fc working tree). **Revert it before shipping any fix.**
   Clean backup: backups/2026-07-11_090803/src/lib/floor-protection.ts.

## THE DUMP — hard evidence (last convergence pass, 13 dumps total)
floor-protection arrays are HEALTHY, NOT the cause:
- `reserveNeeded` ≈ 0 for almost every month (only small blips: 136@m19, 1778@m21, 441@m31). NOT $15k.
- `maxDebtPaymentByMonth` = None (UNCAPPED) for ~57 of 60 months. Cap fires only at m18/m20/m30
  (strictSaveUpMonths = [18,20,30,42,54]) with values 606/390/552 — trivial, not a 20-month throttle.
- `netAtMin` positive $700–$3000/mo nearly everywhere → big surplus exists at minimum payments.

The REAL smoking gun is the engine's per-month output (engineRows in floordump.json):
```
m   debtPayment  revolvingDebtCash  endingCash
0     1490        1490        2800
9     2387        2874        4864
11    1646        4511        6842   <- target peaks then collapses
13     731        2708       10855
18     731         218       16621   <- target ~= minimums, cash ballooning
20    1349         218       18065
30     924         411       26441
39     568           0       38502   <- $38k cash, paying ~minimums
```
`revolvingDebtCash` (the per-month debt-cash TARGET the convergence feeds the engine) DECAYS from
~4500 (m11) to ~218 (m18+) even as endingCash climbs 2800→38500. The engine hoards cash instead of
routing the netAtMin surplus into Discover. That collapsing target — not any cap — is why payoff is
Feb 2029. Convergence also does NOT settle (converged:false, passes:12 = the cap), and a spurious
'Feb 2027 cash below safe minimum' milestone appears (a non-convergence artifact).

## NEXT STEP — find why revolvingDebtCash collapses
The target is produced by the sim, consumed by the loop:
- forecast-convergence.ts:48 `raw = currentProj.data.map((row,m) => m===0?NaN:row.revolvingDebtCash)`
  then damped vs prevTarget (damping) → `base.resimulateWithDebtCash(target)` → engine again.
- So trace `revolvingDebtCash` as an ENGINE OUTPUT field in src/lib/forecast-engine.ts (grep hits
  there + credit-card-engine.ts + debt-model-types.ts). Figure out what the engine sets
  revolvingDebtCash to each month and why it shrinks toward minimums while cash grows. Prime suspects:
  (a) engine caps the routable debt cash by something OTHER than floor (e.g. only routes a fraction of
  surplus, or ties routing to a stale/earlier target), or (b) resimulateWithDebtCash in
  useCardProjection under-computes the safe-to-pay revolving cash when a big cash buffer already
  exists (i.e. it stops "trying" once cash is comfortably above floor). Existing test
  src/lib/__tests__/forecast-engine.revolvingDebtCash.test.ts documents the intended semantics — read it first.
- Also worth checking: does non-convergence (oscillation) itself pin the published run to a low-payment
  pass? Inspect the 13 dumps' maxDebtPaymentByMonth/reserveNeeded across passes (they're all in
  floordump.json floorDumps[]) to see if the target is oscillating vs monotonically collapsing.
- Compare against the GOOD fixture behavior (payoff Jun 2027) in
  src/lib/__tests__/forecast-convergence.realData.test.ts — that fixture is stale/gitignored but its
  expected anchors show what "correct" looks like.

## FIX DISCIPLINE (when root cause proven)
- Back up any edited file to ./backups/YYYY-MM-DD_HHMMSS/ first. Revert the floor-protection.ts TEMP
  dump (L198-217). DELETE src/lib/__tests__/discdiag.tmp.test.ts. Keep full suite green (43 files/163
  tests) + tsc clean. Preserve legit save-up-before-real-breach behavior. Do NOT push.

## Key anchors
- src/lib/forecast-convergence.ts:44-55 damped target loop (revolvingDebtCash → resimulateWithDebtCash).
- src/lib/forecast-engine.ts — where revolvingDebtCash is WRITTEN (the throttle lives here or in the sim).
- src/hooks/useCardProjection.ts resimulateWithDebtCash closure — the sim's debt-cash computation.
- src/lib/__tests__/forecast-engine.revolvingDebtCash.test.ts — intended semantics.
- src/lib/floor-protection.ts:76-219 computeFloorProtection (+ TEMP dump L198-217) — RULED OUT as cause.
- Harness: src/lib/__tests__/discdiag.tmp.test.ts (TEMP). Data: MY-SCRATCHPAD/livedata.json.

## Rules
- Never push without explicit ask. Repo is PUBLIC — scratchpad has real financial data, never commit it.
- discdiag.tmp.test.ts must be deleted before finishing. No dev server running this session.
