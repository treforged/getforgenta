# Handoff — 2026-07-15 ~00:50 — main

## ACTIVE TASK: Q4 — offline fixes landed, LIVE VERIFICATION PENDING

## WHAT LANDED THIS SESSION (all tests 184/184 pass, tsc/eslint clean)

1. **Verified the 07-14 negative result**: `manualIsbPins` (né manualIsbPinMonths) DOES
   populate in the diagnostic (`[{month:1, amount:1164.79, minPayment:151}]`) — the
   convergence-side pin exclusion bit and passes stayed 13. Negative confirmed real.

2. **Engine-side pin-mandatory fix (handoff step 2)** — forecast-engine.ts PASS 2 now
   builds `ccMinByMonth` = ccMinTotal + max(0, pinAmount − pinCardMin) for pinned months
   and passes it to computeFloorProtection, so the look-ahead's netAtMin models the true
   mandatory CC outflow of an ISB-pinned month (was flat ccMinTotal → 283 vs real 1,297).
   - Threading: `manualIsbPinMonths?: number[]` → `manualIsbPins?: {month, amount,
     minPayment}[]` (debt-model-types.ts, useCardProjection.ts ~1761, forecast-convergence.ts).
   - **Alone this was a bit-identical no-op** (verified with temp log): PASS 3 takes actual
     payments from the sim ledger, so PASS-2 caps aren't in the oscillation's causal path
     by themselves. It matters in combination with 3 (different trajectory → caps bind).

3. **Adaptive damping in forecast-convergence.ts (the real lever)** — the 8-pass tail was
   pure damping delay: raw target at m6 stable at ~$1,171 from pass 6, but damped blending
   closes only ×0.5/pass (gap 123→58→27→…→1). New rule: per month, if |raw − prevRaw| ≤
   toleranceDollars the raw is self-consistent → take it undamped; else damp 0.5 as before.
   A genuine two-cycle keeps raw oscillating → stays damped (guard preserved).

## RESULTS (q4-diagnostic, fixture + injected Prime Visa ISB 1164.79)
- dueMonth=1 (mirrors live): **13 → 12 passes**, and the **Mar 2027 floor breach is GONE**
  (loop lands on a better fixed point; CC Debt Free unchanged Jun 2027).
- dueMonth=0: unchanged (5 passes, Jun 2027, no breach).
- realData baseline + all other suites: unchanged/pass.

## NEXT STEPS
1. **LIVE VERIFY** (npm run dev :8080, Debt tab, `window.__convergenceDebug`):
   expect passes < 15 (was 15/18), usedFallback:false, payoff ETA vs forecast payoff gap
   narrowed (was 32 vs 38), and check the Aug 2026 floor row (was $2,461 vs $2,800 —
   breach may legitimately persist or grow; honesty, not cosmetics, was the goal).
2. Re-examine save-up over-reserve (07-14 finding 2): is netAtMin too pessimistic
   post-Q5 (payoff 38 vs debt-tab 32 residual gap)? May have moved after this fix.
3. Recapture fixture from live post-Q5 data (statement_balance + PV min $0) so offline
   matches live exactly — fixture-io helper exists; fixture stays gitignored; repo PUBLIC.
4. Original Q4 Feb–Jun 2028 symptom: reassess after 1-2; likely the save-up caps.
5. If live passes still flirt with 18: consider applying the same raw-stability rule to
   the CAP damping (line ~115, the m30 residual two-cycle) — deliberately NOT done yet.

## Carry-over guardrails / gotchas
- `__convergenceDebug` (converged/passes/usedFallback) on Debt page, DEV only.
- vitest hides console.logs — use `--disable-console-intercept`.
- Q5 acceptance (PV Jul "—", Aug −$1,165) must stay intact when live-verifying.
- ctrl+a+type into month-payment inputs APPENDS — use form_input.
- Repo PUBLIC — never commit real financial data. Supabase user_id
  a72f416e-433a-4055-9ab0-9feae4e60edf. Never push. Backups: backups/2026-07-15_003458/.
- Anomaly A (floor clamp at mandatory obligation) + Anomaly B (pin flips rows to local
  sim) still await Tre's design ruling — full detail in f4f90234.
