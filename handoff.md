# Handoff — 2026-07-08 ~17:05 — branch debt-model-fixes-p0 — save-up source-of-truth RESOLVED

## Goals
1. Execute `.claude/plan/unify-cycling-model.md` (6 stages). Stage 3 shipped 2026-07-08 AM
   (commit `0aa04b85`). **Stage 3's follow-up scope gap now closed** (commit `89d7b89f`, this
   session). Stages 4-5 remain.
2. Cash-floor look-ahead protection — still "for later," not started, not scoped.

## What was resolved this session
User flagged that Stage 3's fix used the wrong "source of truth" for the sim's Step 2
cycling-pool cap. Diagnosis (confirmed with user via AskUserQuestion before coding):

- `computeFloorProtection` (`src/lib/floor-protection.ts`) is already ONE shared algorithm —
  Forecast's PASS 2 (`forecast-engine.ts:949`) and the hook's `runLookAhead`
  (`useCardProjection.ts:742`) both call it, deliberately with separate input arrays (a prior
  full-merge attempt caused a real bug — see `forecast-engine.ts:936-944` comment — so that
  architecture stays as-is).
- Both Debt Payoff and Forecast tabs already consume the SAME post-convergence
  `cardProjection` object from `CardProjectionContext.tsx` (`convergence.cardProjection`).
- The real gap: `runDebtCashConvergence` (`forecast-convergence.ts`) feeds Forecast's PASS-2
  capped `revolvingDebtCash` back into the sim via `debtCashTargetByMonth`, which per its own
  JSDoc only affects Step 5 (revolving cascade) — "the cycling mandatory pool (Step 2) ...
  unaffected." Stage 3 added a NEW cap to Step 2, but wired it to the hook's own independent
  `maxDebtPaymentByMonth`, not Forecast's. So during convergence, Step 5 followed Forecast's
  decision but Step 2 (cycling-only save-up months — exactly Stage 3's use case) didn't.

## Fix implemented (commit `89d7b89f`)
- `ForecastResult` (`forecast-engine.ts`) now exposes `maxDebtPaymentByMonth` (PASS 2's cap).
- `resimulateWithDebtCash(target, forecastMaxDebtPaymentByMonth?)` (`useCardProjection.ts`,
  `debt-model-types.ts`) accepts an optional second param; when provided it REPLACES the sim's
  own cap for Step 2 (`simulateVariablePayoff`'s `maxDebtPaymentByMonth` param), falls back to
  the hook's own `activeSimMaxDebt` when omitted (legacy behavior preserved for callers that
  don't pass it).
- `runDebtCashConvergence` (`forecast-convergence.ts`) now calls
  `base.resimulateWithDebtCash(target, currentProj.maxDebtPaymentByMonth)`.
- Test mocks in `forecast-convergence.test.ts` updated with `maxDebtPaymentByMonth: []` where
  `ForecastResult` is explicitly typed.

**Verified:** `tsc --noEmit` clean, 156/156 tests pass (full suite). Not yet manually verified
live in the browser (dev server) — no specific user-reported repro scenario was available to
click through; the fix is scoped to convergence-pass wiring, covered by existing
`resimulateWithDebtCash`/`forecast-convergence` test suites which all pass.

## Active Files (for Stage 4 next)
- `.claude/plan/unify-cycling-model.md` — Stage 4 (convergence + goldens review) is next.
  Stage 4's golden-fixture re-verification should now be re-run against this session's fix
  too, not just Stage 3's.
- Backups of the 5 touched files: `backups/2026-07-08_170134/`.

## Next Steps
1. Resume `.claude/plan/unify-cycling-model.md` Stage 4 (convergence + goldens review).
2. Stage 5 (live verify + cleanup) after Stage 4.
3. Consider a live browser check (`/debt` and `/forecast`, cycling-only-debt scenario, a
   save-up month) since this session's fix was verified by tests only, not manually.

## Key anchors (unchanged from prior handoffs)
- Dev server localhost:8080 — restart if not running (`npm run dev`, background). Route `/debt`
  (accordion = expand card → Monthly Projection table), `/forecast` (popup = tap Monthly
  Breakdown row).
- Never push. Backups before high-risk edits. Supabase user_id
  `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- Popup ≠ accordion display gap is the whole reason for this plan.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
