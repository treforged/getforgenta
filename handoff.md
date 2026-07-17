# Handoff — 2026-07-16 — main — Q9 offline-RESOLVED, live verification pending

## Q9 (user-reported): Discover doesn't pull back for PV's mandatory ISB pin / cash floor

User: "discover doesnt pull payments back enough for prime visa to always pay its full
interest saving balance and maintain cash floor in future months. primes interest saving
balance is a non negotiable."

## STATUS: fixed offline, full suite GREEN (190/190). Remaining: live verify + cleanup.

## Root cause (two layers, both fixed)

Convention: end-of-month cash IS next month's pre-paycheck cash, so endCash[m] must be ≥
monthMinSafe[m+1]. Three places drained cash to only the CURRENT month's floor, so every
bill-timing floor step-up month started below its own floor, with Discover (avalanche
discretionary recipient) absorbing the over-drain:

1. `floor-protection.ts` forward pass — fixed LAST session (committed 4e465a2a): cap now also
   fires when `nextFloor > mFloor`.
2. `credit-card-engine.ts` Step 5 (~line 1345): availableCash now subtracts
   `step5Floor = max(effectiveFloor[m], cashFloorByMonth[m+1] ?? cashFloor)` (fixed THIS session).
3. `forecast-engine.ts` PASS-3 Step 3 (~line 1119): surplus branch drains only down to
   `step3SpendFloor = max(monthMinSafe[i], monthMinSafe[i+1])`, and the deficit branch is now
   keyed to the SAME step3SpendFloor (was hard cashFloor only) — this was the residual-breach
   fixer: an overpaying month landing in the old buffer zone (cashFloor..monthMinSafe) was a
   convergence fixed point with nothing pulling the target back. Both branches now push toward
   one shared threshold; the old "monthMinSafe-keyed deficit breaks convergence" comment predates
   adaptive damping + stable-raw shortcut and no longer holds (12/18 passes on live fixture).

## Result on live 07-16 fixture (q9 diagnostic)

converged 12 passes; milestones []; endCash-below-NEXT-floor months: NONE (was m2..m11, up to
−$777 pre-fix); PV pin $1,164.79 (Aug 2026) paid in full; Discover absorbed all pull-back;
months pin endCash exactly to max(floor, nextFloor) (m5/m8 Δ0). Q5–Q8 acceptance intact:
full lib+hooks suite 190/190 green (goldenTierA, manualISB, promoParity, revolvingDustPayoff
all unchanged — no baseline re-pin needed).

## Regression fallout fixed (same session)

`useCardProjection.carLoanActivationDiscontinuity` failed — CAUSED BY LAST SESSION'S committed
floor-protection change (verified by stash), surfaced now: `getAugmentedMinSafeCash`
(pay-schedule.ts ~781) included the car-loan payment in the floor ONLY for phase==='loan', so
saving- vs loan-phase floors diverged and the next-floor-aware caps propagated that into
different month-0 payments. Fix: saving-phase cars with payment_start_date synthesize the same
frozen loan-phase record activation produces (loan_amount ← getLoanPrincipal, loan_start_date ←
planned_purchase_date, interest_start_date ← payment_start_date, actual_monthly_payment 0) and
run through getActiveCarLoanPayments — parity by construction. Probe confirmed saving ≡ loan
allPaymentTotals at EVERY month now (0.00 diff). Test 2's exact-$493.60 gap assertion was an
artifact of the old asymmetry — updated to a band (payment..payment+insurance) with comment.

## Files changed (uncommitted at handoff-write time; committed with this handoff)

- src/lib/credit-card-engine.ts — Step 5 step5Floor (backup backups/2026-07-16_202000/)
- src/lib/forecast-engine.ts — PASS-3 surplus+deficit step3SpendFloor (backup same folder)
- src/lib/pay-schedule.ts — getAugmentedMinSafeCash saving-phase projected loan (backup same folder)
- src/hooks/__tests__/useCardProjection.carLoanActivationDiscontinuity.test.ts — band assertion
- src/lib/__tests__/q9-diagnostic.isbPullback.test.ts — untracked diagnostic, added nextFloor Δ
  + endCash-below-NEXT-floor summary line (keep until Q9 live-verified, then delete or promote)
- src/pages/BuildShare.tsx — PRE-EXISTING user modification, NOT part of Q9, do not commit/revert

## NEW USER REPORT (2026-07-16, post-fix, live): "a couple of months miss cash floor by pennies"

User is logged into localhost and sees a couple of months missing the cash floor by pennies.
NOT yet reproduced offline — investigate FIRST (fresh session), then fix.

Working hypothesis (unverified): convergence toleranceDollars=1 (forecast-convergence.ts:48)
stops the loop with sub-dollar residue, and BOTH PASS-3 branches now pin finalLiquid EXACTLY at
step3SpendFloor (forecast-engine.ts ~1122) — so fixed points can land cents below the floor.
Candidate fix (designed, NOT implemented): asymmetric cushion in PASS-3 —
  surplus fires when finalLiquid > step3SpendFloor + CUSHION (drain to floor+CUSHION),
  deficit fires when finalLiquid < step3SpendFloor (pull back to floor+CUSHION),
  CUSHION ≈ $1–2 (≥ toleranceDollars) creating a dead zone [floor, floor+CUSHION] where neither
  fires — stable, and residue can never land below floor. Pin months (NaN target) rely on
  engine caps from the floor-protection walk — if the penny misses are in PIN months the walk
  cap needs the cushion instead.

Diagnosis notes gathered so far:
- endingCash is Math.round(finalLiquid + cumulativeCarReserveHeld) (forecast-engine.ts ~1251)
  and monthMinSafe is rounded too — the Forecast table shows whole dollars, so FIRST find out
  exactly WHERE the user sees pennies (milestone text? Debt page? floor-item popup with cents?
  ask user or check UI formatting) — the milestone check (~1295) compares ROUNDED endingCash to
  cashFloor, so a true sub-dollar breach may round invisible or a $0.49 breach shows as equal.
- The q9 diagnostic's breach summary uses rounded row.endingCash — pennies invisible there;
  add unrounded finalLiquid capture (or lower the flag threshold and print raw liquidCash which
  is Math.round'ed too — may need a new debug field or use __convergenceDebug live capture).
- May need a FRESH live fixture capture — user's data may have changed since the 07-16 fixture.

## NEXT STEPS

1. Investigate + fix the penny-miss report above (user is already logged into localhost —
   capture __convergenceDebug.convergedProjection and a fresh fixture if needed).
2. Live-verify Q9 on localhost:8080 /debt + /forecast (dev server): no "Cash below safe minimum"
   milestone, PV ISB pin month funded, Discover pulled back, endCash ≥ next month's floor in
   Forecast table. Use `window.__convergenceDebug.convergedProjection` (NOT `__simDebug.raw`).
2. After live confirm: delete q9-diagnostic test (fixture is gitignored) or keep as skip-if-no-
   fixture regression; consider promoting a synthetic Q9 regression test (floor step-up month +
   ISB pin → no next-floor breach).
3. Q10 candidate still open (from Q8): engine-layer revolving dust nulls
   simRevolvingPayoffMonth/forecastRevolvingPayoffMonth, likely suppresses CC Debt Free
   milestone — dedicated session, fixture recapture.
4. Minor parity gap noted in handoff Q9 map: useCardProjection.ts ~997 hook ccMinByMonth does
   not include ISB pins (engine's does) — optional base-pass fidelity fix, not blocking.

## Diagnostic harness

`src/lib/__tests__/q9-diagnostic.isbPullback.test.ts` — run:
`npx vitest run src/lib/__tests__/q9-diagnostic.isbPullback.test.ts --disable-console-intercept`
Fixtures: forecast-inputs.real.live-2026-07-16.json + payment-plans fixture (gitignored),
funding id 933cbc10-bceb-4c20-8227-4a02e6db728a. Fixture cards: PV $6,041 rev / Discover
$8,015 rev.

## GOTCHAS (carry forward)

- `window.__simDebug.raw` is PASS-0, not converged; use `__convergenceDebug.convergedProjection`.
- `cp.cards[].id` empty on converged projection — look up via perCardPayments by name.
- Debt page is `/debt`; dev server localhost:8080 (DEV server, not prod).
- vitest: `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored (`forecast-inputs.real*.json`). Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Live capture's maxDebt "0"s are JSON-serialized Infinity — not real zeros.
- Harness needs paymentPlans + persistedDebtFundingId overrides to match live (see Q7).
