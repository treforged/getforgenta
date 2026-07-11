# Handoff — 2026-07-11 — branch main — Discover payoff "2yr+ out" regression under diagnosis

## Active task (UNFINISHED — resume here)
User reports: **Discover credit card is paying off ~2yr+ out** on BOTH the Debt Payoff page ETA
AND the Forecast chart, on the **deployed live site**, "when there is definitely extra cash on
hand next year." The word "again" implies a regression from previously-correct behavior.

### What is verified so far
1. **Deployment is current.** Production (Vercel prj_rzrXx0dwi717dwKUpOgNJRKod2Ef, team
   team_FKbAQyy6nIKrEuu8DdUV5Y9w) serves commit **cc6d7cbc** (state READY, target production).
   So the user is seeing the LATEST code, which includes all feature work + all 6 Discover fixes.
2. **The merge is NOT the cause.** `git merge-base --is-ancestor ad16ff6b d116e466` = YES: the
   last-good main (ad16ff6b, containing all 6 Discover surplus-routing fixes 88644867..ad16ff6b)
   is an ANCESTOR of the feature branch. So debt-model-fixes-p0 is a proper SUPERSET of old main;
   the `--no-ff` merge dropped nothing (HEAD's 4 overlapping files are byte-identical to the
   feature version, which is correct). Earlier "merge clobbered it" hypothesis was DISPROVEN (my
   `git diff 051da612~6 051da612` used the wrong commit range and misled me).
3. **Stale fixture shows GOOD behavior — does NOT reproduce.** Ran a temp per-card diagnostic
   (pattern below) against the gitignored fixture `src/lib/__tests__/fixtures/forecast-inputs.real.json`
   (capturedAt **2026-07-03**). Result: Discover clears ~month 9 (**Apr 2027**), Prime ~month 11
   (**Jun 2027**), CC Debt Free Jun 2027, converged 5 passes. Cash only piles up AFTER payoff
   (m10 endingCash 5906 → m39 42436). So on 8-day-old data, Discover is NOT far out.

### Root-cause hypothesis (next agent: START HERE)
The trigger is in the user's **CURRENT data** (newer than 2026-07-03), interacting with the
feature-branch engine changes that went LIVE FOR THE FIRST TIME TODAY (income unification
`4d45c27c`, forecast-engine + cycling-model refactor). The 2026-07-03 fixture predates whatever
data condition (new expense / car fund / balance / income change) now pushes Discover out.
**You cannot reproduce without fresh data.**

### NEXT STEP — reproduce with CURRENT data
1. Refresh the gitignored fixture with the user's current state. Options:
   - (a) Browser-console capture on the live Forecast page. No ready snippet exists; capture uses
     `serializeForecastCapture(inputs)` from `src/lib/__tests__/fixtures/forecast-fixture-io.ts`
     (Map/Set-safe). Would need to expose the ForecastInputs (from useForecastEngineInputs /
     CardProjectionContext) on `window` temporarily, or use claude-in-chrome on the user's logged-in
     tab.
   - (b) Pull current rows from Supabase (project **mdtosrbfkextcaezuclh**, user_id
     **a72f416e-433a-4055-9ab0-9feae4e60edf**) and rebuild the fixture. Heavier.
   - NEVER commit the fixture (gitignored). Pin Date via fake timers to capturedAt.
2. Re-run the per-card diagnostic (below) on fresh data. If Discover now clears far out (e.g.
   month 20+) while endingCash sits high with revolving balance still > 0, that confirms the
   engine is hoarding cash instead of routing surplus to Discover — the real bug. Then trace
   surplus routing: `perCardPaymentsScaled[].surpluses`, the step-3 extra routing
   (`cumulativeStep3Extra` now in `src/lib/step3-display.ts` + `forecast-engine.ts`), and the
   avalanche cascade in `src/lib/credit-card-engine.ts` (Step 5).

### Diagnostic harness (reusable — mirrors realData test)
Copy the renderHook block from `src/lib/__tests__/forecast-convergence.realData.test.ts` into a
temp `src/lib/__tests__/discdiag.tmp.test.ts` (@vitest-environment jsdom, fake Date pinned to
capturedAt). Run `runDebtCashConvergence(base!, inputs, { engine, maxPasses: 20 })`. Dump per-card:
`base.perCardPaymentsScaled` (name/payments/surpluses) + `base.monthlyRevolvingBalances.get(id)`
(→ clearsAt = first index ≤ 0.5) and per-month `out.projections.data[m]`
(debtPayment/endingCash/monthMinSafe). writeFileSync JSON to scratchpad (console.log is swallowed).
DELETE the temp test after (it lives in src/, must not persist or ship).

## Completed & shipped THIS session (all committed + pushed to main/live)
- **Sanity pass** on the Feb-breach + income-unification work: tsc clean, full suite green.
  Confirmed Feb m7 income anchor (pay 4408 + bonus 2170 + tax −2410); zero floor breaches.
- **Guard test** `src/lib/__tests__/income-model.test.ts` (6 tests) pinning `computeBonusAndTax`
  invariants (gross-basis bonus, negative/owed tax pass-through, off-month zeroing, non-recurring
  first-occurrence). Commit 5c5556ef.
- **Merged** debt-model-fixes-p0 → main (22caf1f1) and pushed live. Branch also pushed to origin.
- **Dependabot:** untracked backup dependency manifests + gitignored them (commit cc6d7cbc),
  dismissed alert #54 (js-yaml in backups/ — false positive; live root tree already on 4.2.0).
  0 open alerts. Note: dependabot.yml `directory:"/"` only scopes update PRs, not security alerts.
- **Cap fix question answered:** the "incorrect cap fix" was NEVER in the code — only a proposed
  step that was correctly skipped. Live code has only the correct discretionary-only cap
  (`credit-card-engine.ts:1008`, gated by allRevolvingClear). No change needed.

## Anchors
- HEAD = cc6d7cbc on main (= live). Full suite: 43 files / 163 tests green, tsc clean.
- Debt result type fields: `src/lib/debt-model-types.ts` (perCardPaymentsScaled L47,
  monthlyRevolvingBalances L48, forecastRevolvingPayoffMonth L91).
- Never push without explicit ask (user asked this session). Milestone floor uses cashFloor $2800.

## Failed hypotheses (do not revisit)
- "Merge clobbered the 6 Discover fixes" — DISPROVEN (ad16ff6b is an ancestor of the feature branch).
- Reproducing on the 2026-07-03 fixture — shows GOOD behavior; wrong (stale) data, will mislead.
