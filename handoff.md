# Handoff — 2026-07-08 ~07:30 — branch debt-model-fixes-p0 — Stage 3 SHIPPED; user flagged a scope-decision revisit, NOT YET DIAGNOSED FULLY

## Goals
1. Execute `.claude/plan/unify-cycling-model.md` (6 stages). Stage 3 shipped last session
   (commit `0aa04b85`, handoff `cb3ecf25`). Stages 4-5 remain — see prior handoff content below.
2. **NEW THIS SESSION (not yet resolved):** user said their prior mid-Stage-3 AskUserQuestion
   answer was wrong/misinterpreted. Verbatim: "i think my previous decision was incorrect/
   misinterpreted. i wanted forecasts save up method to be the source of truth. so debt payoff
   tab would follow the same rules as well." This is the PRIMARY thing to resolve next session,
   before touching Stage 4/5.
3. Cash-floor look-ahead protection — still "for later," not started, not scoped.

## Current State — the scope-decision issue (diagnose-in-progress)
During Stage 3, the fork discovered a real gap: `credit-card-engine.ts`'s Step 2 cycling/paid-off
pool had no save-up-month cash cap once revolving debt was cleared (only Forecast's old PASS 3
enforced it, post-hoc, before Stage 3 deleted that logic). It asked the user via AskUserQuestion
whether to (a) keep the cap engine-side or (b) extend the sim — user picked "extend the sim."
Implemented: `credit-card-engine.ts` gained `allRevolvingClear` + hoisted `mDebtCap`, and Step 2's
`paidOffPool` is now capped using **the sim's own `maxDebtPaymentByMonth`** (computed inside
`useCardProjection.ts` via its own `runLookAhead()` call, lines ~885/911).

**The user is now saying this was the wrong "source of truth."** I found, before hitting the
context gate, that there are TWO INDEPENDENT save-up/floor-protection computations in this
codebase — this is the crux and needs confirming/completing next session:

1. **`forecast-engine.ts` PASS 2** (`src/lib/forecast-engine.ts:949`) — calls
   `computeFloorProtection({...})` to get ITS OWN `maxDebtPaymentByMonth` / `strictSaveUpMonths`.
   This pass has the FULL forecast context: income, all expenses, vehicle purchases, one-time
   items, savings goals, etc. — the richest picture in the app.
2. **`useCardProjection.ts`** (`src/hooks/useCardProjection.ts:885,911`) — calls its OWN
   `runLookAhead(cashFloorByMonth, ...)` to compute a SEPARATE `maxDebtPaymentByMonth` /
   `saveUpMonths` / `strictSaveUpMonths`. This is the hook that BOTH the Debt Payoff tab (direct
   consumer) and Forecast (via `cardProjectionData`) read from for card-level sim output. It is
   NOT fed by forecast-engine's PASS 2 output — it runs its own, likely narrower, look-ahead
   (need to verify exactly what inputs it has vs. PASS 2 — did not get to this before the gate).

Stage 3's scope-addition capped the sim's cycling pool using computation #2 (the hook's own,
narrower look-ahead) — NOT computation #1 (Forecast's richer PASS-2 determination). The user's
new statement suggests they want #1 to be authoritative, fed INTO the sim (so Debt Payoff tab,
which has no access to Forecast's PASS 2 at all normally, would need to receive it somehow), NOT
have the sim keep computing its own independent, possibly-disagreeing version.

**This is not yet fully diagnosed.** Before writing any code:
- Read `runLookAhead` (find its definition — grep didn't reach this before the gate; likely in
  `useCardProjection.ts` itself or a helper file like `floor-protection.ts`) and compare its
  inputs/logic against `computeFloorProtection` in `forecast-engine.ts` (also grep its
  definition — likely `src/lib/floor-protection.ts` based on the handoff's prior mention of
  `computeFloorProtection`/`maxDebtPaymentByMonth` look-ahead machinery). Determine: are they
  the SAME algorithm applied to different (subset vs full) inputs, or genuinely different logic?
- Figure out whether Debt Payoff tab (no Forecast context) can even receive Forecast's PASS-2
  save-up decision — Debt Payoff may be usable standalone (no income/expense/vehicle data loaded)
  in which case Forecast's richer look-ahead literally cannot run there, and "same source of
  truth" may mean something narrower than a full swap (e.g., only apply Forecast's decision when
  Forecast context IS available/the two pages are viewing the same underlying data via
  `CardProjectionContext`).
- Check `src/contexts/CardProjectionContext.tsx` — plan's own Key Files table flagged this as
  "Verify: wiring unchanged; `debtCashConverged` finally meaningful." May already show whether
  Forecast's convergence-adjusted `cardProjectionData` (post `resimulateWithDebtCash`) is the
  SAME object instance Debt Payoff tab renders from, or whether Debt Payoff reads a pre-convergence
  base version. This could be the actual, simpler fix: make Debt Payoff tab consume the
  POST-CONVERGENCE `cardProjectionData` (which already reflects Forecast's PASS-2-informed
  `debtCashTargetByMonth` after Stage 3's changes) instead of a separate un-converged base sim run.

## Active Files
- `.claude/plan/unify-cycling-model.md` — Stage 4 next per the plan, but this new save-up-source-
  of-truth question should be resolved FIRST since it touches the same code the plan's Stage 4
  golden-review would need to re-verify.
- `src/lib/forecast-engine.ts` — PASS 2 `computeFloorProtection` call at line 949.
- `src/hooks/useCardProjection.ts` — `runLookAhead` calls at lines 885, 911; Stage 3's
  `allRevolvingClear`/hoisted `mDebtCap` additions around l.925-935 (per prior handoff).
- `src/lib/credit-card-engine.ts` — Step 2 cycling-pool cap application ~l.990-1004 (per prior
  handoff) — this is what used the hook's own (possibly wrong-source) `maxDebtPaymentByMonth`.
- `src/contexts/CardProjectionContext.tsx` — NOT YET READ this session; check wiring per above.
- Likely `src/lib/floor-protection.ts` or similar — NOT YET LOCATED, grep for
  `computeFloorProtection` definition and `runLookAhead` definition next session first thing.

## Changes Made (this session)
None — pure investigation, cut short by the context gate before reaching a diagnosis or plan.
No files edited. `git status` should show only `handoff.md`.

## Failed Attempts
None — investigation in progress, not failed, just incomplete.

## Next Steps — DO THESE IN ORDER
### 1. Finish diagnosing the save-up "source of truth" question
Grep for `function computeFloorProtection` and `function runLookAhead` definitions, read both in
full, compare. Read `CardProjectionContext.tsx`. Form a concrete hypothesis for why they disagree
(or confirm they're actually consistent and the user's concern is about something else — re-read
their message again with fresh eyes: "i wanted forecasts save up method to be the source of truth.
so debt payoff tab would follow the same rules as well" — confirm this really is about the
runLookAhead/computeFloorProtection duality and not, e.g., about something in the AskUserQuestion
options that was worded ambiguously).

### 2. Given this touches shared architecture (Debt Payoff tab, Forecast tab, the sim, and
possibly CardProjectionContext), treat this as non-trivial per CLAUDE.md — plan before coding.
Given the user has now twice engaged with this specific decision, ask clarifying questions if the
diagnosis reveals multiple valid fix shapes (e.g., "feed Forecast's PASS-2 numbers into the sim's
params" vs. "make Debt Payoff tab consume post-convergence cardProjectionData" vs. "unify
runLookAhead and computeFloorProtection into one shared function") rather than guessing — this
is exactly an AMBIGUITY RULE case if it comes to that, especially since the user already flagged
one prior answer as a misinterpretation.

### 3. Resume `.claude/plan/unify-cycling-model.md` Stage 4 (convergence + goldens review) —
only after the save-up-source-of-truth question is resolved, since Stage 4's golden-fixture
re-verification could be invalidated by whatever fix comes out of step 1-2 above.

### 4. Stage 5 (live verify + cleanup) — after Stage 4.

## Key anchors (unchanged from prior handoffs)
- Dev server localhost:8080 — restart if not running (`npm run dev`, background). Route `/debt`
  (accordion = expand card → Monthly Projection table), `/forecast` (popup = tap Monthly
  Breakdown row).
- Never push. Backups before high-risk edits. Supabase user_id
  `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- 156/156 tests green and `tsc --noEmit` clean as of Stage 3's commit (`0aa04b85`) — re-verify
  after any fix from this session's investigation.
- Popup ≠ accordion display gap is the whole reason for this plan; the save-up-source-of-truth
  question is a NEW variant of that same disagreement, specific to save-up months + cycling cards.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
