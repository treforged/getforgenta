# Handoff — 2026-07-11 (session 2) — branch main — Discover "2yr+ payoff" REPRODUCED, root cause narrowed to save-up look-ahead

## STATUS: symptom reproduced with LIVE data, root cause narrowed. NO code changed yet. NO backup needed yet.

## The task
User reports Discover CC pays off ~2yr+ out (Jun 2029) on Debt Payoff ETA + Forecast, "when there
is definitely extra cash on hand next year." Regression. Prior session (session 1) verified deploy
is current (cc6d7cbc live), merge is NOT the cause, and the STALE 2026-07-03 fixture shows GOOD
behavior. Session 1 was blocked on "cannot reproduce without fresh data."

## SESSION 2 BREAKTHROUGH — reproduced via live screenshots + pulled the real data

### 1. Symptom CONFIRMED (5 live screenshots this session)
Forecast monthly breakdown: ending cash BALLOONS while debt persists —
Jul 2026 $2,800 → Oct 2027 $13,445 → Dec 2027 $15,995 → Mar 2028 $18,087. Meanwhile CC balance
still $13,951, PAYOFF ETA 36 mo, "CC Debt Free" not until Jun 2029. Cash floor is only $2,800.
CC "-OUT" per month sits at ~$568–$706 (≈ minimums) across 2027–2028 — payments are NOT scaling
up to consume the surplus. This is the "hoard cash instead of pay Discover" bug.
NOTE: the "+pmt $150" tag on Forecast rows is a CAR-LOAN extra payment (see car_funds
lump_sum_payments Oct 2027–Sep 2029), NOT a CC payment. Red herring — ignore it for the CC bug.

### 2. Live data pulled from Supabase (project mdtosrbfkextcaezuclh, user a72f416e-433a-4055-9ab0-9feae4e60edf)
Engine source of truth is the `accounts` table (NOT `debts`, which is legacy for mortgage/auto).
Credit cards (accounts, account_type='credit_card'), total = $13,951.24 (matches screenshot):
- Prime Visa:  bal $5,701.91, APR 27.49, pref 'full', min $0 (manual), due 7, statement_balance NULL
- Discover it: bal $8,249.33, APR 19.49, pref 'full', min $217, due 1, statement_balance NULL
- Apple Card:  bal $0, APR 22.99, pref 'statement', card_start_date 2028-02-28 (future card)
- Venture X:   bal $0, APR 22.99, pref 'statement', card_start_date 2026-12-20 (future card)
car_funds: ONE fund "2004 Chevrolet C5", phase='loan' ALREADY (planned_purchase_date 2026-06-21,
BEFORE projection start Jul 2026 → NO future car purchase to save up for). loan_amount $16,530,
actual_monthly_payment $422.89, monthly_insurance $173.23, plus 24× $150 monthly lump_sum_payments
Oct 2027→Sep 2029. savings_goals: all small monthly contribs, NO target_date → not a save-up trigger.

### 3. Hypotheses DISPROVEN this session (do not revisit)
- "Discover excluded from surplus router via the `revBal0===0` gate (forecast-engine.ts:1083)":
  DISPROVEN. autopayFullBalance = simBalance<=0 (credit-card-engine.ts:240-241), simBalance =
  statement_balance ?? balance. Discover statement_balance is NULL, balance $8,249>0 →
  autopayFullBalance=FALSE → REVOLVING → revBal0≈8249 (nonzero) → INCLUDED in ccEngRevBalEnd.
  So the surplus gate is NOT the problem.

## ROOT CAUSE (high-confidence, NOT yet proven by running the engine) — START HERE
The debt payment is capped near minimums (~$570/mo) across 2027–2028 by the SAVE-UP look-ahead
(`maxDebtPaymentByMonth`). The Forecast tooltip (Forecast.tsx:386) describes exactly this behavior:
save-up months pay only minimums and let cash accumulate above floor.

Mechanism: `computeFloorProtection` (src/lib/floor-protection.ts):
- Backward pass L100-104: `reserveNeeded[m] = max(0, nextFloor + reserveNeeded[m+1] - endBalAtMin)`
  — this ACCUMULATES backward. A run of consecutive future months that each fall short (even paying
  only minimums) compounds reserveNeeded into a large phantom reserve.
- L177-186: whenever `reserveNeeded[m+1] > 0` and the month's end-bal-at-min < requiredEndBal, month
  m is added to saveUpMonths AND strictSaveUpMonths, capping its debt payment (maxDebtPaymentByMonth).
Suspected trigger: a genuine floor breach exists (Feb 2027 milestone "cash below safe minimum" is
shown), and/or later structural tightness (car loan $422.89 + insurance $173.23 + $150 lumps +
CC mins). reserveNeeded back-propagates from those months across the whole 2027–2028 span, marking a
long contiguous strict-save-up block → payments stuck at minimums → cash balloons to $18k → Discover
drags to Jun 2029. The reserve is wildly over-estimated (real cash is $18k), which is the bug's tell.

## NEXT STEP — PROVE IT (decisive, do this first)
Run the engine on the REAL data and dump, per month: `saveUpMonths`, `strictSaveUpMonths`,
`maxDebtPaymentByMonth`, `reserveNeeded`, per-card `monthlyRevolvingBalances`, per-month debtPayment
+ endingCash. Confirm: are 2027–2028 months in strictSaveUpMonths with maxDebtPaymentByMonth ≈ ccMin?
Options:
- (a) Build a fixture from the Supabase rows above + run the realData harness (see session-1 notes
  below). Heaviest but self-contained.
- (b) Add a temp unit test that calls `computeFloorProtection` directly (exported from
  floor-protection.ts) with a hand-built floorByMonth/endBalAtMin series approximating this data, to
  see reserveNeeded back-propagation. Lighter, targets the suspected function directly.
- (c) claude-in-chrome on the user's live logged-in Forecast tab to capture ForecastInputs
  (serializeForecastCapture in src/lib/__tests__/fixtures/forecast-fixture-io.ts).
Once proven, the fix is almost certainly in floor-protection.ts (reserveNeeded accumulation and/or
the strictSaveUp gate over-firing when cash is actually abundant). Do NOT patch the display — fix the
reserve math. Preserve the legitimate save-up-before-a-real-breach behavior (e.g. the genuine Feb
2027 breach).

## Key file/line anchors
- src/lib/forecast-engine.ts:1081-1105 — PASS-3 surplus router (sets revolvingDebtCashTarget; gate at
  1087 `ccEngRevBalEnd>0 && finalLiquid>monthMinSafe`; deficit branch 1090-1104). Confirmed NOT the bug.
- src/lib/credit-card-engine.ts:240-241 — autopayFullBalance = simBalance<=0 (revolving vs cycling).
- src/lib/credit-card-engine.ts:688-697 — maxDebtPaymentByMonth cap semantics (the save-up cap).
- src/hooks/useCardProjection.ts:836-1028 — runLookAhead + 3-pass outer refinement builds
  maxDebtPaymentByMonth/saveUpMonths/strictSaveUpMonths; destructured at 1028.
- src/lib/floor-protection.ts:76-198 — computeFloorProtection (reserveNeeded backward pass +
  save-up marking). PRIME SUSPECT.
- src/hooks/cardProjectionResim.ts:126-150 — applies saveUpMonths cap in resim.

## Session-1 diagnostic harness (still valid)
Copy renderHook block from src/lib/__tests__/forecast-convergence.realData.test.ts into a temp
src/lib/__tests__/discdiag.tmp.test.ts (@vitest-environment jsdom, fake Date pinned to capturedAt).
Run runDebtCashConvergence(base!, inputs, { engine, maxPasses: 20 }). writeFileSync JSON to scratchpad
(console.log is swallowed). DELETE the temp test after (must not ship — lives in src/).
Fixture src/lib/__tests__/fixtures/forecast-inputs.real.json is gitignored and STALE (2026-07-03,
shows GOOD behavior). Must rebuild from the live data above to reproduce.

## Anchors / rules
- HEAD = cc6d7cbc on main = live. Full suite 43 files/163 tests green, tsc clean (as of session 1).
- Never push without explicit ask. Cash floor $2,800. Back up any file before editing to ./backups/.
- Debt result type fields: src/lib/debt-model-types.ts (perCardPaymentsScaled L47,
  monthlyRevolvingBalances L48, forecastRevolvingPayoffMonth L91).
