# Handoff — 2026-07-09 — branch debt-model-fixes-p0 — ROOT CAUSE FIXED, residual + live verify remain

## WHAT HAPPENED THIS SESSION (big progress)
The live regression (payoff Jun 2029, repeated floor breaches) was diagnosed and its PRIMARY
root cause fixed OFFLINE, committed as `290e1b66`. No browser was needed.

### Root cause (proven, not hypothesized)
`buildPaymentLedger` (credit-card-engine.ts, Stage 2) classified `revolving` by
start-of-month `monthlyRevolvingBalances > 0`. But a backlog-carrying cycling card keeps that
field at 0 BY DESIGN (one-way display signal), so its Step-5 backlog-cascade payment — funded
by the debt-cash pool that `debtCashTargetByMonth` REPLACES — was reported as `cycling`.
Forecast PASS 3 (Stage 3) feeds `ledgerEntry.revolving` back as the next-pass target, so the
target lost the backlog payment EVERY pass: payments ratcheted down ~$530/pass (observed),
the loop never converged, the provider published the base-pair fallback, and on live data the
system collapsed toward minimums-forever (Jun 2029 payoff + floor breaches).

Neither of the old handoff's two hypotheses was the primary cause:
- Step-2 cycling-pool cap (hypothesis 1): disabling it changed NOTHING (tested offline).
- `89d7b89f` cap threading: already exonerated live last session, reconfirmed irrelevant.

### The fix (committed `290e1b66`)
- `SimResult.monthlyDebtCashPayment` (new map): per-card per-month Step-5 pool spend, recorded
  at payment-application time — `pay` for debtCards (excludes mandatory installment/BNPL
  share), `backlogPay` for cycling cards (excludes Step-2 mandatory statements). Push sites
  mirror `monthlyPayments` exactly (not-started branch, Step 6, Step 6c).
- `buildPaymentLedger.revolving` now sums that map instead of inferring by balance.
- 156/156 pre-existing tests green, tsc clean.

### Bisect evidence (offline harness, real fixture, clock pinned to capturedAt)
- pre-Stage-3 `a7653967`: converged 6 passes, payoff Jun 2027, NO breaches
- Stage 3 `0aa04b85` / old HEAD `4a49115d`: never converges, breach Jul 2026 (base-pair fallback)
- after fix `290e1b66`: death spiral GONE (early months stable) but still unconverged — see below.

## THE NEW OFFLINE HARNESS (this is the big new capability)
`src/lib/__tests__/forecast-convergence.realData.test.ts` — renders the REAL `useCardProjection`
hook from the gitignored fixture's raw Supabase rows (jsdom + renderHook,
`vi.useFakeTimers({toFake:['Date']})` pinned to capturedAt), then runs the REAL
`calculateForecast` through `runDebtCashConvergence` — the exact provider call. Includes a
commented-out-style diag block printing per-pass maxGap/argMonth. The fixture
(`src/lib/__tests__/fixtures/forecast-inputs.real.json`, gitignored, captured 2026-07-03) was
backfilled this session with `inputs.paymentPlans` (4 active plans pulled from the DB — REAL
USER DATA, must never be committed; repo is public).

## REMAINING WORK (in order)
1. **Residual two-cycle**: after the fix the loop still exhausts 8 passes — a weakly-damped
   ±$60 payment two-cycle at ~m30 (`prevPay/curPay` flip 502↔567 while the month's TARGET is
   constant 50, so the target damping cannot collapse it; decay ~7%/pass). Because it doesn't
   converge, the provider still publishes the base pair (breach Jul 2026 milestone on fixture
   data). Diagnose where the sim's mandatory-cycling share at late months alternates between
   passes (suspect: a statement/backlog boundary toggling with tiny early-month target
   diffs). Fix options to evaluate: collapse the payment-side cycle in the sim; or discuss
   tolerance/pass-budget semantics WITH THE USER (don't silently loosen the $1 tolerance).
   The test is marked `it.fails` — it flips red (passes) when this is fixed; remove `.fails`
   and its TODO comment then.
2. **Live verification** (browser): dev server localhost:8080/forecast — confirm milestones
   recover (expect ≈Feb–Jun 2027 payoff on TODAY's data, no repeated breach milestones) once
   convergence is fully restored. User asked for ~2-min interactions to stay logged in.
3. Consider whether `useCardProjection`'s own `debtPaymentTotals` (same startRevBal
   classification) needs the same treatment for PASS-2 `cyclingPaymentByMonth` (currently
   treats backlog paydown as expense in floor model — pre-existing, NOT touched).
4. Stages 4-5 of `.claude/plan/unify-cycling-model.md` stay ON HOLD until 1-2 are done.

## Current State
- Branch `debt-model-fixes-p0` at `290e1b66`; tree clean. Suite: 156 passed + 1 expected-fail.
- Backups: `backups/2026-07-09_003531/` (pre-fix credit-card-engine.ts, payment-ledger.test.ts).
- `payment-ledger.test.ts` still passes UNCHANGED (its synthetic data has no backlog months, so
  both classifications agree there — could add a backlog-month case later).
- graphify update NOT run this session (context gate); run `python -m graphify update .` next.

## Active Files
- `src/lib/credit-card-engine.ts` — SimResult.monthlyDebtCashPayment (~:577), pushes at ~:880,
  ~:1350 (`pay`), ~:1470 (`backlogPay`); buildPaymentLedger (~:608).
- `src/lib/__tests__/forecast-convergence.realData.test.ts` — harness + diag block + `.fails`.
- `src/lib/forecast-engine.ts:1076-1115` — PASS 3 ledger consumption (unchanged this session).
- `src/lib/forecast-convergence.ts` — loop + damping (unchanged).

## Failed Attempts
- Disabling the Step-2 cycling-pool cap (`if (false && allRevolvingClear ...)`) — no effect on
  convergence or milestones; reverted.

## Key anchors
- Never push. Supabase user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- Fixture payoff anchor is Jun 2027 (pre-Stage-3 behavior on 2026-07-03 data), NOT Feb 2027 —
  the memory anchor predates the auto loan + payment plans.
