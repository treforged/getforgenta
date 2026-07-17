# Handoff — 2026-07-16 (evening) — main — Q9 CLOSED (live-verified) + penny-miss fix shipped

## STATUS: Q9 fully resolved. Penny-level floor-miss report fixed and live-verified.

## What happened this session (commits a7aeb945, 58f24a56)

User report "a couple of months miss cash floor by pennies" — reproduced offline, root-caused,
fixed, live-verified on localhost:8080 /forecast.

Root cause (matched the prior session's hypothesis): the convergence loop stops at a $1
debtPayment tolerance, and every floor-pinning drain targeted EXACTLY the floor, so fixed
points settled cents below it. Rounding in the Forecast table then showed months $1 under
floor (red cell at Forecast.tsx:1128).

Fix — `FLOOR_CUSHION_DOLLARS = 2` (defined in floor-protection.ts), applied at all three
floor-pinning drains so end cash lands at floor+cushion with a dead zone [floor, floor+2]:
1. forecast-engine.ts PASS-3 Step 3: surplus fires above floor+cushion (drains to it);
   deficit fires below floor (pulls back to floor+cushion). Asymmetric — the dead zone is
   the stable landing strip.
2. floor-protection.ts forward pass: requiredEndBal += cushion.
3. credit-card-engine.ts Step 5: step5Floor += cushion for m > 0 ONLY (month 0 stays
   uncushioned so projection ≡ live safe-to-pay recommendation). This fixed the residual
   −$0.39 (Sep 2026) found during live verify — SIM-pinned months bypass PASS-3/caps.

Supporting changes:
- ForecastMonthRow gained `rawEndingCash` / `rawMonthMinSafe` (unrounded) — rounded
  endingCash/monthMinSafe hide sub-dollar misses; diagnostics must use the raw fields.
- CardProjectionContext dev debug: `window.__convergenceDebug.forecastResult` now exposes
  the converged ForecastResult (engine rows). NOTE: `convergedProjection` is the SIM side
  only — its rows do NOT have the engine fields.
- floor-protection.ts imports PROJECTION_MONTHS from './scheduling' directly (was via
  credit-card-engine) so credit-card-engine can import the cushion without an import cycle.
- q9-diagnostic test (untracked) gained RAW penny-level + DISPLAY (rounded) miss summaries.

## Live verification results (localhost, 2026-07-16 evening, converged 3 passes)

- Sub-dollar floor misses: ZERO (was m2 −$0.39 pre-Step-5-cushion; fixture had 5 up to −$0.37).
- Q9 acceptance: PV ISB pin $1,164.79 (Aug 2026) paid in full; Discover pulled back to $227
  min in tight months; no "Cash below safe minimum" milestone.
- Remaining flagged months are NOT bugs:
  - m0 Jul / m1 Aug: ~$300 below NEXT month's floor even at pure contract minimums +
    mandatory PV pin — structural (July's remaining cash can't cover August's floor step-up;
    nothing left to pull back). No milestone since cash stays above the $2,800 settings floor.
  - m7 Feb 2027: +$4.13 above its NEXT floor (fine per the Q9 convention) but shows RED.

## OPEN QUESTION FOR TRE (do not decide unilaterally — display semantics)

Forecast.tsx:1128 colors endingCash red when below the CURRENT month's monthMinSafe. The Q9
engine convention is endCash[m] must be ≥ monthMinSafe[m+1] (end-of-month cash is next
month's pre-paycheck cash). So months like Feb 2027 (and any ISB pin month) show red even
when correct. Ask: should the red/amber coloring compare against the NEXT month's floor
instead? One-line change if yes.

## NEXT STEPS

1. Ask Tre the display-semantics question above.
2. Q10 candidate (from Q8): engine-layer revolving dust nulls simRevolvingPayoffMonth /
   forecastRevolvingPayoffMonth, likely suppresses CC Debt Free milestone — dedicated
   session, fixture recapture.
3. Minor parity gap: useCardProjection.ts ~997 hook ccMinByMonth does not include ISB pins
   (engine's does) — optional base-pass fidelity fix, not blocking.
4. q9-diagnostic test kept untracked as skip-if-no-fixture; optionally promote a synthetic
   Q9 regression (floor step-up + ISB pin → no next-floor breach, raw fields ≥ floor).

## Diagnostic harness

`npx vitest run src/lib/__tests__/q9-diagnostic.isbPullback.test.ts --disable-console-intercept`
Fixtures gitignored: forecast-inputs.real.live-2026-07-16.json + payment-plans fixture;
funding id 933cbc10-bceb-4c20-8227-4a02e6db728a.

## GOTCHAS (carry forward)

- `window.__simDebug.raw` is PASS-0; SIM side = `__convergenceDebug.convergedProjection`;
  ENGINE rows (raw floor fields) = `__convergenceDebug.forecastResult`.
- `cp.cards[].id` empty on converged projection — look up via perCardPayments by name.
- Debt page is `/debt`; dev server localhost:8080 (DEV, not prod).
- vitest: `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Live capture's maxDebt "0"s are JSON-serialized Infinity — not real zeros.
- Harness needs paymentPlans + persistedDebtFundingId overrides to match live (see Q7).
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (currently 2 ≥ 1).
