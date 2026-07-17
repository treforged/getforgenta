# Handoff — 2026-07-16 — main — Q9 IN PROGRESS (mid-fix, do not ship as-is)

## Q9 (user-reported): Discover doesn't pull back for PV's mandatory ISB pin / cash floor

User: "discover doesnt pull payments back enough for prime visa to always pay its full
interest saving balance and maintain cash floor in future months. primes interest saving
balance is a non negotiable."

## ROOT CAUSE — FOUND AND CONFIRMED

`computeFloorProtection` (src/lib/floor-protection.ts) forward pass only enforced a required
end-of-month balance when `reserveNeeded[m+1] > 0` (a future *at-minimum-payments* breach).
When paying only minimums would be fine, the `else` branch let the month drain cash to **its
own floor** — but PASS-3 and the sim's Step 5 pin end cash to the *current* month's
effectiveFloor by design, so any month whose **next month's floor is higher** (pre-paycheck
bill timing steps up) started below its floor with no cap ever emitted. Discover (avalanche
discretionary recipient) was exactly the uncapped payment.

Confirmed on live fixture (forecast-inputs.real.live-2026-07-16.json + payment-plans fixture,
funding id 933cbc10-bceb-4c20-8227-4a02e6db728a): pre-fix converged plan had
maxDebtPaymentByMonth = Infinity everywhere except m0, endCash below next month's floor from
m2 onward (m2 $3,440 vs Oct floor $3,829; m4 $2,990 vs Dec $3,448), Discover taking
$740–$1,545/mo. Pin itself ($1,164.79, month 1) is always paid — the engine pays
pinnedStep5Share unconditionally — the failure is the floor, not the pin amount.

## CHANGE MADE (committed, IN PROGRESS)

`src/lib/floor-protection.ts` forward pass: hoisted `nextFloor` and changed the branch
condition to `reserveNeeded[m + 1] > 0 || nextFloor > mFloor` (with explanatory comment).
Backup: backups/2026-07-16_101500/src/lib/floor-protection.ts.

**Result on live fixture:** converges in 7 passes (was 12); caps fire (m0 740, m2 1074,
m5 1281, m8 1944, m10 1870, m11 2246…); Discover pulled back in early months (m2 $227 was
$467); early step-up months mostly hold.

## OPEN PROBLEM — residual breaches (why this is NOT done)

1. **NEW milestone regression: "⚠️ Cash below safe minimum" at Apr 2027 (m9)** — endCash
   $2,799 < settings floor $2,800. Pre-fix milestones were []. m9 pays Discover $2,541 with
   engine cap[9]=Inf (floor[10] $3,241 < floor[9] $3,314, so no step-up condition and rn=0).
2. Residual shorts vs next-month floor remain: m2 ends $3,729 vs floor[3] $3,834 (−105),
   m5 −135, m7 $2,921 vs floor[8] $3,246 (−325), m9/m10 several hundred short.

**Diagnosis of residual:** the walk's modeled `bal` drifts ABOVE the actual PASS-3 trajectory
(each small actual shortfall compounds), so caps computed from walk-bal are systematically too
generous, and months without a step-up/reserve get no cap at all while actual cash is already
below the walk's assumption. The walk model ≠ engine actual (known, deliberate separation),
but now that caps bind often, the drift surfaces.

**Candidate next step (root-cause layer):** make the sim/PASS-3 surplus computation itself not
drain below the NEXT month's floor — e.g. Step 5's `availableCash` uses
`max(effectiveFloor[m], effectiveFloor[m+1])` (and same for PASS-3's redirect target) — end-of-
month cash IS next month's pre-paycheck cash, so draining to only this month's floor is the
actual layering bug; the look-ahead caps then only need to handle multi-month reserves.
Alternative: iterate caps against the ACTUAL converged trajectory instead of the walk's own
modeled bal (convergence loop already re-runs the engine each pass — check whether
Forecast PASS-2's expense/income arrays can be rebuilt from the previous pass's actual rows).

## Acceptance (unchanged from original Q9 spec)

Every ISB-pinned month pays the pin in full (already true), NO floor breach milestones, no
month ends below the next month's monthMinSafe, Discover absorbs the reduction, Q5–Q8
acceptance intact (manualISB passes ≤16 / payoff Jun 2027 on the July-15 fixture; promoParity
VX no backlog; revolvingDustPayoff; goldenTierA). **Full lib suite has NOT been run against
this change yet** — goldenTierA/manualISB baselines may shift and need re-pinning or the fix
needs the deeper layer above. Then live-verify on localhost:8080/debt + /forecast.

## Diagnostic harness (untracked test, keep until Q9 closes)

`src/lib/__tests__/q9-diagnostic.isbPullback.test.ts` — runs convergence on the live 07-16
fixture with Q7 overrides, dumps m0–m14 per-card payments, endCash vs floor, engine caps,
milestones. Run: `npx vitest run src/lib/__tests__/q9-diagnostic.isbPullback.test.ts
--disable-console-intercept`. Note: fixture cards are PV $6,041 rev / Discover $8,015 rev —
much bigger than the 07-15 golden fixture; user's live data changed.

## Key code map (saves re-derivation)

- floor-protection.ts: shared walk; ccMin(m)=min(ccMinByMonth[m], debtCap(m)); early-returns
  all-Infinity if ccMinTotal<=0 (not the issue here — ccMinTotal=$277).
- forecast-engine.ts ~934: engine PASS-2 ccMinByMonth DOES include ISB pins (+amount−minPayment).
- useCardProjection.ts ~997: hook's own ccMinByMonth does NOT include pins (parity gap, minor —
  convergence threads engine caps/targets anyway; consider fixing for base-pass fidelity).
- credit-card-engine.ts Step 5 ~1345-1376: availableCash − pinnedStep5Total; mDebtCap clamp
  `min(avail, max(cap−pin, totalMins))`; mDebtTarget (convergence target) WINS over cap,
  `max(target−pin, totalMins)`; pin months get NaN target (forecast-convergence.ts:66) so they
  fall back to mDebtCap. Pins paid unconditionally at line ~1464.
- Convention: end-of-month cash is compared to NEXT month's monthMinSafe (start-of-month
  pre-paycheck floor), not the same month's.

## Q8 (previous, RESOLVED — see git de6323f1/8242ae07 for detail)

PV $132k phantom interest fixed via payoffMonth from simRevBal<1. Q10 candidate still open:
engine-layer revolving dust ($0.04) nulls simRevolvingPayoffMonth/forecastRevolvingPayoffMonth
and likely suppresses CC Debt Free milestone — dedicated session, fixture recapture.

## GOTCHAS (carry forward)

- `window.__simDebug.raw` is PASS-0, not converged; use `__convergenceDebug.convergedProjection`.
- `cp.cards[].id` empty on converged projection — look up via perCardPayments by name.
- Debt page is `/debt`; dev server localhost:8080 (DEV server, not prod).
- vitest: `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored (`forecast-inputs.real*.json`). Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Live capture's maxDebt "0"s are JSON-serialized Infinity — not real zeros.
- Harness needs paymentPlans + persistedDebtFundingId overrides to match live (see Q7).
