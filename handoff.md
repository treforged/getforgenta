# Handoff — 2026-07-09 (session 4) — branch debt-model-fixes-p0 — Feb 2027 breach FULLY ROOT-CAUSED + verdict + approved plan

## TL;DR
The Feb 2027 floor breach is now **definitively root-caused with ground-truth validation** (not a
hypothesis). The sim's internal cash walk over-accretes income vs the engine's authoritative walk.
**The engine is physically CORRECT every month; the sim is WRONG. The breach is REAL** (the user
genuinely owes ~$2410 in taxes in Feb 2027 that the sim ignores).

**No source code changed this session** — investigation only. Working tree has ONLY an uncommitted
`backups/2026-07-09_171100/` folder (pre-change backups of the 4 files below). Instrumentation was
added then fully reverted (`git checkout`). Tree is otherwise clean at 439b10b7.

## THE VERDICT (ground-truth validated — this is settled, do not re-investigate)
Fixture is **weekly** pay, Fridays (`paycheckDay:5`), net **$848.89/payday**, weeklyGross 1093,
taxRate 0. Real Friday counts Jul26..Jun27: **5,4,4,5,4,4,5,4,4,5,4,4**. m0=Jul 2026, m7=Feb 2027.

Engine income breakdown (from `data[m].{paycheckIncome,otherIncome,bonusIncome,taxReturnIncome}`):
```
       take  pay  other bonus  tax   (m)
Feb27  4168  4408   0   +2170  -2410  (m7)  <-- tax is NEGATIVE = taxes OWED (estimator, override=0)
```
- **Engine matches real Fridays EXACTLY every month** (getMonthNetIncome → getPaychecksInMonth,
  weekly path counts real paydays). Engine correctly nets the +$2170 recurring Feb bonus against a
  **−$2410 Feb tax bill** → Feb net $4168. Engine cash walk is authoritative + correct.
- **Sim is wrong in 3+ ways** (useCardProjection.ts simulationMonthEvents, ~:523-597):
  1. **Payday miscount ±1**: sim prefers scheduled-events income `e.income` (:585) which placed
     5 Fridays in Aug (real 4) and 4 in Apr (real 5). Engine uses getMonthNetIncome (correct).
  2. **Omits the tax-return ESTIMATOR entirely** (:552-554 only honors `taxReturnAmountOverride`,
     which is 0 → sim adds $0; never runs the estimator). Misses the −$2410 Feb tax bill. **This is
     ~the entire $1699 Feb gap.**
  3. Bonus computed as % of annual NET (sim) vs % of annual GROSS (engine); sim scales nonPaycheck
     income by simIncMult, engine does not. (Minor, pre-existing.)
- Mechanism of the breach: sim thinks Feb cash = $4868 (engine: $2839), sizes its **mandatory
  cycling pool** (credit-card-engine Step 2) against phantom cash → pays $1204 cycling the engine
  can't afford → engine's authoritative walk lands at 2320, breaching the $2800 floor.

## USER DECISIONS THIS SESSION (both approved — implement both)
1. **Contained fix = YES, implement**: bind the sim's mandatory cycling pool to the engine's
   authoritative cash ceiling even pre-payoff (today the `mDebtCap` cap only binds when
   `allRevolvingClear`, credit-card-engine.ts:1008 — Feb is pre-payoff Jun 2027 so it escapes).
2. **Sim income bugs = FIX THIS SESSION TOO** (payday miscount + tax estimator).

## ⚠️ SCOPE COMPLICATION discovered (surface to user before the big refactor)
Making the sim's income EXACTLY match the engine is **not two patches — it's a shared-function
extraction**. The two income models diverge in 4+ ways (paycheck source, nonPaycheck-multiplier,
bonus gross-vs-net, tax estimator) AND **the sim's `assumptions` type (useCardProjection.ts:46-60)
lacks the tax-estimator inputs** (`taxReturnFilingStatus/State/Dependents/FederalWithheld`) — they'd
have to be threaded through `UseCardProjectionParams` + all callers (Forecast.tsx,
CardProjectionContext.tsx). The DRY/root-cause-correct fix: extract the engine's per-month income
block (forecast-engine.ts :606-694: promotion snap, raise, adjustedConfig, fallbackTakeHome=
getMonthNetIncome, bonus, tax estimate) into a pure exported helper both call → then re-baseline the
golden Tier-A test (engine output WILL change → expected). Engine-touching, higher risk.

## RECOMMENDED IMPLEMENTATION ORDER (next agent)
Note the interaction: **the cap fix alone closes the P0 breach** and is self-contained; the income
fixes are correctness improvements (also fix the CC-projection popup display). Suggested order:

1. **Sim bug #1 (payday count)** — CLEAN, low-risk, no new plumbing. useCardProjection.ts:585:
   change `const rawIncome = e.income > e.nonPaycheckIncome ? e.income : actualMonthPaycheck + e.nonPaycheckIncome;`
   to always `actualMonthPaycheck + e.nonPaycheckIncome` (matches engine's fallbackTakeHome+otherIncome).
   Verify no golden Tier-A regression; re-baseline if the sim's income shifts change the ledger.
2. **Contained cap fix** — credit-card-engine.ts ~:1002-1016. Make `paidOffPool` bind to the
   engine floor-safe budget EVEN when revolving debt remains (drop/relax the `allRevolvingClear`
   gate at :1008). Cap cycling at `max(cyclingMinTotal, mDebtCap − effectiveReservedForRevolving)`
   so cycling+revolvingMins ≤ mDebtCap (the engine's floor-safe total). `mDebtCap` = damped
   `maxDebtPaymentByMonth[m]` (forecast-convergence.ts:63-68). **VERIFY Feb's mDebtCap is actually
   floor-safe (~1182) before trusting it** — I was mid-check on how the engine computes
   maxDebtPaymentByMonth (forecast-engine.ts:954 `computeFloorProtection`, used at :972) when the
   context gate hit. If mDebtCap isn't tight enough in breach months, the deficit branch
   (forecast-engine.ts:1116, session-2) governs revolving but NOT cycling — the cap must.
3. **Sim bug #2 (tax estimator)** — the shared-function refactor above. **Re-confirm scope with the
   user first** (it's a refactor + golden re-baseline, bigger than they likely pictured). After
   #1+#2 the sim cash walk should match the engine and the cap fix becomes a robustness net.
4. **Verify + unpin**: realData test must converge, payoff **Jun 2027**, **zero floor breaches**.
   Then fix `maxPasses` default (item B below), remove `.fails`, rewrite the stale TODO (:29-40 —
   it still describes the m0 breach which session-2 already fixed).

## Verification harness (reusable — the diagnostic pattern that pinned all this)
Temp test `src/lib/__tests__/febdiag.tmp.test.ts` (DELETED — rebuild from the realData test's
renderHook block). console.log is SWALLOWED by this vitest config → `writeFileSync` a JSON.
- Engine breakdown needs NO source edits: `out.projections.data[m]` already exposes
  `paycheckIncome/otherIncome/bonusIncome/taxReturnIncome/startingCash/endingCash/debtPayment/monthMinSafe/isRaiseMonth/promotionNewSalary`.
- Sim internal walk needs a temp edit in useCardProjection.ts `resimulateWithDebtCash` return
  (:1729-1732): append (cast to object) `_simProjectedCash: simT.projectedCashByMonth`,
  `_simMandatory` (sum simT.monthlyMandatoryCyclingPayment per month), `_simEvents`
  (simulationMonthEvents income/expenses). **REVERT after** (I did).
- Run: `npx vitest run src/lib/__tests__/febdiag.tmp.test.ts` then read the JSON. Real fixture,
  gitignored, NEVER commit: `src/lib/__tests__/fixtures/forecast-inputs.real.json`. capturedAt
  2026-07-03; pin Date via fake timers (realData test shows the exact setup).

## Active files (line anchors)
- `src/hooks/useCardProjection.ts` — sim income :523-597 (payday :585, tax :552-554, bonus :544-550,
  income return :588); assumptions type :46-60; `resimulateWithDebtCash` :1702-1733.
- `src/lib/credit-card-engine.ts` — cycling pool Step 2 :948-1016; `tentativeAvailAboveFloor` :954;
  `allRevolvingClear` gate :1008; `mDebtCap` :939; monthIncome/monthExpenses :841-846; sim cash
  walk :1516.
- `src/lib/forecast-engine.ts` — income block :606-694 (promotion :616-622, raise :624-632,
  adjustedConfig :634, fallbackTakeHome :638, bonus :640-649, tax estimator :669-693); netIncome
  m>0 :663-667; `cashPreDebt` (engine truth) :1082; deficit branch :1116; maxDebtPaymentByMonth
  :954/:972; row income fields exposed :1342-1345.
- `src/lib/forecast-convergence.ts` — loop; maxPasses default :34; cap damping :63-68.
- `src/lib/pay-schedule.ts` — getPaychecksInMonth :75 (weekly path :103-112), getMonthNetIncome :139.

## Still open (unchanged from session 3)
### B. Pass budget: default `maxPasses = 8` (forecast-convergence.ts:34) too small.
This fixture needs ~11 passes (diag ran with maxPasses:20). After the fix, re-measure; bump default
(~12) if still needed. realData test calls with DEFAULT opts → must get the fixed default.

### The realData test is STILL `.fails` and red.
`src/lib/__tests__/forecast-convergence.realData.test.ts` — `.fails` pin, default maxPasses. TODO
(:29-40) is STALE (describes the already-fixed m0 breach). Target: converged, payoff Jun 2027, zero
breaches; then remove `.fails` + rewrite TODO.

## Current State / anchors
- Branch `debt-model-fixes-p0`. Tree clean at 439b10b7 except uncommitted `backups/2026-07-09_171100/`.
- Milestone floor check uses `cashFloor` ($2800), NOT `monthMinSafe` (forecast-engine.ts ~:1244/1284).
- Never push. Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.

## Failed hypotheses (do not revisit)
- Session-2 mortgage-omission: WRONG (no mortgage in fixture).
- Session-3 "expense-side or income-side unknown": RESOLVED — income-side, expenseGap≈0 every month.
- "Paycheck-timing redistribution nets to zero": WRONG — sim over-accrues ~$2910/yr net; the Feb
  spike is the OMITTED TAX BILL (−$2410), not paycheck timing (Feb paycheck counts actually agree).
