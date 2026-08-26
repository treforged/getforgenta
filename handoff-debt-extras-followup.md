# Handoff — "extra payments" follow-up build (BUILT + COMMITTED, one gate rerun pending)

## ▶ 2026-08-26 BUILDER COMPLETION (written by the in-flight builder at cap time)

The slice is BUILT and COMMITTED locally on main in TWO commits. NOT pushed.

- **Commit 1 `d4a12d4b`** - the full feature, GATED GREEN before commit:
  `npx tsc --noEmit` exit 0 (clean); `npm test` -> `Test Files  272 passed (272)` /
  `Tests  2734 passed (2734)` (baseline 271/2731 + new
  `src/lib/__tests__/forecast-engine.extrasPayoffReadout.test.ts`, 3 tests).
  ForecastResult exposes `nonCCLiabilityBalancesById` + `carLoanBalancesByFundId`
  (shared references, zero new math); DebtPayoff reads them off
  `useCardProjectionContext().projections` (engine already runs in the provider -
  plumbing option (a), no new hook); secondary line on all four non-CC tabs;
  explainer reworded (keeps the phrase the explainer test pins). Release-Note
  trailer included.
- **Commit 2 (this commit)** - peer findings 1+2 folded in per the manager's resume
  order: `buildAutoExtraByTarget(projections.data)` gate (line renders only when the
  waterfall ACTUALLY paid the target - ranked-but-$0 can no longer show a phantom
  line off the account-vs-debts-row balance divergence) and the pairing tightened to
  the engine's liability-type set (`NON_CC_LIABILITY_TYPES`). Mock in
  `DebtPayoff.nonCcExplainer.test.tsx` gained `data: []`.
  **GATES COULD NOT RERUN for commit 2** - the usage cap blocked tsc/vitest after the
  edits. The delta is small and type-checked by eye (`buildAutoExtraByTarget:
  (rows: readonly ForecastMonthRow[]) => Map<string, number[]>` verified by reading
  the source). **FIRST ACTION ON RESUME: `npx tsc --noEmit` + `npm test`; if red,
  the delta is isolated in this commit and cheap to fix or revert to `d4a12d4b`.**
- Backups (originals, pre-session): `backups/2026-08-26_001821/` (gitignored).
- Not verified visually in a live browser; UI gate logic has no rendering test
  (engine wiring is pinned by the 3 new tests).
- Manager resume items 4-6 below (message getforgenta-35, asks.md, delete this
  file, Ollama slices) remain THE MANAGER'S - the builder did not touch them.

## ▶ 2026-08-26 RE-PAUSE (manager session, cap hit again at 85% five_hour, resets 05:10 ET)

State when the cap tripped:
- A **fable-executor builder was IN FLIGHT** on this slice (dispatched from this session,
  brief = this file verbatim + process rules). It had already made real edits: peer session
  getforgenta-35 snapshot-verified `npx tsc --noEmit` clean and a new
  `extrasPayoffReadout` test file 3/3 green mid-flight. **NOT committed. The builder was
  presumably killed/blocked by the same cap — check `git status` on resume; its
  uncommitted edits are the slice's work-in-progress, do NOT discard them.**
- Peer session getforgenta-35 also resumed this slice after the reset, spotted the
  collision, stood its builder down with ZERO edits (verified by them), did a read-only
  review of OUR in-flight diff, and reported **two findings to fold in BEFORE commit**:
  1. **REAL GAP:** the second-line gate in DebtPayoff.tsx is "ranked
     (surplus_sort_order != null) + engine payoff strictly earlier than scheduled", not
     "actually received waterfall money". Engine amortizes the ACCOUNT balance while the
     on-screen scheduled months amortize the debts-row balance; if those diverge, a ranked
     debt receiving $0 extras can still show the line. Close: additionally gate on the
     debt actually receiving extras via `buildAutoExtraByTarget(projections.data)`
     (src/lib/auto-extra-projection.ts).
  2. **COSMETIC:** `withExtrasPayoffMonths` pairs accounts with
     `account_type !== 'credit_card'`, looser than the engine's liability-type set; worst
     case the line hides (undefined lookup), not a wrong number. Tighten if cheap.
  Peer said it will NOT touch the tree; the slice is ours. Peer offered to update asks.md
  and delete this file once we commit — **we are handling both ourselves; on resume,
  message getforgenta-35 (SendMessage) that this session owns asks.md + file deletion.**
- **Tre's new directives this turn (2026-08-26, verbatim intent):** (a) "start local host
  8080 if you need it" — DONE, `node scripts/dev-session.mjs up` completed exit 0, dev
  server should be at http://localhost:8080 (the only canonical origin); (b) "start
  having fable plan then give it to an ollama executor to do the work, the[n] review.
  why are we not operating like the workflow i said before." — ANSWER GIVEN IN THE PAUSE
  LINE, and the standing routing still holds per his own 2026-08-25 ladder: THIS slice is
  engine/money-tier so it correctly went to the strongest executor (Ollama never gets
  engine/money work). But the message means Ollama-primary is UNDER-USED: on resume,
  route the next mechanical/cheap-to-verify slices Fable-plan → Ollama-draft →
  Fable-review-and-apply, and SCORE each into ~/.claude/ollama/playbook.md. Candidates:
  copy/doc slices, useOnboardingStatus 'pending' unbounded (small, verifiable), NOT
  DebtPayoff 390px truncation (collides with this slice) and NOT pollAppReady (it lives
  in ios/App/App/AppDelegate.swift — Swift w/o toolchain, wrong shape for Ollama).

RESUME ORDER: 1) git status — inspect builder's uncommitted diff; 2) fold in peer finding
1 (the buildAutoExtraByTarget gate) + finding 2 if cheap; 3) finish the original brief
below (tests, gates, backup-before-further-edits, local commit w/ Release-Note trailer,
NEVER push); 4) message getforgenta-35; 5) flip asks.md line and delete this file; 6)
start the Ollama-workflow slices.

---

(original brief + first pause's investigation below — still the build spec)

Status: **PAUSED, no code edited yet.** Hit the 85% five_hour usage cap mid-investigation,
before any Write/Edit to a repo source file. Repo is clean — only the pre-existing foreign
untracked `src/lib/__tests__/zz-tmp-diagnostic.test.ts` (leave alone, another session's file).
Nothing to back up, nothing to commit for this slice yet.

Do NOT fold this into the main `handoff.md` by hand — just delete this file once its content
is either done or copied into the real handoff at the next natural boundary.

## The two-part task

### Part 1 — AUDIT (DONE, reported to manager, no code changed)
Manager accepted the audit. Full per-surface table was reported in-chat (not saved to a file);
short version: every "extra payment" mechanism (vehicle loan lump sums, credit-card payment
pins via `withPaymentOverrides`, ranked auto-extra waterfall) is correctly wired everywhere
EXCEPT the ranked auto-extra is deliberately excluded from the "committed schedule" views
(DebtPayoff's Auto Loans/Mortgage/Student/Other tabs, Vehicles.tsx) — tested
(`forecast-engine.autoExtraLiability.test.ts:162-169`) and disclosed via `nonCcDebtExplainer`
copy. Red-months enumeration on the real `forecast-inputs.real.json` (2026-07-20 capture) found
ZERO red months Sep2026-Dec2028 with current HEAD (incl. the floor-min-latch `616f9275`) —
tightest cushion $1.08 in Jun 2027. Does not match Tre's live "lots of red after Aug 2027";
most likely the fixture is stale vs his current live data. Flagged, not fabricated.

### Part 2 — FOLLOW-UP BUILD (manager's decision, IN FLIGHT, not started)

**Manager's brief, verbatim goal:** on /debt's non-CC tabs (Auto Loans, Mortgage, Student,
Other) add a secondary "with extra payments" payoff readout next to the scheduled one —
visible ONLY when it differs from the scheduled date (debt is ranked and actually receives
waterfall extra, or has lump sums beyond the scheduled view). Scheduled line unchanged.
Source of truth: forecast engine's EXISTING per-debt monthly balance arrays that already feed
`row.nonCCLiabBreakdown` / `row.carLoanBreakdown` (already extra-aware per the audit). Payoff-
with-extras month = first month that array hits (effectively) zero. NO second math path, no UI
re-run of the waterfall. If not exposed to /debt yet, thread through `CardProjectionContext`
(the d15b7ab9 three-new-context-fields precedent). Respect whatever dust threshold the
reducers already use — don't invent one.

Also: reword `nonCcDebtExplainer` (DebtPayoff.tsx:186-190) to describe the two lines instead
of pointing users away to Goals.

Tests: pin the wiring (ranked liability with auto-extra → with-extras payoff strictly earlier
than scheduled; unranked debt → scheduled line only). Gates: tsc clean, npm test quoted
(baseline 271/2731 + new). Backup modified files to `./backups/<timestamp>/` first. Commit
locally with a customer-visible `Release-Note:` trailer. NEVER push. Don't touch
floor-min-latch machinery or Vehicles.tsx; leave `zz-tmp-diagnostic.test.ts` alone; no
`git add -A`.

## What I'd traced before the cap hit (read-only, verified, no edits)

**Non-CC liabilities (mortgage/student/other) — the array IS already keyed by id, ready to use:**
- `src/lib/non-cc-liabilities.ts`: `buildNonCCLiabilities()` returns `NonCCLiabilities.rows:
  NonCCLiabilityRow[]`, each `{ id, name, account_type, balances: number[] }` — one row per
  liability ACCOUNT id, full `PROJECTION_MONTHS`-length balance array, index 0 = current month.
- `src/lib/forecast-engine.ts:875-891`: `autoExtraLiabilities` is built by mapping
  `buildRankableLiabilities(...)` and attaching `balances: nonCCLiabilities.rows.find(r => r.id
  === l.id)?.balances` — a **shared reference**, not a copy.
- Confirmed by the file's own comment (`forecast-engine.ts:862-865`): this shared reference is
  exactly what makes `row.nonCCLiabBreakdown`, the liability total, and next month's ranking
  capacity all agree — the auto-extra loop (`forecast-engine.ts:1652-1662`,
  `nonCCDebtBalanceByMonth[j] -= before - after`) mutates these arrays IN PLACE.
- `ForecastMonthRow.nonCCLiabBreakdown: { id: string; name: string; account_type: string;
  balance: number }[]` (forecast-engine.ts:91) — HAS an `id` already. So the full 60-month
  array for a given liability id can be reconstructed either by (a) exposing
  `nonCCLiabilities.rows` (or a `Map<string, number[]>` built from it) directly on the
  `ForecastResult`, or (b) mapping `projections.data.map(r => r.nonCCLiabBreakdown.find(x => x.id
  === id)?.balance)` across all 60 rows. (a) is cleaner and matches "don't build a second math
  path" — prefer exposing the map directly rather than re-deriving it row-by-row in /debt.

**Car loans — the array exists but is NOT currently keyed by id at the row level, only by name:**
- `loanBalancesByFundId: Map<string, number[]>` (forecast-engine.ts:663, populated ~696) IS
  keyed by `car_funds.id` and IS the shared-reference array the auto-extra loop reduces
  (`carLoanBalanceByMonth[j] -= before - after`, forecast-engine.ts:1863-1873). This is exactly
  what's needed.
- BUT the row-level export `ForecastMonthRow.carLoanBreakdown: { name: string; balance: number
  }[]` (forecast-engine.ts:92) has **no `id` field** — only `name` — built from `carLoanPerFund:
  { name: string; balances: number[] }[]` (forecast-engine.ts:653, pushed ~695), which ALSO
  has no id, and is only pushed `if (fundBalances.some(b => b > 0))` (drops a fund once its
  balance goes flat-zero, i.e. name-matching across months is fragile once paid off).
- **Conclusion reached before the cap:** don't try to match `carLoanBreakdown` by name across
  60 rows. Instead expose `loanBalancesByFundId` (already keyed correctly, already the reduced
  array) directly — this is the "thread it through CardProjectionContext" case the manager
  anticipated. `carLoanPerFund`/`carLoanBreakdown`'s `name`-only shape is pre-existing and out
  of scope to change (it feeds the popup/export, which isn't being touched here).

## Not yet done (next session picks up here)

1. Decide exact plumbing: does `calculateForecast` (or its `ForecastResult`) need two new
   fields — e.g. `nonCCLiabilityBalancesById: Map<string, number[]>` (straight from
   `nonCCLiabilities.rows`) and `carLoanBalancesByFundId: Map<string, number[]>` (straight from
   `loanBalancesByFundId`, which ALREADY EXISTS as a local — just wasn't returned)? Both are
   zero-new-math, pure exposure of existing arrays. Check `ForecastResult` type definition
   (near `calculateForecast`'s return statement, search `export interface ForecastResult` in
   forecast-engine.ts) before adding fields.
2. Had NOT yet traced: how `useForecastProjections()` (the hook Forecast.tsx calls) relates to
   `CardProjectionContext` — is `calculateForecast` run INSIDE `CardProjectionContext` already
   (so DebtPayoff could read a forecast result off the same context DebtPayoff already
   consumes), or only inside `useForecastProjections` which Forecast.tsx calls separately? This
   determines whether "thread through CardProjectionContext" means (a) CardProjectionContext
   needs to start running `calculateForecast` itself and expose the two new maps, or (b) a
   lighter hook/selector needs to be added that DebtPayoff can call independently, still
   fed by the SAME per-debt arrays (no second math path either way — the arrays themselves are
   the single source regardless of which hook exposes them).
   NEXT STEP: `grep -rn "useForecastProjections\|calculateForecast" src/contexts/
   CardProjectionContext.tsx src/hooks/useForecastProjections.ts src/hooks/
   useForecastEngineInputs.ts` — this was the exact command queued when the cap hit.
3. Once plumbing is decided: add the two maps to whatever's exposed to DebtPayoff.tsx, compute
   "first month balance <= 0 (or whatever tolerance the reducers already imply — checked: the
   liability/loan reducers use `Math.max(0, before - amount)`, i.e. EXACT zero, no dust
   tolerance like the CC engine's `REVOLVING_DUST_DOLLARS` — so use exact `<= 0`, not an
   invented threshold) vs the scheduled payoff month (`calculatePayoffMonths` / the
   `buildAmortizationSchedule` result already on screen)", render the secondary line only when
   the two months differ, and reword `nonCcDebtExplainer`.
4. Write the two pinned tests (ranked-and-earlier / unranked-scheduled-only), matching the
   style of `forecast-engine.autoExtraLiability.test.ts` and
   `ranked-extra-payment-targets.liability.test.ts`.
5. Backup touched files under `./backups/<timestamp>/`, run gates, commit locally with a
   `Release-Note:` trailer, report per-tab before/after + test names + gate lines + commit sha.
   NEVER push.

## Files read (no edits) this slice
- `src/lib/non-cc-liabilities.ts` (full)
- `src/lib/ranked-extra-payment-targets.ts` (full)
- `src/lib/forecast-engine.ts` (multiple ranges: ~55-111 type defs, ~645-900 non-CC/car-loan
  build, ~1540-1930 the monthly loop, ~2000-2120 row assembly)
- `src/pages/DebtPayoff.tsx`, `src/pages/Vehicles.tsx`, `src/pages/Forecast.tsx` (full, from
  the audit phase)
- `src/components/forecast/MonthlyBreakdownTable.tsx`, `src/components/dashboard/
  DebtRecommendationsWidget.tsx`, `src/components/debt/CreditCardEngine.tsx` (targeted sections,
  audit phase)
- `src/lib/month0-debt-breakdown.ts`, `src/lib/auto-extra-projection.ts` (full, audit phase)
- Tests read for pattern-matching: `forecast-engine.autoExtraLiability.test.ts`,
  `auto-extra-chart-wiring.test.ts`, `forecast-convergence.realData.test.ts`,
  `fixtures/projection-harness.ts`

## Gates last run (end of Part 1, before Part 2 started) — for reference, unaffected by the pause
- `npx tsc --noEmit` → clean, 0 errors
- `npm test` → `Test Files  271 passed (271)` / `Tests  2731 passed (2731)`
No files were modified since, so these are still the true current state of `main`.
