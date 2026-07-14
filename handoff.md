# Handoff — 2026-07-14 — Q1 override-rebalance: CODE COMPLETE + tests green; live verify pending; NEW Q4 reported

## GOAL
1. Finish `.claude/plan/override-rebalance.md` (steps 1-5 DONE, step 6 live-verify PENDING).
2. NEW user report (Q4, not yet investigated — see bottom): cycling card not paying its full
   statement in later years even though cash is on hand.

## CURRENT STATE (all this session, committed locally as one commit — see git log)
- Engine (src/lib/credit-card-engine.ts): new trailing param #21 `paymentOverridesByMonth`
  implemented per plan. Structure: hoisted "pinned" resolution block right after Step 1b
  (computes per-pin `{step5Share, mandatoryShare}`; mirrors Step-3 interest + Step-2 owedByCard
  formulas — see comments there); then deductions/exclusions:
  - reservedForRevolving reserves pin.step5Share instead of contract min for pinned cards
  - paidOffPool −= pinnedMandatoryTotal; Phase A/B distribute over `unpinnedPaidOffCards`
  - mandatoryPayByCard loop: pinned cycling card pays exactly mandatoryShare (no backstop);
    unpaid statement remainder rolls to backlog naturally
  - Step 5: totalMins excludes pinned; availableCash −= pinnedStep5Total; mDebtCap and
    mDebtTarget reduced by the pinned shares; FLOOR_BREACHED sort + strategyOrder filter pinned
    out; `payments.set(id, step5Share)` injected after both branches; min-guard skips pinned
  - Step 6/6b/6c unchanged — flow through naturally (grace loss on underpaid statement works)
- Component (src/components/debt/CreditCardEngine.tsx):
  - variableSim memo now builds `runSim(overrides?)` closure and returns it (`{...sim,
    augmentedCCPurchases, runSim}`) — byte-identical args, no duplication
  - new `overrideSim` memo right after variableSim: `overrides` non-empty ? runSim(overrides) : null
  - projections memo: when overrideSim, ALL cards source payments/balances/revBals/cyclingOwed/
    cyclingInterest/interest from overrideSim (old `hasOverrides ? undefined : …` hack deleted)
  - debtChartData: revBal prefers overrideSim; step3CumSurplus adjustment skipped when overrideSim
  - toast: "Payment override applied — other cards rebalanced"
- Tests: NEW src/lib/__tests__/credit-card-engine.paymentOverrides.test.ts — 9 tests (lower-pin
  redistribution+conservation, higher-pin min protection, below-min pin honored, clamp-at-owed,
  later-month prefix identity, avalanche vs snowball routing, deep-equal regression guard
  {omitted/undefined/{}}, reconciliation walk).
- VERIFIED: `npx tsc --noEmit` clean; `npx vitest run` 174/174 green (baseline was 165).
- Backups: backups/2026-07-14_003930/ (engine + component originals). Committed.
- NOT done: `python -m graphify update .` (run it), live verify, push (never push).

## NEXT STEPS (in order)
1. Live verify plan step 6: dev server http://localhost:8080, /debt tab (browser tools; fresh
   tab via tabs_context_mcp; `window.__simDebug` live). Override a Prime Visa month → Discover's
   same-month payment should move; rows reconcile (End = Start + purchases + interest − payment);
   pinned row shows exactly the typed value (unless clamped); "Reset & Recalculate" restores.
2. Run `python -m graphify update .`; commit if it changes graphify-out/.
3. Then investigate Q4 (below).

## Q4 — NEW report (user message + screenshot, 2026-07-14, NOT yet investigated)
"There is an issue with paying full statement in later years, even though there is money on hand."
Screenshot (a cycling/statement card accordion, Feb–Jun 2028): Feb 2028 Start $148 + $831
purchases, pay −$148 → End $831; Mar Start $495 +$278 purch, pay −$315 → End $516; Apr Start
$805 +$148 purch +$11.81 INTEREST, pay −$805 → End $148; May Start $148 +$227 purch, pay −$148.
Pattern: payment keeps equaling PRIOR cycle's statement while a shortfall snowballs and interest
appears — mandatory cycling pool underfunding the statement in later years despite cash on hand.
Possibly related pre-existing signal: vitest stdout shows `[projectCardVariable] Prime Visa
Sep 2027 / Jan+Feb 2029 does not reconcile` warnings from the golden-fixture tests (residuals
−607/−280) — NOT new, suite green, but same "later years cycling" smell. Suspects: Step 2 pool
sizing (tentativeAvailAboveFloor / reservedForRevolving / ccMinAlreadyInFloor double-reserve) or
maxDebtPaymentByMonth save-up cap with allRevolvingClear. Check whether Q4 reproduces WITHOUT
overrides (it should — this screenshot predates any override usage this session) and on shared
pipeline vs local variableSim. Treat as lean-fix diagnosis; engine backups exist.

## GUARDRAILS
- Repo PUBLIC — never commit real financial data (sim dumps, fixtures).
- Supabase: always filter user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Never push unless asked. No amend/rebase.
