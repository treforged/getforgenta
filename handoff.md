# Handoff — 2026-07-12 — Discover 2yr-payoff: FIXED, HARDENED, VERIFIED LIVE

## STATUS — DONE (not pushed)
The Discover "pays off ~2.5yr out (Feb 2029) while cash balloons to ~$38k" bug is fixed, the
exhaustion path is hardened, the tuning constant is now injectable, and the fix is confirmed in the
live app. Full suite green (43 files / 165 tests), tsc clean. Three commits, local only.

## ROOT CAUSE (proven headless)
`runDebtCashConvergence` (src/lib/forecast-convergence.ts) was one pass short of its budget on live
data. The damped (0.5) loop converges monotonically and every pass already yields the correct payoff
(Discover Jul 2027); residual `maxGap` decays ~40%/pass: 2307→…→2 (@pass12) → 1 (@pass13) → 0
(@pass15). Old `maxPasses=12` cut it off at gap $2, and the exhaustion path published the
UNACCELERATED `base` pair (Feb 2029 / $38k hoard). Prior floor-protection / reserveNeeded /
revolvingDebtCash-collapse theories were all wrong — the resim was fine, just never published.

## THE THREE COMMITS (all local, NOT pushed)
1. `a494b5bc` fix: `maxPasses` default 12 → 18 (5-pass margin); removed TEMP floor-protection dump.
2. `9cd7b631` fix: on exhaustion, publish the LAST resim (not base) when the loop was CONVERGING
   (net progress `lastGap < firstGap` AND `lastGap <= exhaustionPublishBound`). Genuine non-decaying
   oscillation (`firstGap == lastGap`) still falls back to base. `converged` stays false either way.
   Eliminates the cliff for any future data needing >18 passes as long as it's converging.
3. `81859770` feat: `exhaustionPublishBound` now injectable via `DebtCashConvergenceOptions`
   (default `max(toleranceDollars*25, 25)`). Two new unit tests (converging-exhaustion rescue +
   custom-bound-forces-base).

## VERIFICATION
- Headless harness (now deleted): `runDebtCashConvergence` returns `converged:true, passes:13`,
  published payoff Jul 2027.
- LIVE app localhost:8080/debt: **PAYOFF ETA = 13 mo** (was ~31 mo). Confirmed 2026-07-12.
- 165 tests pass; `tsc --noEmit` clean.

## CLEANUP DONE
- Reverted TEMP dump in src/lib/floor-protection.ts (byte-identical to clean backup
  backups/2026-07-11_090803/).
- Deleted TEMP harness src/lib/__tests__/discdiag.tmp.test.ts (was untracked).
- Backups: backups/2026-07-12_003425/ and backups/2026-07-12_220848/.

## NOTHING LEFT — but if picked up later
- The `38k` cash pile post-payoff is correct/benign (accumulates only AFTER both cards clear
  mid-2027; no revolving debt left to route it to — this model has no post-payoff auto-invest).
- Consider pushing when ready; the three commits are cleanly separable/squashable.
- Repo is PUBLIC — scratchpad holds real financial data, never commit it.
