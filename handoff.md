# Handoff — 2026-07-15 ~08:25 — main

## ACTIVE TASK: Q4 closed; optional-hardening item 1 (fixture recapture + regression promotion) DONE

## WHAT LANDED THIS SESSION (184/184 pass, tsc + eslint clean)

1. **Golden fixture recaptured from live post-Q5 data** (capturedAt 2026-07-15T12:15:21Z) via a
   TEMP dev-only `window.__captureForecastFixture` hook in CardProjectionContext (added, used,
   reverted — no diff remains). Fixture now natively carries Prime Visa statement_balance 1164.79
   / balance 6004.12. Old fixture kept locally as
   `fixtures/forecast-inputs.real.bak-2026-07-03.json`; .gitignore widened to
   `forecast-inputs.real*.json` (both verified ignored — repo PUBLIC, never commit them).

2. **q4-diagnostic promoted to a real regression test** →
   `src/lib/__tests__/forecast-convergence.manualISB.test.ts` (git mv). Injection removed (fixture
   has the ISB natively); asserts per clock anchor: converged, passes ≤ 16 (offset 0) / ≤ 12
   (+11d), CC Debt Free 'Jun 2027', zero floor breaches, and the Q5-path precondition
   (manualIsbPins derived from the fixture's PV statement_balance).

3. **simAgreement re-scoped to the CONVERGED pair** (forecast-engine.simAgreement.test.ts): the
   Q4 engine change deliberately lets PASS-2 floor caps break raw single-pass parity when an ISB
   pin exists (gap $25 @m24 on the new fixture); the user-facing invariant (popup == accordion)
   holds at the convergence fixed point, so the test now renders the hook, runs
   runDebtCashConvergence, and asserts gap ≤ $1 for months 1+ on the converged pair.

4. **goldenTierA re-pinned** per its own refresh instructions: raw single-pass milestone on the
   post-Q5 fixture = 'Jun 2029' (forecastRevolvingPayoffMonth 36; simRevolvingPayoffMonth unset
   with the pin). Converged Jun 2027 stays guarded by forecast-convergence.realData.test.ts.

5. **Shared harness extracted** → `fixtures/projection-harness.ts`
   (renderProjectionFromFixture + buildProjectionAssumptions), used by manualISB + simAgreement.
   realData test left untouched (still has its inline copy — optional cleanup).

## KNOWN FIDELITY GAP (documented in projection-harness.ts)
Fixture does not capture debtPayoffOptions, so offline runs use overrides:{} — offline shows
16 passes at the capture clock while live __convergenceDebug shows 12 (verified live this
session: converged:true, passes:12, usedFallback:false). Invariants (Jun 2027, no breaches)
match live in both scenarios. If exactness ever matters, extend the capture to include
debtPayoffOptions/overrides.

## REMAINING OPTIONAL ITEMS (from 07-15 ~01:00 handoff)
- Raw-stability rule for the CAP damping (forecast-convergence.ts ~line 115) — only if passes
  creep toward 18 again; measure first.
- Save-up over-reserve question — mooted unless a Feb–Jun 2028-style underpayment reappears.
- Remove dev-only `__convergenceDebug` useEffect eventually (or keep — cheap).
- Fold realData test onto the shared projection-harness helper (pure dedup).
- Anomaly A (floor clamp at mandatory obligation) + Anomaly B (pin flips rows to local sim)
  still await Tre's design ruling — full detail in f4f90234.

## Carry-over guardrails / gotchas
- vitest hides console.logs — use `--disable-console-intercept`.
- Q5 acceptance (PV Jul "—", Aug −$1,165) must stay intact when live-verifying.
- ctrl+a+type into month-payment inputs APPENDS — use form_input.
- Repo PUBLIC — never commit real financial data. Supabase user_id
  a72f416e-433a-4055-9ab0-9feae4e60edf. Never push. Backups: backups/2026-07-15_081327/.
