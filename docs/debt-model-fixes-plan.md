# Debt/Forecast CC Payoff — Fix Plan (Fable 5 review, 2026-07-02)

> Follows Stage 2 (forecast-engine.ts extraction). Branch off `forecast-engine-stage2`.
> Most delicate financial code; prior fixes here were reverted. Surgical, tested, backed-up.

## Correctness spec (user-confirmed)
- **full** pref (Discover): goal $0; pay full balance every due date, **bounded by cash floor**;
  **Discover IS accruing 19.49%** (user confirmed) → interest-bearing, gets avalanche surplus first.
- **statement** pref (Prime): pay statement down to the cash floor each month; interest-free.
- **0% installment** (Prime's Amazon+ExtremeOnlineStore upfront plans, $516.83/mo): fixed
  amortization to $0, **no surplus acceleration**, 0% interest.
- **No interest** on statement/installment/paid-in-full cards. Interest only on genuinely carried
  interest-bearing balances (currently just Discover).
- **CC Debt Free** = ALL card balances $0. **Debt Free (all)** = every liability $0 (cards +
  vehicle + mortgage + other), each on its own schedule; show BOTH milestones.

## Core defect
Debt leaves the model via **classification events**, not payments. One debt (full balance), three
payment channels (0% amortization, floor-gated statement/full paydown, avalanche surplus); none may
remove debt without a real payment.

## Fixes (ordered)
- **A (P0) — stop wiping installment remainder** — `credit-card-engine.ts:1166-1186`: replace
  `balances.set(id, 0)` with `remainingInst = max(0, startInstBal − upfrontInstPay)`; keep paying
  the $516.83/mo installment for "paid-off" cards until `installmentBals===0` (widen Step 2.5
  ~931-961 + a Step-6-style reduction). Prime then amortizes $4,575.94→0 by ~Jun 2027; revolving
  stays 0 (never surplus-eligible). Cash regains ~$516/mo outflow.
- **B (P0) — remove phantom Discover carve-out** — `useCardProjection.ts:1633-1647`: skip the
  due-day-≤-syncCutoff zeroing when the card's live balance > 0 (only settled/paid cards should
  zero). Discover m0 rec → floor-bounded ~$4.7k, matching the sim; $4,581 residue gone.
- **C (P0, REVISED) — honest Monthly Interest** — Discover DOES accrue 19.49%, so do NOT extend
  grace to 'full' (drop reviewer's C.1). Only fix display: `components/debt/CreditCardEngine.tsx:879`
  stop dropping `trueInterest` when `adjRevBals` present (pass engine `monthlyInterest`); clamp the
  back-solve `credit-card-engine.ts:405-408` to `>= 0`. Result: tile shows ~$143 (real), never the
  −$4,581 phantom.
- **D (P1) — CC Debt Free target = all balances** — `forecast-engine.ts:1005-1010,1136-1140` sum
  `monthlyBalances` minus installment remainder (Discover's full $8,803 enters surplus pool);
  milestone (1283-1287) requires total card debt (incl. installment) = 0 → ~Jun 2027. Update golden
  anchor `forecast-engine.goldenTierA.test.ts:52` in the same commit.
- **E (P1) — chart terminal artifact + balloon** — `credit-card-engine.ts:1188-1195` remove the
  `owedArr[last]=startBal` write; make Debt Payoff chart read `monthlyBalances` not row `endBalance`
  for cycling rows (`CreditCardEngine.tsx:906-913`). Re-verify balloon collapses after A-D.
- **F (P2) — unify** (Stage 3): wire Debt Payoff to `calculateForecast`; retire hook PASS-3
  (`useCardProjection.ts:1161-1241,1249-1377`). AFTER A-E.
- **G (P2) — Debt Free (all) milestone** — `forecast-engine.ts` `totalLiabilityBal` (1059/1175)
  fires when ≤0; if beyond 60-mo window (mortgage) show amortization-projected date.

## Intended output changes (all spec-driven, approved)
CC Debt Free Feb→~Jun 2027; Monthly Interest −$4,581→~$143; Prime shows declining ~$4.6k not $0;
Discover m0 rec $0→~$4.7k floor-bounded; Debt Payoff ETA 59-60mo→~12mo; balloon gone.

## Open items still to confirm with user
- Surplus ordering among interest-bearing balances: nominal-APR avalanche (Prime 27.49 is 0%
  installment so effectively Discover 19.49 is top) — assume APR order.
- Debt Free (all) beyond 60-mo horizon: show projected amortization date (assume yes).
