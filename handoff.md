# Handoff — 2026-07-09 — branch debt-model-fixes-p0 — LIVE REGRESSION under diagnosis, NOT fixed

## THE PROBLEM (user-reported, confirmed live)
User reports cash floor broken several months in a row and debt payoff date pushed much
farther out. Confirmed on live app (localhost:8080/forecast, user is logged in):
- Milestones: "Jul 2026: Cash below safe minimum", "Feb 2027: Cash below safe minimum",
  "CC Debt Free: **Jun 2029**".
- Expected anchor (per memory/prior sessions): CC Debt Free ≈ **Feb 2027**. So payoff slipped
  ~2.3 years and there are consecutive floor-breach months. This is a real, severe regression.

## KEY FINDING THIS SESSION — the obvious suspect is NOT (solely) the cause
Suspected cause was yesterday's commit `89d7b89f` (thread Forecast PASS-2
`maxDebtPaymentByMonth` into `resimulateWithDebtCash` → sim Step 2 cycling-pool cap).
**Tested live: removing that one line (`forecast-convergence.ts` — call
`base.resimulateWithDebtCash(target)` without the second arg) did NOT change the milestones
at all.** Same Jul 2026/Feb 2027 breaches, same Jun 2029 payoff.

⚠️ Caveat: the disable was verified via Vite HMR + fresh navigate + 5s wait; screenshot showed
identical milestones but the chart area hadn't finished rendering. Next session should re-run
this experiment once with a hard reload (Ctrl+Shift+R) to be 100% sure before trusting it.

If the experiment holds, the regression most likely comes from **Stage 3 itself, commit
`0aa04b85`** (engine PASS 3 delegates split to sim's paymentLedger + the Step 2
`allRevolvingClear`/`mDebtCap` cycling-pool cap wired to the HOOK's own look-ahead), possibly
compounded by `89d7b89f`. **Neither commit was ever verified live** — both sessions were
tests-only (156/156 green because the convergence loop's tests use fake engines and the golden
Tier-A test exercises `calculateForecast` alone, NOT the full convergence loop on real data —
that's the coverage hole that let this ship).

## Diagnosis so far (mechanism hypotheses, in likelihood order)
1. **Step 2 cycling-pool cap shorts mandatory statements** (`credit-card-engine.ts:996-1004`,
   added in Stage 3): `computeFloorProtection`'s `maxDebtPaymentByMonth` is a cap on the
   REVOLVING-only payment — the caller models the mandatory cycling statement as an EXPENSE
   (`cyclingPaymentByMonth` folded into `expenseByMonth` in both callers). Applying that same
   number as a cap on the Step 2 cycling/statement pool caps the very statement the look-ahead
   already assumed was paid in full — semantic double-count. Shorted statement → cyclingBacklog
   + interest → backlog debt reappears → `allRevolvingClear` false later → payoff pushed out →
   ballooning minimums → floor breaches. Floored only at ~2% minimums (line 1000), so a large
   statement (e.g. Venture X $2,261) can be cut to ~$45.
2. **PASS 3 ledger delegation feedback loop** (Stage 3): engine `monthDebtPayment` =
   `paymentLedger[i].total` from the sim; if the sim underpays (per #1), the engine's
   `revolvingDebtCash` target drops, next convergence pass feeds the lower target back —
   a mutually-consistent LOW-payment fixed point can "converge" (gap ≤ $1) and get published.
   Minimums-forever is a very stable fixed point.
3. `89d7b89f` may worsen #1 by swapping the hook's cap for Forecast's (different data model,
   finite caps in more months), but per the live experiment it is not the primary cause.

## How to correct (next session, IN ORDER)
1. Re-verify the one-line-disable experiment with a hard reload (see caveat above).
2. Bisect live: `git stash`-free tree; temporarily check out `cb3ecf25` (pre-Stage-3 handoff
   commit — Stage 2 shipped, zero behavior change) vs `0aa04b85` (Stage 3) and compare the
   live milestones at each. Dev server picks up checkouts via HMR; hard-reload between.
   This pins the regression to Stage 3 vs. earlier definitively.
3. If Stage 3 is confirmed: decide with the user between
   (a) revert both `0aa04b85` + `89d7b89f` (restore known-good, redo Stage 3 with a live-data
   convergence test first), or
   (b) targeted fix: Step 2's cap must NOT bind below the month's mandatory statement
   (`owedByCard` totals) — i.e. floor the cap at full statement owed, not the 2% minimum —
   since both look-ahead models already treat the statement as a non-negotiable expense.
   Option (b) preserves Stage 3's architecture; the 2%-minimum floor choice is the likely
   root defect. But verify against the plan's original intent (the old engine-side PASS 3
   cap it replaced — check what IT floored at) before choosing.
4. Whatever the fix: add a real-data convergence test (fixture `forecast-inputs.real.json`
   through `runDebtCashConvergence` with the real `calculateForecast`, asserting payoff month
   and no post-convergence floor breaches). This exact coverage hole is what let the
   regression ship twice.
5. User keep-alive: they asked to interact with the browser page every ~2 minutes to stay
   logged in while verifying live.

## Current State
- Working tree CLEAN at `eb33cb6f` (handoff commit) + this handoff update. Commits in
  question: `0aa04b85` (Stage 3), `89d7b89f` (cap threading). Nothing reverted yet.
- Dev server running on localhost:8080; Chrome MCP tab 1527577757 is on /forecast, logged in.
- Backups: `backups/2026-07-08_170134/` holds pre-`89d7b89f` versions of the 5 files.
- lean-fix routing applies (fix-shaped task): strongest model owns diagnosis; this is a
  multi-file, high-risk area — plan before coding, per CLAUDE.md.

## Active Files
- `src/lib/credit-card-engine.ts:996-1004` — Step 2 cycling-pool cap (prime suspect), and
  `:1225-1238` (mDebtCap vs mDebtTarget interplay: target overrides cap in Step 5 except month 0).
- `src/lib/forecast-convergence.ts:51-54` — cap threading (the tested-not-guilty line).
- `src/hooks/useCardProjection.ts:742` (runLookAhead), `:885-933` (refinement loop),
  `:1630` (resimulateWithDebtCash).
- `src/lib/forecast-engine.ts:949` (PASS 2), `:116-124` (ForecastResult.maxDebtPaymentByMonth).
- `src/lib/floor-protection.ts` — read in full this session; cap semantics = revolving-only,
  cycling-as-expense (see hypothesis #1).
- `.claude/plan/unify-cycling-model.md` — Stages 4-5 ON HOLD until this regression is fixed.

## Failed Attempts
- Disabling `89d7b89f`'s cap-threading alone (live, via HMR) — no change in milestones.
  (Restored; tree matches committed state.)

## Key anchors
- Never push. Supabase user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- 156/156 tests + tsc clean at `89d7b89f` — green tests do NOT clear this regression (coverage
  hole above).
- Expected-good reference: CC Debt Free ≈ Feb 2027, no consecutive floor-breach milestones.
