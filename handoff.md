# Handoff — 2026-07-09 (session 5) — branch debt-model-fixes-p0 — Feb breach FIXED + income model unified

## TL;DR — work is essentially COMPLETE, just needs a fresh-context sanity pass
Two things shipped and committed this session (never pushed):
1. **`4ae12fc0`** — Feb 2027 floor breach FIXED (sim payday-count aligned with engine). This alone
   closed the P0: converges 11 passes, payoff **Jun 2027**, **zero breaches**.
2. **`4d45c27c`** — sim+engine income model UNIFIED (step 3, user-requested). Shared pure module
   `src/lib/income-model.ts` (`computeBonusAndTax`, `computeAnnualFederalWithheld`) called by BOTH
   the engine and the sim, so the CC-projection popup income now matches the engine (tax estimator
   + gross-basis bonus + no nonPaycheck over-scaling). Engine output byte-identical (golden Tier-A
   green). Full suite: **157 tests pass, tsc clean**.

Also `7b69ec83` is the interim handoff commit. HEAD = `4d45c27c`.

## What changed (files)
- NEW `src/lib/income-model.ts` — shared income helpers (pure).
- `src/lib/forecast-engine.ts` — bonus/tax now via `computeBonusAndTax`; dropped direct
  tax-estimator imports. Byte-identical output.
- `src/hooks/useCardProjection.ts` — sim income mirrors engine i>0 exactly (adjustedConfig paycheck
  + shared bonus/tax); assumptions type gained optional tax-identity fields; computes
  `simAnnualFederalWithheld` from profile.
- `src/hooks/useForecastEngineInputs.ts` — annualFederalWithheldFromBudget via shared helper.
- `src/contexts/CardProjectionContext.tsx` — threads the 4 tax-identity fields into the sim.
- `src/lib/forecast-convergence.ts` — default `maxPasses` 8 → 12 (fixture needs 11).
- `src/lib/__tests__/forecast-convergence.realData.test.ts` — unpinned (`.fails` removed), TODO
  rewritten, tax fields added to its projectionAssumptions.
- Backups: `backups/2026-07-09_232129/` (P0 fix) + `backups/2026-07-09_step3/` (step 3).

## Verification done
- `npx tsc --noEmit` → clean.
- `npx vitest run` → 42 files / 157 tests pass (golden Tier-A byte-identical; realData converges,
  Jun 2027, zero floor breaches).

## Suggested fresh-context sanity pass (optional, low priority)
The refactor is test-green, but a next agent with fresh budget could:
1. Rebuild the temp diagnostic (pattern below) and eyeball that the SIM's per-month income now
   equals the ENGINE's (esp. Feb m7: pay 4408 + bonus 2170 + tax −2410). Parity is guaranteed by
   construction, so this is just belt-and-suspenders.
2. Confirm nothing regressed in the live app popup (manual, if desired).

### Diagnostic harness (reusable)
Copy the realData test's renderHook block into `src/lib/__tests__/febdiag.tmp.test.ts`, run
`runDebtCashConvergence(base!, inputs, { maxPasses: 20 })`, and `writeFileSync` a JSON of
`out.projections.data[m]` fields (paycheckIncome/otherIncome/bonusIncome/taxReturnIncome/
startingCash/endingCash/debtPayment/monthMinSafe) + `maxDebtPaymentByMonth[m]` to scratchpad
(console.log is swallowed by this vitest config). DELETE the temp test after. Real fixture is
gitignored, NEVER commit: `src/lib/__tests__/fixtures/forecast-inputs.real.json` (capturedAt
2026-07-03; pin Date via fake timers — realData test shows the setup).

## Remaining optional item (was step 2 — recommend SKIP)
The cap fix (bind sim cycling pool to mDebtCap pre-payoff) is unnecessary now and its premise was
disproven: the diag showed Feb's `mDebtCap` is `inf` (uncapped), not floor-safe. Only revisit if a
future fixture reintroduces a breach — and it would need a different cash ceiling, not mDebtCap.

## Anchors
- Branch `debt-model-fixes-p0`, HEAD `4d45c27c`. Never push. Milestone floor check uses `cashFloor`
  ($2800). Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.

## Failed hypotheses (do not revisit)
- Cap fix as the P0 fix: unnecessary + mDebtCap-floor-safe premise was wrong (Feb mDebtCap = inf).
- m0 breach (old realData TODO): stale, fixed in session 2.
