# Handoff — 2026-07-08 ~06:52 — branch debt-model-fixes-p0 — Stage 2 of unify-cycling-model SHIPPED; Discover "bug" was a false alarm, reverted

## Goals
1. Execute `.claude/plan/unify-cycling-model.md` (6 stages, one-per-session per the plan's own
   risk mitigation). Invoked via `/remote-control execute .claude/plan/unify-cycling-model.md`.
2. A prior-session tangent (Discover-transition-purchase "bug") was resolved THIS session — see
   below. Not part of the plan; fully closed out, no further action.
3. Cash-floor look-ahead protection — user flagged explicitly "for later" (still not this
   session). NOT STARTED, NOT SCOPED. Just log it (roadmap/memory) — do not implement yet.
4. Dev server requested last session — was running at localhost:8080 (bash task id `birp8zn6l`
   from the PRIOR session's context, which no longer exists after `/clear`). If it's not running
   when you resume, restart it (`npm run dev`, `run_in_background: true`).

## Current State
- **Discover-transition-purchase "bug": DIAGNOSED AS NOT A BUG, FULLY REVERTED, NO COMMIT.**
  Prior handoff had this scoped as: apply the purchase-exclusion carve-out (currently only for
  `paymentPreference === 'statement'` cards) universally in `cascadeTarget`
  (`credit-card-engine.ts`, inside `simulateVariablePayoff`). I coded it, all 156 tests passed,
  tsc clean — but before committing, re-read `CreditCardEngine.tsx:1559,1579`, which explicitly
  documents `paymentPreference === 'full'` as "Pay entire balance + new purchases each month, as
  cash allows." Discover IS set to `'full'`. The stray $36.23 remainder the user saw in the
  Jul 2027 row is the CORRECT, by-design outcome of `'full'` preference when cash falls just
  short of covering balance+purchases that month — not an engine defect. Presented this via
  AskUserQuestion; user chose "Leave Discover as Full Balance" (drop the thread entirely, no
  code change). Reverted the edit — `git diff src/lib/credit-card-engine.ts` is empty, confirmed.
  **Do not re-attempt this "fix" unless the user explicitly asks to revisit Discover's payment
  preference setting.** Memory updated: `project_cycling_debt_engine.md` (2026-07-08 entry).
- **Stage 0 SHIPPED** (commit 7cd9055e) and **Stage 1 SHIPPED** (commit 93dc9715) — see prior
  handoffs / `project_cycling_debt_engine.md` for detail; both zero-behavior-change.
- **Stage 2 SHIPPED this session (commit 2c4b2f38).** Sim now publishes an authoritative
  per-month payment ledger:
  - `src/lib/credit-card-engine.ts`: new `PaymentLedgerCardEntry`/`PaymentLedgerEntry` types and
    `buildPaymentLedger(sim: SimResult, cards: CardData[], months = PROJECTION_MONTHS):
    PaymentLedgerEntry[]` — pure function, per month returns `{ total, revolving, cycling,
    perCard }` computed directly from `sim.monthlyPayments`/`sim.monthlyRevolvingBalances`.
    `revolving` classification mirrors the existing `debtPaymentTotals` rule: a card counts as
    revolving for month `i` if its start-of-month revolving balance (month `i-1`, or month `0`
    itself for `i===0`) was `> 0`.
  - `src/lib/debt-model-types.ts`: `CardProjectionResult` gained `paymentLedger:
    PaymentLedgerEntry[]`.
  - `src/hooks/useCardProjection.ts`: `hookResult.paymentLedger = buildPaymentLedger(activeSim,
    cards)`.
  - `src/hooks/cardProjectionResim.ts`: `buildResimOverrides` rebuilds
    `paymentLedger: buildPaymentLedger(simT, cards)` on every resim pass; added to the
    `ResimOverrides` Pick type.
  - New test `src/lib/__tests__/payment-ledger.test.ts` (4 tests) asserting: perCard sums to
    total; revolving+cycling==total; total matches sim's own monthlyPayments sum
    (allPaymentTotals identity); revolving classification matches the start-of-month rule
    (debtPaymentTotals identity); a card stops contributing to revolving the month after payoff.
  - **No consumer reads `paymentLedger` yet** — by design, per the plan. 156/156 tests green
    (152 prior + 4 new), tsc clean, diff confined to exactly the Stage 2 plan's listed files
    (`credit-card-engine.ts`, `debt-model-types.ts`, `useCardProjection.ts`,
    `cardProjectionResim.ts`, new test file).
- **Stage 3 NOT STARTED — this is THE behavior-change stage, do it next.** Plan:
  `forecast-engine.ts` PASS 3 (currently l.1106-1150ish per the plan doc, may have drifted) must
  replace its own re-derived split (`cyclingPayment`, re-clamped `revolvingPayment`,
  `hookScaledTotal` preference) with direct consumption: `monthDebtPayment = ledger[i].total`,
  `revolvingDebtCash = ledger[i].revolving`. Single-clamp rule: sim clamps, engine trusts (don't
  clamp a second time). Step-3 surplus redirect (l.1169-1186ish) needs to feed surplus into
  `debtCashTargetByMonth` for next pass instead of its own `virtualRevBal`/`cumulativeStep3Extra`
  duplicate walk (delete those). Deliverable: on the real fixture, converged gap
  `|debtPayment − ledger.total|` ≤ $1 every month — Stage 0's characterization test flips from
  logging-only to a hard assertion. See the plan file's Stage 3 section for full detail before
  starting; this is the most complex stage in the plan.
- Working tree: only `handoff.md` uncommitted right now (Stage 2 + backups already committed as
  2c4b2f38). Verify with `git status` before doing anything.
- Two backup folders under `./backups/` from this session: `2026-07-08_064111` (Discover
  attempt, since reverted — this backup is now redundant, harmless to leave, already deleted by
  me actually — wait, see note below) and `2026-07-08_064830` (Stage 2 pre-edit snapshots,
  committed as part of 2c4b2f38, keep). **Correction**: the `2026-07-08_064111` backup dir WAS
  deleted this session (`rm -rf`) since it corresponded to a fully-reverted, never-committed
  change — nothing to restore from it. Only `2026-07-08_064830/` exists and is committed.

## Active Files
- `.claude/plan/unify-cycling-model.md` — the 6-stage plan; Stage 3 is next.
- `src/lib/credit-card-engine.ts` — Stage 2's `buildPaymentLedger` lives here (after `SimResult`,
  before `simulateVariablePayoff`). Discover's `cascadeTarget` (~l.1108-1124, search
  `const cascadeTarget = `) is UNCHANGED from before this session (reverted) — do not touch
  without a fresh, explicit ask from the user.
- `src/lib/debt-model-types.ts` — `CardProjectionResult.paymentLedger` field added here.
- `src/hooks/useCardProjection.ts`, `src/hooks/cardProjectionResim.ts` — Stage 2 wiring; Stage 3
  will change `src/lib/forecast-engine.ts` (not yet touched) to consume `paymentLedger`.
- `src/lib/__tests__/payment-ledger.test.ts` — Stage 2's new test.
- `src/lib/__tests__/forecast-engine.simAgreement.test.ts` — Stage 0's characterization test;
  Stage 3 flips its assertion from soft/logging to a hard `≤ $1` check.

## Changes Made (this session, all committed except handoff.md)
- Commit 2c4b2f38 — Stage 2 (payment ledger). See above for full file list.
- Discover `cascadeTarget` fix: coded, tested green, then fully reverted (no commit) after
  discovering it contradicted documented `'full'`-preference semantics. Net effect on
  `credit-card-engine.ts` from this thread: zero.
- Memory: appended a 2026-07-08 entry to `project_cycling_debt_engine.md` (plan progress +
  Discover false-alarm writeup); updated its `MEMORY.md` index line.

## Failed Attempts
- Discover `cascadeTarget` universal purchase-exclusion (this session) — not a failure of
  execution (code worked, tests passed) but a failure of diagnosis: the "bug" was correct,
  documented `'full'`-preference behavior. See "Current State" above for full reasoning. Do not
  re-attempt without new information from the user.

## Next Steps — DO THESE IN ORDER
### 1. Resume `.claude/plan/unify-cycling-model.md` Stage 3
The real behavior-change stage. Read the plan file's Stage 3 section in full before starting.
Key risk: Golden Tier-A (`forecast-engine.goldenTierA.test.ts`) milestone/trajectory MAY
legitimately shift once the engine uses real sim payments — per CLAUDE.md and the plan's own
risk table, do NOT silently re-pin; diff old vs new, present the delta to Tre, get sign-off, then
update pinned values in the SAME commit with the diff quoted in the message. Budget this as
likely the biggest single stage — consider whether it needs its own context-gate checkpoint
mid-stage if it grows large (the plan itself says "one stage per session max; context-gate
handoff between stages," so a sub-stage handoff mid-Stage-3 if needed is consistent with that).

### 2. Stage 4 (convergence + goldens) and Stage 5 (live verify + cleanup)
Only after Stage 3 lands and is verified. See plan file for detail per stage.

### 3. Cash-floor look-ahead protection (explicitly "for later" — not scoped, not started)
User's request, verbatim (from a prior session): "seeing a drop below cash floor next month,
when we should cut back a little of the debt payment this month to protect it." NEW feature
idea, not yet investigated against existing `computeFloorProtection`/`maxDebtPaymentByMonth`
look-ahead machinery in `useCardProjection.ts`/`floor-protection.ts` (there is SOME look-ahead
already — `saveUpMonths`, `strictSaveUpMonths` — so this may be a refinement, not net-new). Do
not start until asked; when picked up, first audit the existing floor-protection look-ahead per
CLAUDE.md root-cause rules.

### 4. Memory/roadmap
Already updated `project_cycling_debt_engine.md` + its MEMORY.md index line this session. If
Stage 3+ lands in a future session, add a similar entry there; also make sure the roadmap memory
still has the cash-floor-lookahead backlog item logged (check `project_roadmap.md` — may already
be captured from a prior session, verify before re-adding).

## Key anchors (mostly unchanged from prior handoffs)
- Dev server localhost:8080 — restart if not running (`npm run dev`, background). Route /debt
  (accordion = expand card → Monthly Projection table), /forecast (popup = tap Monthly
  Breakdown row).
- Never push. Backups before high-risk edits. Supabase user_id
  `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- Golden Tier-A untouched by Stages 0/1/2 (pure engine on fixture — provider-path changes don't
  feed it) — Stage 3 is the first stage where it may legitimately shift; handle per the plan's
  explicit "present delta before re-pinning" rule.
- Popup ≠ accordion display gap (diagnosed in an earlier handoff) is the whole reason for this
  plan — Stage 3+ closes it structurally instead of needing display-layer scaling.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
