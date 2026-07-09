# Handoff — 2026-07-09 (session 3) — branch debt-model-fixes-p0 — Feb 2027 breach ROOT-CAUSED (not yet fixed)

## TL;DR
Item A from the last handoff (Feb 2027 floor breach) is now **fully root-caused**. It is NOT
the revolving target and NOT structural. Root cause: **the sim's own internal cash walk
(`projectedCashByMonth`) diverges massively from the engine's authoritative cash walk** — at Feb
2027 the sim thinks it has **$4868** while the engine's cash is **$2839**. The sim sizes its
mandatory **cycling pool** (Amex-Gold-style full-statement payments) against its own inflated
cash, so it pays ~$1204 of mandatory cycling that the engine can't afford, and the engine's cash
walk breaches the $2800 floor (lands at 2320). The revolving-target feedback (the deficit branch
from session 2) CANNOT fix this because the breach is driven by the **cycling pool, which ignores
`debtCashTargetByMonth`** entirely (target only controls the Step-5 revolving cascade).

No code fix landed this session — diagnosis only. Working tree is CLEAN (back at commit 6da00e62).

## THE EVIDENCE (from the deleted diagnostic — see "re-instrument" below)
Final converged run (11 passes, maxPasses bumped to 20 in the diag), per month
`engStart / engEnd / simCash(sim's own projectedCashByMonth) | fLedger total/rev/cyc | simMandatoryCycling`:
```
m5 Dec 2026 engStart 2894 engEnd 2801 simCash 3650 | fTot 1389 rev 872  cyc 517  mand 0
m6 Jan 2027 engStart 2801 engEnd 2839 simCash 3688 | fTot 2381 rev 1460 cyc 921  mand 404
m7 Feb 2027 engStart 2839 engEnd 2320 simCash 4868 | fTot 1662 rev 107  cyc 1555 mand 1204   <-- BREACH
m8 Mar 2027 engStart 2320 engEnd 3203 simCash 6081 | fTot 2867 rev 1812 cyc 1055 mand 704
```
- Payments MATCH between sim and engine every month (engine trusts `ledger.total`); e.g. Feb both = 1662.
- Feb non-debt outflow (engine) = 2839 + 4168(takeHome) − 2320 − 1662 = **3025** =
  base 2254 + carLoanPay 423 + vehIns 173 + transfers 75 + savings 100. Mortgage = 0 (no mortgage
  in this fixture — the session-2 mortgage hypothesis was WRONG).
- **The gap is in the sim's cash walk, not the payment.** Sim cash walk (credit-card-engine.ts:1516):
  `currentCash += monthIncome − monthExpenses − totalDebtPayments`, where for m>0
  `monthIncome/monthExpenses = simulationMonthEvents[m].income/.expenses` (engine-lines 841-846).
  Implied sim (income − expenses) for Feb = simCash[7] − simCash[6] + payment[7]
  = 4868 − 3688 + 1662 = **2842**. Engine's (takeHome − nonDebtOut) = 4168 − 3025 = **1143**.
  **Sim over-accrues ~$1699 at Feb** (and the sim's cash climbs unbounded: 3650→3688→4868→6081…
  while the engine's hugs the floor). So EITHER the sim's `simulationMonthEvents[m].income`
  overstates net take-home, OR `simulationMonthEvents[m].expenses` understates outflows, vs the
  engine — by a large, growing amount.

## NEXT STEP (the one diagnostic that pins income-vs-expense, then the fix)
1. Re-instrument (below) and dump, per month m, all four numbers side by side:
   `simulationMonthEvents[m].income` vs engine row `takeHome`, and
   `simulationMonthEvents[m].expenses` vs engine `nonDebtOut` (= startingCash+takeHome−endingCash−debtPayment).
   This tells you whether the ~$1699/mo divergence is on the INCOME side (sim income too high —
   suspect `rawIncome`/`simIncMult`/gross-vs-net in simulationMonthEvents, useCardProjection.ts
   ~:585-588) or the EXPENSE side (sim expenses too low — simulationMonthEvents.expenses omits an
   engine outflow, useCardProjection.ts:593-595).
2. **Likely fix (confirm first):** reconcile the sim's cash walk with the engine's, same spirit as
   session-2's FIX 1 (`m0ExtraOutflow`) but for the WHOLE walk. The sim's floor decision for the
   mandatory cycling pool (credit-card-engine.ts Step 2, `tentativeAvailAboveFloor`, ~:954) must be
   computed against cash that matches the engine's, or the cycling pool will keep overspending in
   tight 2-paycheck months. If it's an income overstatement, fix the `simulationMonthEvents` income
   formula; if an expense omission, add the missing category to `simulationMonthEvents[m].expenses`.
   Whichever it is, the engine (`cashPreDebt`, forecast-engine.ts:1082) is the source of truth —
   match it.
3. After the fix: the deficit branch (session 2) + damping should let the loop converge with ZERO
   breaches. Re-measure passes (see item B) and bump `maxPasses` default only if still needed.

### Alternative fix if (2) proves too invasive
Cap the mandatory cycling pool by the engine's authoritative floor instead of the sim's own
cash. The convergence loop already threads Forecast's `maxDebtPaymentByMonth` cap into the sim
(param, resim). But that cap only binds the cycling pool when `allRevolvingClear`
(credit-card-engine.ts:1008) — and Feb is pre-payoff (Jun 2027), so it doesn't bind. Making the
cycling-pool floor-reservation robust to the sim/engine cash divergence is the true fix; the
income/expense reconciliation in (2) is the clean root-cause version.

## RE-INSTRUMENT (console.log is SWALLOWED by this vitest config — must writeFileSync)
The diagnostic test + its source hook edit were DELETED/REVERTED this session. To rebuild:
- Temp test `src/lib/__tests__/febdiag.tmp.test.ts`: copy the renderHook block from
  `forecast-convergence.realData.test.ts` verbatim, then
  `const out = runDebtCashConvergence(base, inputs, { engine, maxPasses: 20 })`, and
  `writeFileSync(join(__dirname,'febdiag.out.json'), JSON.stringify(rows))` dumping per month:
  row.startingCash/endingCash/monthMinSafe/takeHome/baseExpenses/debtPayment/revolvingDebtCash/
  mortgagePayment/carLoanPayment/vehicleInsurance/transfersTotal/savingsContrib, plus
  `out.cardProjection.paymentLedger[i]` (total/revolving/cycling — this is the FINAL sim, NOT
  `base.paymentLedger` which is the stale pre-convergence render).
- To expose the sim's own cash walk: in `src/hooks/cardProjectionResim.ts` `buildResimOverrides`
  return, temporarily append (cast to object to dodge the `ResimOverrides` Pick type):
  `...( { _simProjectedCash: simT.projectedCashByMonth, _simMandatory: Array.from({length:PROJECTION_MONTHS},(_,i)=>cards.reduce((s,c)=>s+(simT.monthlyMandatoryCyclingPayment.get(c.id)?.[i]??0),0)) } as object )`
  then read `(out.cardProjection as any)._simProjectedCash` / `._simMandatory`. **REVERT this after.**
  To also see the sim's income/expenses (the NEXT-STEP diagnostic), append
  `simulationMonthEvents` (the closure array in useCardProjection.ts) the same way OR add it to the
  resim overrides — it lives in the hook closure, so easiest is to attach it in
  `resimulateWithDebtCash` (useCardProjection.ts:1702) onto the returned object.

## Still open (unchanged from session 2)
### B. Pass budget: default `maxPasses = 8` (forecast-convergence.ts:34) is too small.
With the deficit correction the loop needs ~11 passes on this fixture. Once A is fixed the
transient may shrink — re-measure, then bump the default (probably to 12) if still needed. The
realData test calls `runDebtCashConvergence` with DEFAULT opts, so it must either get the fixed
default or pass `maxPasses` explicitly.

### The realData test is STILL `.fails` and red.
`src/lib/__tests__/forecast-convergence.realData.test.ts` — `.fails` pin, default maxPasses=8.
Its TODO comment (lines 29-40) is now STALE: it describes the m0 breach as the remaining failure,
but session 2 FIXED m0. The real remaining failure is the Feb 2027 breach (item A) + pass budget.
Once A+B done: fix maxPasses, confirm converged + payoff Jun 2027 + zero breaches, then remove
`.fails` and rewrite/remove the TODO block.

## Current State / anchors
- Branch `debt-model-fixes-p0`. Working tree CLEAN at 6da00e62 (session-2 fixes: m0ExtraOutflow in
  useCardProjection.ts + symmetric deficit branch in forecast-engine.ts, both committed there).
- Fixture (gitignored, REAL USER DATA, NEVER commit): `src/lib/__tests__/fixtures/forecast-inputs.real.json`.
  Target end state: converged, **payoff Jun 2027, zero floor breaches**. Milestone floor check uses
  `cashFloor` ($2800), not `monthMinSafe` (forecast-engine.ts ~:1269).
- Never push. Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.

## Active files
- `src/lib/credit-card-engine.ts` — sim cash walk `:1516`; monthIncome/monthExpenses `:841-846`;
  Step 2 cycling pool / `tentativeAvailAboveFloor` `:954`, `allRevolvingClear` gate `:1008`;
  Step 5 target override `availableCash = max(mDebtTarget, totalMins)` `:1248`.
- `src/hooks/useCardProjection.ts` — `simulationMonthEvents` build `:523-597` (income `:585-588`,
  expenses `:593-595`); `resimulateWithDebtCash` `:1702`; m0ExtraOutflow (session 2) `:770`.
- `src/lib/forecast-engine.ts` — `cashPreDebt` (engine truth walk) `:1082`; deficit branch `:1116`.
- `src/lib/forecast-convergence.ts` — loop; `maxPasses` default `:34`; damping 0.5.
- `src/hooks/cardProjectionResim.ts` — `buildResimOverrides` (where to attach diag fields).

## Failed hypotheses this session
- Mortgage-omission (session-2 guess): WRONG — mortgage is 0 in this fixture.
- Revolving target not reaching the cascade: WRONG — Feb revTarget=0 IS honored (rev share dropped
  to 107); the breach is the cycling pool, which the target does not govern.
