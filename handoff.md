# Handoff — 2026-07-09 — branch debt-model-fixes-p0 — CONVERGENCE FULLY RESTORED; m0 breach + live verify remain

## WHAT HAPPENED THIS SESSION
The residual m30 two-cycle (old handoff item 1) was root-caused and FIXED offline. The
convergence loop now settles in ~5 passes on the real fixture with payoff **Jun 2027** — the
pre-Stage-3 anchor. Verified against a worktree run of `a7653967` (pre-Stage-3) on the same
fixture.

### Root cause of the two-cycle (proven via per-pass trace)
`runDebtCashConvergence` damps the TARGET but threaded Forecast's PASS-2 cap
(`currentProj.maxDebtPaymentByMonth`, added in `89d7b89f`) into `resimulateWithDebtCash`
UNDAMPED. On save-up months where all debt is cycling (m30 = Jan 2029 on the fixture), the
sim's mandatory pool binds to the cap 1:1 (`allPay = cap + target` exactly, every pass) while
the engine's next cap moves opposite to the sim's payment (higher payment ⇒ more cycling
expense in floor protection ⇒ lower cap). Slope ≈ −1 map, self-damped only ~7%/pass
(cap trace: 436.79→532.99→446.63→523.15→452.46→517.32→455.92→513.86), exhausting the 8-pass
budget every time.

### The fix (forecast-convergence.ts)
Damp the cap exactly like the target (same 0.5 weighting, `prevCap` held across passes).
Months where either side is non-finite (uncapped) take the newest raw value — averaging a
finite cap with Infinity would pin the month uncapped forever. Result: 8-pass exhaustion →
converged in 5 (maxGap 368 → 48 → 4 → 2 → 1). 156/156 tests green, tsc clean.

## WHAT STILL FAILS (the test's ONLY remaining red assertion)
One milestone: **"⚠️ Cash below safe minimum" at m0 (Jul 2026)** in the CONVERGED output.
Root-caused this session, NOT yet fixed — it is a cross-model design decision:
- Sim's month-0 cash model: m0Income 4495.56, m0Expenses **54** ⇒ its m0 payment (ledger
  4392.28, all to Discover) is floor-safe in ITS model (ends ≈3085 ≥ 2800).
- Engine's PASS-3 month-0 model: same income/start cash (3036) but ~**563** non-debt outflow
  ⇒ ends 2577 < 2800 floor. m0 is live-anchored (target[0]=NaN) so target feedback can never
  correct it. Note sim's own `month0.safeToPayTotal` is 4241 ≠ its ledger total 4392.
- Pre-Stage-3 hid the disagreement by deriving the payment FROM the engine's own surplus
  (pinning engine cash to the engine floor: m0 paid 4169, cash exactly 2800). Stage 3's
  "single-clamp / trust the ledger" exposed it.
- Months 1+ additionally sit ~constant $1073 below monthMinSafe because PASS-3 Step 3
  (forecast-engine.ts ~:1113) only ADDS surplus to the next-pass target, never subtracts a
  deficit. On this fixture that produces no extra milestone (fires on transition only), but a
  symmetric deficit-reduction there is a candidate fix for months ≥1. It won't fix m0.

## REMAINING WORK (in order)
1. **DISCUSS WITH USER (design decision, don't pick silently)**: which model owns month-0
   truth. Options: (a) reconcile the m0 expense models (why sim says $54 remains in July vs
   engine $563 — likely due-day/syncCutoff filtering differences in month0 vs
   forecastMonthEvents[0]); (b) cap the sim's m0 spend by the engine's m0 affordability
   (violates single-clamp); (c) accept the milestone as the engine model's honest opinion.
   Also decide whether to add the symmetric deficit-reduction at forecast-engine.ts:1113.
   The test's floor-breach assertion (and `.fails`) hinges on this.
2. **Live verification** (browser): dev server localhost:8080/forecast — with convergence
   restored the provider should publish the converged pair on live data; expect payoff
   ≈Feb–Jun 2027 on TODAY's data. User asked for ~2-min interactions to stay logged in.
3. Handoff item 3 from last session (useCardProjection.debtPaymentTotals startRevBal
   classification for PASS-2 cyclingPaymentByMonth) — still open, related to item 1.
4. Stages 4-5 of `.claude/plan/unify-cycling-model.md` stay ON HOLD until 1-2 are done.

## Current State
- Branch `debt-model-fixes-p0`; tree has the cap-damping fix + test TODO update, committed
  this session. Suite: 156 passed + 1 expected fail (breach assertion only). tsc clean.
- Backups: `backups/2026-07-09_013301/` (pre-fix forecast-convergence.ts + realData test).
- NOTE: node_modules was accidentally part-deleted via a worktree junction during the
  pre-Stage-3 bisect this session; restored with `npm install` (package-lock, 0 vulns). If
  anything odd appears, `rm -rf node_modules && npm install`.
- Bisect worktree ../gf-bisect-a765 removed.

## Active Files
- `src/lib/forecast-convergence.ts` — cap damping (prevCap, ~:54-70).
- `src/lib/__tests__/forecast-convergence.realData.test.ts` — harness; `.fails` TODO now
  documents the m0 breach as the only remaining failure.
- `src/lib/forecast-engine.ts` — PASS-3 m0 model (~:1082-1116), Step-3 surplus-only feedback
  (~:1113), m0 rawDebtPayment pinning (~:731-737). Untouched this session.

## Failed Attempts
- None this session (cap damping worked first try; verified by trace before/after).

## Key anchors
- Never push. Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Fixture (gitignored, REAL USER DATA, never commit) payoff anchor: Jun 2027, zero breaches
  pre-Stage-3; converged post-fix output matches payoff, differs only by the m0 breach.
