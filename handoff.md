# Handoff — 2026-07-08 ~07:20 — branch debt-model-fixes-p0 — Stage 3 of unify-cycling-model SHIPPED

## Goals
1. Execute `.claude/plan/unify-cycling-model.md` (6 stages, one-per-session per the plan's own
   risk mitigation). Stage 3 (the behavior-change stage) shipped this session.
2. Cash-floor look-ahead protection — user flagged explicitly "for later" (still not this
   session, multiple sessions running). NOT STARTED, NOT SCOPED. Just log it (roadmap/memory) —
   do not implement yet.
3. Dev server was running at localhost:8080 when this session ended (confirmed via curl). If not
   running when you resume, restart it (`npm run dev`, `run_in_background: true`).

## Current State
- **Stage 0/1/2 SHIPPED** (commits `7cd9055e`/`93dc9715`/`2c4b2f38`) — see
  `project_cycling_debt_engine.md` memory for detail; all zero-behavior-change.
- **Stage 3 SHIPPED this session (commit `0aa04b85`).** `forecast-engine.ts` PASS 3 now trusts
  `cardProjectionData.paymentLedger[i].total` directly for `monthDebtPayment` instead of
  re-deriving its own cycling/revolving split. Deleted: `cyclingPayment`, `revolvingPayment`,
  `hookScaledTotal`, `safetyCeiling`, `effectiveCeiling`, `p3RevBal`, `virtualRevBal`,
  `cumulativeStep3Extra`, `prevCcEngRevBalEnd`, `prevAdjustedRevBal`, `revolving3Extra` (field
  removed from `ForecastMonthRow` entirely — no live UI consumer, only two now-updated tests
  referenced it).
  - Single-clamp rule: sim clamps, engine trusts. Sole exception: month 0 forced to `$0` when
    `cardProjectionData.month0.safeToPayTotal === 0` (Plaid syncCutoffDate — sim has no concept
    of it; explicitly called out in the plan as an untouched Stage-3 risk).
  - `row.revolvingDebtCash` changed meaning: it's now a forward-looking TARGET for the *next*
    convergence pass (`ledger.revolving + unrouted cash surplus above floor`), not "cash already
    routed this pass." Fed back through the pre-existing `runDebtCashConvergence` →
    `resimulateWithDebtCash` → `debtCashTargetByMonth` loop (unchanged machinery) — the sim
    absorbs surplus into its own state (interest, backlog, per-card cascade) on the next pass
    instead of the engine tracking a parallel register that could drift from it.
  - **Scope addition, explicit user sign-off** (asked via AskUserQuestion mid-stage, user chose
    "extend the sim"): `credit-card-engine.ts`'s Step 2 cycling/paid-off pool had no equivalent
    to the engine's old save-up-month cap for full-balance/statement cards once revolving debt
    was already cleared. Added: `allRevolvingClear` gate + `mDebtCap` hoisted earlier in the
    per-month loop; when both a save-up cap is active AND all revolving/backlog debt is clear,
    Step 2's `paidOffPool` is now also capped (floored at cycling cards' own contract minimums).
    JSDoc on `maxDebtPaymentByMonth` updated to describe both behaviors.
  - **Fixture gotcha (resolved, worth remembering):** the gitignored real-data fixture
    (`src/lib/__tests__/fixtures/forecast-inputs.real.json`, captured 2026-07-03) predated
    Stage 2's `paymentLedger` field — present but stale, not absent. `ledgerEntry` was
    silently `undefined`, falling through to the old fallback and producing misleading test
    failures. Fixed via a one-off deterministic backfill script (reconstructed `paymentLedger`
    from `perCardPayments` + `monthlyRevolvingBalances`, both already in the fixture, using the
    exact `buildPaymentLedger` algorithm — no live browser recapture needed). Script deleted
    after use, not part of the app. **If Stage 4/5 hits an unexpected real-data test failure,
    check the fixture's age/field completeness (`ls -la` mtime vs. the commit that added
    whatever field the test reads) before assuming a code bug.**
  - Test changes: `forecast-engine.simAgreement.test.ts` (Stage 0's baseline) flipped to the
    hard `gap <= 1` assertion the plan called for (month 0 exempt — live-anchored, no
    syncCutoffDate concept in the sim). `forecast-engine.revolvingDebtCash.test.ts` updated for
    the new forward-looking-target semantics (no longer bounded by same-pass `debtPayment`).
  - **Verified:** 156/156 tests green, `tsc --noEmit` clean, `eslint` clean (one pre-existing
    unrelated warning), **golden Tier-A milestone/trajectory unchanged — ran it, confirmed no
    re-pin needed** (not assumed — this was the plan's biggest flagged risk for this stage).
- Working tree: clean except `handoff.md` uncommitted right now (Stage 3 + backups already
  committed as `0aa04b85`). Verify with `git status` before doing anything.
- Backup folder from this session: `./backups/2026-07-08_071003/` (pre-Stage-3 snapshots of
  `forecast-engine.ts`, `credit-card-engine.ts`, and the two touched test files), committed as
  part of `0aa04b85`.
- **Stage 3 was NOT live-verified in the browser this session** (Stage 5's job per the plan,
  deliberately deferred — test-level verification was thorough and the golden fixture check is
  strong signal, but the popup-vs-accordion live agreement check is still outstanding).

## Active Files
- `.claude/plan/unify-cycling-model.md` — the 6-stage plan; Stage 4 is next.
- `src/lib/forecast-engine.ts` — PASS 3 (~l.1058-1355) now trusts the ledger; see the "Step 2"/
  "Step 3" comments in place for exactly what changed and why. `ForecastMonthRow` interface
  (~l.40-76) lost `revolving3Extra`, `revolvingDebtCash`'s doc comment rewritten.
- `src/lib/credit-card-engine.ts` — `allRevolvingClear`/hoisted `mDebtCap` (~l.925-935), cycling
  pool cap application (~l.990-1004, right before Phase A), `maxDebtPaymentByMonth` JSDoc
  (~l.677-687).
- `src/lib/__tests__/forecast-engine.simAgreement.test.ts` — now a hard assertion, not a baseline
  logger.
- `src/lib/__tests__/forecast-engine.revolvingDebtCash.test.ts` — updated for new semantics.
- `src/lib/__tests__/fixtures/forecast-inputs.real.json` — gitignored, locally patched with
  `paymentLedger` this session (see fixture gotcha above). Not committed (gitignored), so this
  local patch persists only on this machine — fine, that's the existing pattern for this file.

## Changes Made (this session, all committed except handoff.md)
- Commit `0aa04b85` — Stage 3 (engine delegates to sim's payment ledger) + sim-side save-up cap
  extension for the cycling pool + test updates. See above for full file list.
- Memory: appended a 2026-07-08 Stage-3 entry to `project_cycling_debt_engine.md`; updated its
  `MEMORY.md` index line.

## Failed Attempts
None this session — Stage 3 landed cleanly on the first implementation, no reverts.

## Next Steps — DO THESE IN ORDER
### 1. Resume `.claude/plan/unify-cycling-model.md` Stage 4
Convergence + goldens review:
- Re-run `forecast-convergence.test.ts` (7 tests) — loop semantics unchanged by Stage 3 (still
  damping 0.5, maxPasses 8), but re-verify pass count on live data hasn't drifted; re-pin the
  default-budget test only if it actually shifted and only with justification.
- Golden Tier-A (`forecast-engine.goldenTierA.test.ts`) already confirmed unchanged as of Stage 3
  landing THIS session — re-verify it's still green (real account data may have moved since,
  independent of code changes) before assuming Stage 4 needs no golden re-pin work.
- `forecast-engine.revolvingDebtCash.test.ts`, `step3-display.test.ts`, resim tests — review
  each with root-cause justification per the plan; only touch what's actually broken by Stage 3's
  new semantics (most of this should already be settled from this session's test updates).
- Deliverable: full suite green with any golden changes documented and Tre-approved before
  re-pinning (never silent).

### 2. Stage 5 (live verify + cleanup)
Only after Stage 4 lands and is verified.
- Live check (localhost:8080, signed in): `/forecast` Monthly Breakdown popup per-card sum vs.
  `/debt` accordion Monthly Projection for a representative month — must agree ≤ $1 (popup scale
  factor should now be ~1.0, this is the actual regression test for the whole plan's motivating
  bug — "Popup ≠ accordion display gap"). Check `converged` flag + pass count in the convergence
  result while there.
- Delete dead engine code paths left over from Stage 3 if any remain (double-check — this
  session's diff should already be clean, but verify no `perCardPaymentsScaled` preference reads
  in the engine went stale).
- `python -m graphify update .`; update memory (`project_cycling_debt_engine.md`) + roadmap;
  session summary file per the global CLAUDE.md session-end format.

### 3. Cash-floor look-ahead protection (explicitly "for later" — not scoped, not started)
User's request, verbatim (from a prior session): "seeing a drop below cash floor next month,
when we should cut back a little of the debt payment this month to protect it." NEW feature
idea, not yet investigated against existing `computeFloorProtection`/`maxDebtPaymentByMonth`
look-ahead machinery. Do not start until asked; when picked up, first audit the existing
floor-protection look-ahead per CLAUDE.md root-cause rules.

### 4. Memory/roadmap
Already updated `project_cycling_debt_engine.md` + its MEMORY.md index line this session. If
Stage 4+ lands in a future session, add a similar entry there; also make sure the roadmap memory
still has the cash-floor-lookahead backlog item logged (check `project_roadmap.md` — may already
be captured from a prior session, verify before re-adding).

## Key anchors (mostly unchanged from prior handoffs)
- Dev server localhost:8080 — restart if not running (`npm run dev`, background). Route `/debt`
  (accordion = expand card → Monthly Projection table), `/forecast` (popup = tap Monthly
  Breakdown row).
- Never push. Backups before high-risk edits. Supabase user_id
  `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- Popup ≠ accordion display gap (diagnosed in an earlier handoff) is the whole reason for this
  plan — Stage 3 closed the underlying math gap structurally; Stage 5's live check is the actual
  confirmation this is visible in the UI, not yet performed.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
