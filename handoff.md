# Handoff — 2026-07-14 — Q1 override-rebalance: plan APPROVED, execution just started (no code edits yet)

## GOAL
Execute `.claude/plan/override-rebalance.md` (user said "execute the plan"). Read that plan file
IN FULL first — it is the authoritative spec (approach, steps 1-6, key files, risks, out-of-scope).

## CURRENT STATE
- Plan approved by user 2026-07-14. Execution began: backups taken to
  `backups/2026-07-14_003930/` (credit-card-engine.ts + CreditCardEngine.tsx). **ZERO code
  edits made** — context gate (163k) fired right after the first read of the sim body.
- Working tree should be clean apart from the untracked/uncommitted backup folder and this file.
- Earlier this session (already committed): Q3 interest-saving-balance UI `4e5be68e`,
  handoff refresh `355233fa`. Q2 closed (see plan file / git log). Nothing pushed.

## WHAT THE NEXT AGENT NEEDS TO KNOW (context gathered, verified 07-14)
- Pinning point is `simulateVariablePayoff` (src/lib/credit-card-engine.ts:638-743 signature).
  Add optional trailing param `paymentOverridesByMonth?: { [cardId: string]: Record<number, number> }`
  after `debtCashTargetByMonth` (:742).
- Sim structure (read :744-943 so far): Step 1 init (maps per card, `balances`, `cyclingBacklog`,
  `paidOffCards`, `graceMap`); monthly loop starts :836; `effectiveFloor`/`oneTimeNet` :861-865;
  per-card min-payment push :881-913; Step 1b backlog interest :923-935; `mDebtCap`/
  `allRevolvingClear` :939+. Step 2 (cycling/mandatory pool) and Step 5 (revolving cascade,
  `distributeProportionally` Phase A/B water-filling) are FURTHER DOWN — not yet read. Read them
  before editing; integration = deduct pinned payment from pool sizing once, exclude pinned card
  from allocation in BOTH steps that month (needFn→0 pattern, cf. 06-20 Phase A fix).
- Component (src/components/debt/CreditCardEngine.tsx): `overrides` state :133 (ephemeral
  useState). Local `variableSim` memo :437 (keep override-free — feeds recommendedSafeMinimum
  :791). `projections` memo :871-915 currently prefers shared-sim `perCardPayments` prop (:887)
  and passes `undefined` ground truth when overrides exist (:896-905) — plan step 3 replaces that
  hack with a new `overrideSim` memo sourcing ALL cards when overrides exist. Toast :1033.
- `month0Recs` (:813-869) reads `month0.perCardAdjusted` from the shared pipeline — DO NOT touch
  (out of scope). Forecast/convergence pipeline untouched (out of scope, regression history).
- Tests: create `src/lib/__tests__/credit-card-engine.paymentOverrides.test.ts` per plan step 5
  (incl. deep-equal no-override regression). Suite baseline: 165 tests green, tsc clean.

## NEXT STEPS (in order)
1. Read `.claude/plan/override-rebalance.md` fully.
2. Read the rest of `simulateVariablePayoff` (Step 2 and Step 5 bodies, credit-card-engine.ts
   ~:943 onward) before writing anything.
3. Implement plan steps 1-4 (engine param → overrideSim memo → projections switch → toast copy).
   Backups already exist at backups/2026-07-14_003930/ — no need to re-backup these two files
   unless the date changes.
4. Tests (plan step 5), then tsc + full vitest.
5. Live verify (plan step 6): dev server http://localhost:8080 running, browser logged in
   (get fresh tab via tabs_context_mcp; `window.__simDebug` live on /debt). Override a Prime
   Visa month, confirm Discover's same-month payment moves and rows reconcile.
6. Commit locally (include backups folder). NO push.

## GUARDRAILS
- Repo PUBLIC — never commit real financial data (sim dumps, fixtures).
- Supabase: always filter user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Never push unless asked. No amend/rebase.
