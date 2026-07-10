# Handoff — 2026-07-09 (session 5) — branch debt-model-fixes-p0 — Feb 2027 breach RESOLVED

## TL;DR
The Feb 2027 floor breach is **FIXED and committed** (`4ae12fc0`). The single root-cause fix (the
sim's payday-count income bug, handoff session-4 "bug #1") closed the P0 on its own — the cap fix
and tax-estimator refactor turned out to be **unnecessary** for the breach. Verified on the real
fixture: converges in 11 passes, payoff **Jun 2027**, **zero floor breaches**.

## What shipped this session (commit 4ae12fc0)
1. `src/hooks/useCardProjection.ts` (~:585): sim income now mirrors the engine exactly —
   `rawIncome = actualMonthPaycheck + e.nonPaycheckIncome` (was: prefer `e.income` when larger,
   which miscounted paydays ±1). This aligns the sim cash walk with the engine's authoritative one,
   so the mandatory cycling pool is sized against real cash and Feb 2027 lands at $2800 (the floor)
   instead of breaching at ~$2320.
2. `src/lib/forecast-convergence.ts` (:34): default `maxPasses` 8 → 12 (fixture needs 11).
3. `src/lib/__tests__/forecast-convergence.realData.test.ts`: removed `.fails` pin (now genuinely
   passes), rewrote the stale m0-breach TODO.

Full suite green: 157 tests / 42 files pass. `tsc --noEmit` clean. Backup at
`backups/2026-07-09_232129/`.

## Diagnostic proof (per-month, post-fix, maxPasses:20 → converged in 11)
Feb 2027 = m7: engine income pay 4408 + bonus 2170 + tax −2410 = net 4168; start 3459, debtPay 1802,
**end 2800 = floor, no breach**. Every month m0..m59 `breach:false`. (Diag test was temp, deleted.)

## OPEN DECISIONS for the user (both now OPTIONAL — P0 is already fixed)
The session-4 handoff had approved two more changes; the payday fix made them non-load-bearing:
- **Step 2 — contained cap fix** (credit-card-engine.ts :1008, bind `paidOffPool` to `mDebtCap`
  even pre-payoff): now a **robustness net only**. NOTE: the diag showed Feb's `mDebtCap` is `inf`
  (uncapped) in breach-shaped months — the engine only emits a finite cap on save-up months. So the
  original cap-fix premise ("bind to Feb's floor-safe mDebtCap ~1182") does **not** hold; mDebtCap
  is not floor-safe in Feb. A real robustness net would need a different cash ceiling, not mDebtCap.
  Defer unless a future fixture reintroduces a breach.
- **Step 3 — sim tax estimator** (shared-function extraction so the sim runs the engine's tax
  estimator): purely a **CC-projection popup display** correctness improvement now, not needed for
  the floor. Bigger refactor + golden Tier-A re-baseline. Only do if the user wants the popup's
  income to match the engine exactly.

## Current State
- Branch `debt-model-fixes-p0`, HEAD `4ae12fc0`. Never push. Supabase user_id
  a72f416e-433a-4055-9ab0-9feae4e60edf. Milestone floor check uses `cashFloor` ($2800).
- Real fixture is gitignored, NEVER commit: `src/lib/__tests__/fixtures/forecast-inputs.real.json`.

## Failed hypotheses (do not revisit)
- The cap fix (step 2) as the P0 fix: unnecessary AND its mDebtCap premise was wrong (Feb mDebtCap
  is inf, not floor-safe).
- m0 breach (old realData TODO): stale, was already fixed in session 2.
