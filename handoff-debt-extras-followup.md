# Handoff — "extra payments" follow-up build (paused on usage cap)

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
