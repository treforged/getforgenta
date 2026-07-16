# Handoff — 2026-07-16 — main

## Q8 RESOLVED (live-verified 2026-07-16)

Prime Visa card header showed TOTAL INTEREST $132,107 and "Interest-free: N/A" while real
in-window interest was $34.

**Root cause (two layers):**
1. The sim leaves **$0.04 of rounding dust** on PV's revolving-balance series (never exactly 0),
   so `projectCardVariable`'s strict `simRevBal === 0` cycling check never fires; PV's
   installment balance (upfront payment plans, $5,145) also holds it in the revolving display
   branch, and the local `inGrace` payoff check misses by cents of balance drift.
2. With `payoffMonth` stuck null, the 360-month payoff-discovery walk continues past the
   60-month sim window in the fallback branch paying only `card.minPayment` (**$0** — PV manual
   min), compounding 27.49% APR on a ~$148 cycling balance for ~300 months → $132k phantom.

**Fix (credit-card-engine.ts, projectCardVariable):** one added payoff detection — set
`payoffMonth` from sim ground truth when `simRevBal < 1` (sub-dollar dust convention, same as
the function's existing `bal < 1` clear), mirroring the cycling branch's assignment. `isCycling`
untouched (minimal blast radius). Backup: backups/2026-07-16_093000/.

**Regression test:** credit-card-engine.revolvingDustPayoff.test.ts (synthetic, always runs —
no gitignored fixture needed): PV-shaped card with dusty revolving series → payoffMonth set,
totalInterest === in-window interest; plus a no-false-positive test (genuinely positive series
→ no in-window payoff). Full lib suite green (34 files / 155 tests incl. the 2 new).

**Live verification (localhost:8080/debt):** PV TOTAL INTEREST **$34**, "Interest-free: 13 mo
(Jul 2027)", MIN PAYMENT $0 / INTEREST/MO $0.00 as expected, ISB $1,165 pin intact (Aug 2026
-$1,165 row), VX/Apple debt-free, Discover $1,226 / payoff 12 mo unchanged.

**Known side effect (correction, not regression):** Debt-tab PAYOFF ETA now 13 mo (was 12).
Both true signals (`simRevolvingPayoffMonth`, `forecastRevolvingPayoffMonth`) are **null on
live data** (verified via harness) because the same $0.04 dust defeats their `<= 0` checks, so
the ETA falls back to `simEta = max(per-card payoffMonth)`. Pre-fix that max silently excluded
PV (null payoffMonth) → 12 (Discover). Now 13 = PV's true revolving-clear month, consistent
with its own header label.

## NEXT TASK (Q9, user-reported 2026-07-16): Discover doesn't pull back enough for PV's ISB

User: "discover doesnt pull payments back enough for prime visa to always pay its full
interest saving balance and maintain cash floor in future months. primes interest saving
balance is a non negotiable."

Requirement: PV's manual ISB payment ($1,165 pinned, synthetic statement pin) is MANDATORY —
in any month with an ISB pin, the sim must pay the full pinned amount AND hold the cash floor;
Discover (revolving, "full balance" preference, avalanche priority by APR? PV 27.49 > Discover
19.49 so PV is avalanche-first — but Discover's payment is what needs pulling back) must
reduce its discretionary paydown to make room, including in FUTURE pin months (look-ahead).

Where to look:
- Q5 precedent: manualStatementBalance.test.ts "the ISB is funded first — the competing
  CYCLING card pulls back its statement payment, floor holds" — that pullback exists for
  cycling cards; Discover is a REVOLVING full-preference card, likely a different Step-5 path.
- manualIsbPins (useCardProjection ~1773, debt-model-types.ts:106): exposed so PASS-2
  floor-protection can model pin months' true mandatory CC outflow. Check whether the
  look-ahead (runLookAhead / computeFloorProtection) and Step-5 allocation actually reserve
  the pin amount BEFORE allocating discretionary revolving payments to Discover in the months
  leading up to / including a pin month.
- simulateVariablePayoff Step 5 cascade + maxDebtPaymentByMonth caps (Q6 capped by outstanding
  debt); the pin is applied per-card, but earlier-month Discover payments may drain cash the
  floor walk needed for the upcoming pin.
- Acceptance: every ISB-pinned month pays exactly the pin in full (no shorting, no floor
  breach); Discover absorbs the reduction; Q5-Q8 acceptance intact; verify on live fixture via
  harness (paymentPlans + persistedDebtFundingId overrides) then live /debt page.

## RELATED CANDIDATE (Q10, was Q9): revolving dust at the engine layer

The sim leaving $0.04 on a revolving series is the deeper root cause. It nulls BOTH payoff
signals (simRevolvingPayoffMonth's `totalRevBal <= 0`, forecast walk's `p3RevBal <= 0` is
separate but also came back null) and likely suppresses Forecast's **CC Debt Free milestone**
on live data (forecast-engine.ts:1261 `ccEngRevBalEnd <= 0` — dust keeps it at 0.04; fallback
signal ccDebtFreePayoffIdx is null). manualISB/goldenTierA tests pass because their fixtures
predate the dust. Fix belongs in simulateVariablePayoff (clear sub-dollar revolving dust at
month end) or as tolerance in the three `<= 0` consumers — engine fix is root-cause but touches
convergence fixed points + golden fixtures, so give it a dedicated session with fixture
recapture. Forecast page live (2026-07-16) otherwise sane: −OUT drops and END CASH jumps at
Jul 2027 (payoff), no milestone chip seen in page text (verify visually).

## GOTCHAS (carry forward)

- `window.__simDebug.raw` is PASS-0, not converged; use `__convergenceDebug.convergedProjection`.
- `cp.cards[].id` empty on converged projection — look up via perCardPayments by name.
- Debt page is `/debt`; dev server localhost:8080 (DEV server, not prod).
- vitest: `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored (`forecast-inputs.real*.json`). Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Live capture's maxDebt "0"s are JSON-serialized Infinity — not real zeros.
- Harness needs paymentPlans + persistedDebtFundingId overrides to match live (see Q7).
