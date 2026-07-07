# Handoff — 2026-07-07 — branch debt-model-fixes-p0

## Goals
1. ~~Live-verify manual-min flag~~ — **DONE this session, passed** (details in Current State).
2. **Forecast-popup CC balance mismatch** (user report): "on Forecast pop-ups, CC balances do
   not match what's on the Debt Payoff tab." User compared **Discover + Prime, Sep 2026**.
   Definition of done: the Forecast month popup's per-card CC balances and the Debt Payoff
   accordion/chart agree for the same month, without regressing the ETA or row reconciliation.
   **Diagnosis is COMPLETE (root cause found, verified with live numbers). No code edited yet.**
   Plan needs user confirmation before edits (per feedback memory + CLAUDE.md ambiguity rule).

## Current State
- No source changes this session — investigation only. Working tree should be clean apart from
  this handoff (verify `git status`).
- Manual-min live-verify PASSED: /debt Prime Visa MIN PAYMENT $0 (Discover $213, Venture X/Apple
  $25 floors intact, ETA 13 mo Jul 2027); /accounts Prime edit modal shows Minimum Payment 0 +
  "I set this minimum manually" CHECKED. Modal closed without saving. Nothing left to do on this.
- Dev server running at localhost:8080. Chrome MCP tab was tabId 1527577537 (stale next session —
  re-fetch tabs_context).

## Repro numbers (Sep 2026, captured live this session)
- Forecast popup (/forecast → 2026 → click Sep 2026 row):
  Prime Visa **$3,901**, Discover **$6,377**, Total CC $10,277.
  Popup payments: Prime $1,260, Discover $280.
- Debt Payoff accordion (/debt → expand card → year 2026):
  Prime Sep end balance **$4,270** (payment -$860, "+$98 surplus redirect" line),
  Discover Sep end balance **$6,377** (payment -$213).
- So: **Discover matches exactly; Prime is off by $369** (popup lower).

## Root cause (confirmed)
Forecast and DebtPayoff share ONE sim (CardProjectionContext → useCardProjection →
simulateVariablePayoff). The gap is display-layer: Forecast PASS-3 routes surplus cash above the
floor to revolving debt beyond the sim's plan (`cumulativeStep3Extra`, `src/lib/forecast-engine.ts`
~1140-1190, emitted per-row as `revolving3Extra` at line 1408 — note it is CUMULATIVE).
- The Forecast popup (`src/pages/Forecast.tsx:1084-1116`) subtracts that cumulative extra from
  card balances via its own inline avalanche cascade (Prime first, highest APR 27.49%) → Prime
  shows simBal − $369. `src/lib/forecast-export.ts:getCreditCardBalances` mirrors the popup but
  WITHOUT the adj subtraction (already inconsistent with the popup it claims to mirror!).
- Debt Payoff (`src/components/debt/CreditCardEngine.tsx` projections ~line 870-914, chart ~916)
  shows the RAW sim monthlyBalances. Its accordion already shows per-month "+$X surplus redirect"
  lines from `perCardPaymentsScaled[].surpluses` (CreditCardEngine.tsx:1642,1683) but does NOT
  subtract them from End Balance.
- THREE different derivations of the same "pass-3 extras" exist and disagree numerically:
  (a) forecast-engine `cumulativeStep3Extra` → $369 by Sep;
  (b) useCardProjection `extraPerCardByMonth`/`surpluses` (useCardProjection.ts:1449-1465) →
      visible Prime redirects only $112 (Jul) + $98 (Sep) = $210 by Sep;
  (c) the popup's payment lines scale raw per-card payments to row.debtPayment (Prime $1,260 vs
      sim $860). Why (a) ≠ (b) is NOT yet explained — investigate before choosing a fix.
- useCardProjection ALREADY builds `forecastAdjustedRevolvingBalances` (useCardProjection.ts:
  1467-1482, exported at 1726) = sim balance minus cumulative per-card extras — built exactly
  for this unification.

## Failed Attempts (do NOT repeat blindly)
- **DebtPayoff previously consumed forecastAdjustedRevolvingBalances as a display overlay and it
  was REVERTED** — see comment at `src/pages/DebtPayoff.tsx:35-40`: subtracting surplus from
  displayed balance WITHOUT a matching payment line made balances drop faster than the shown
  payment, flatlined paid-off cards at $0 while payments continued, and resurfaced a phantom ETA
  tail. Any fix that adjusts DebtPayoff balances MUST also adjust the shown payments so rows
  still reconcile (End = Start + purchases + interest − payment).
- CreditCardEngine.tsx:870-875 comment: mixing pass-3-scaled payments with raw sim balances broke
  reconciliation before. Whatever is displayed must be one consistent model.
- All prior gotchas from earlier handoffs still apply: Supabase rows must filter
  user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'; simulateVariablePayoff params are positional
  (new ones go at END); auto-mode permission classifier needs the user's CURRENT message to
  authorize prod actions; browser `find` MCP tool burns the user's claude.ai rate limit — prefer
  screenshots+coordinates.

## Candidate fix directions (present to user, pick ONE)
A. **Adjusted-consistent display on both tabs**: reconcile derivation (b) with (a) (find why $210
   ≠ $369 — likely the `simRevTotal <= 0` skip in useCardProjection.ts:1453 drops extras in months
   where the sim planned $0 revolving, or save-up/strict months differ), then show
   forecastAdjustedRevolvingBalances AND matching scaled payments (perCardPaymentsScaled incl.
   surpluses) together in BOTH the popup and the DebtPayoff accordion/chart. Honest but touches
   the previously-reverted territory — needs the matching-payment fix that the reverted attempt
   lacked.
B. **Raw-sim display on both tabs**: popup drops its adj subtraction (and payment scaling note
   stays); both tabs show raw sim balances. Smallest diff, but then popup balances won't reconcile
   with popup's own (pass-3-scaled) payment lines, and Forecast's Total CC Balance line
   (ccDisplayBalance, which IS step-3-adjusted via forecast-engine.ts:1184-1185 adjCCLiab) would
   disagree with its own per-card lines. Probably unacceptable.
C. Defer to the full convergence rework (feed pass-3 back into the sim) — previously attempted
   and reverted repo-wide (see memory project_cycling_debt_engine); a dedicated-session task.
Recommendation drafted last session: A, scoped to display + derivation unification, TDD'd against
the real fixture (`src/lib/__tests__/fixtures/forecast-inputs.real.json` — note it's gitignored;
it already snapshots forecastAdjustedRevolvingBalances at line ~6135).

## Active Files (read before editing)
- `src/pages/Forecast.tsx` 1084-1116 — popup per-card balance cascade (the thing users see).
- `src/lib/forecast-export.ts` 149-161 — export mirror, currently missing the adj.
- `src/hooks/useCardProjection.ts` 1449-1482, 1512-1557, 1726 — extras, adjusted balances,
  scaled payments+surpluses, exports.
- `src/lib/forecast-engine.ts` ~1140-1190, 1408 — PASS-3 surplus routing, revolving3Extra.
- `src/components/debt/CreditCardEngine.tsx` 870-941, 1638-1690 — projections, chart, accordion
  rows + surplus-redirect display.
- `src/pages/DebtPayoff.tsx` 35-40 — revert-history comment.

## Changes Made
- None to source. Commits this session: only this handoff commit.

## Next Steps
1. Present the diagnosis + options A/B/C to Tre and get his pick (he was mid-conversation; the
   summary in the final assistant message before /clear covered it — re-confirm if unclear).
2. If A: first explain the (a)≠(b) $369-vs-$210 discrepancy (start at useCardProjection.ts:1450-
   1465 skip conditions vs forecast-engine.ts:1156-1173 gating — compare month-by-month extras for
   Jul-Sep 2026 with a scratch script against the real fixture), THEN write failing tests, then
   implement, then live-verify Sep 2026 popup == accordion.
3. Update session notes at
   `C:\Users\tvonh\Desktop\claudecontext\sessions\2026-07-07_manual-min-flag.md` when wrapping.
4. Unchanged backlog: milestone eyeball on Forecast tab; Transactions.tsx plan-progress
   purchase-date anchoring (minor); 3 activeLoanInsurance test failures (task #11).
