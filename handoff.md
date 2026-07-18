# Handoff — 2026-07-18 (session 4) — main — Q10 closed; Stages 4-5 verified; NEW floor finding (Q12)

## State: no work in flight, working tree clean

Q10 RESOLVED & live-verified (`b309e151`). Metric-only fix: `src/lib/revolving-payoff.ts`
(`firstRevolvingPayoffMonth`, `REVOLVING_DUST_DOLLARS = 1`) in both payoff reducers + the two
PASS-3 scalar checks. Two engine-side attempts were tried and reverted — do NOT retry; see
memory `project_cycling_debt_engine.md` (2026-07-18 entry).

## Stages 4-5 of unify-cycling-model: VERIFIED COMPLETE (no code changes needed)

- Stage 4: `forecast-convergence`, `goldenTierA`, `simAgreement`, `revolvingDebtCash`,
  `step3-display` — 16/16 green. **No golden re-pins required.**
- Stage 5 live verify: converged in 6 passes, `usedFallback: false`, max
  |row.debtPayment − ledger.total| = **$0.50** (Sep 2026), zero months over $1 — Stage 3's
  acceptance criterion holds on live data.
- Stage 5 cleanup: nothing dead to delete. The one remaining `perCardPaymentsScaled` read in
  `forecast-engine.ts:1065` is the documented display-only `cumulativeSurplusesByCard` consumer
  (popup per-card lines must sum to the total), NOT the old preference-read. Leave it.
- graphify updated. Plan `.claude/plan/unify-cycling-model.md` can be marked done.

## Q12 (NEW, root-caused, NOT fixed) — augmented floor over-reserves post-paycheck obligations

`getAugmentedMinSafeCash` (`src/lib/pay-schedule.ts:748+`) applies the "bills due before next
month's first paycheck" cutoff **only to budget rules** (via `getPrePaycheckNextMonthBills`,
:770). The three loops it adds afterward — car loan (:781), car insurance (:808), CC minimums
(:829) — add by due day **unconditionally**, gated only by `dueSynced` (month-0 Plaid). They
never check the first-paycheck cutoff.

Live impact (Aug 2026, weekly pay ~$1,124 net, first Sep paycheck Fri Sep 4):
- Floor as computed = **$3,807.59**; ending cash $3,603.08 → the "$205 miss".
- Of that floor, **$1,106.62 is due Sep 7**, AFTER the Sep 4 paycheck: car loan 422.89 +
  car insurance 173.23 + PV min 510.50.
- Corrected pre-paycheck need = $2,700.97 → below the $2,800 base floor, so effective floor
  would be $2,800 and August clears by ~$803.
- Hand-walk of Sep 1-7 confirms: 3,603 − 2,347 (day 1) − 354 (day 3) + 1,124 (Sep 4 paycheck)
  − 1,106.62 (day 7) = **~$919 low-water**. No real shortfall.
- Empirical corroboration: only day-1/day-3 budget bills made the floor (cutoff working for
  rules), while every day-7 entry came from the three unconditional loops.

**Consequence: the Discover-cut recommendation from session 3 is WITHDRAWN** — it was closing a
gap that isn't real. Tre pays the full recommended $792 to Discover in July.

**Fix scope (dedicated session):** thread the same `effectiveCutoff` into the three loops.
Touches the floor for every month/user → re-run goldenTierA, manualISB, realData, floor tests,
and expect deliberate re-pins. Do NOT bolt onto other work.

## Anomaly A — pin below mandatory obligation is floor-clamped (DECIDED: accept + hint)

Pinning PV Oct=100 rendered −$511 "edited" ($510.50 = that month's mandatory cycling
obligation). It's a FLOOR clamp, not a cap. Keep the clamp — paying under a contractual minimum
means late fees / penalty APR / grace loss that the engine does not model. Fix the UX only:
when a pin is clamped, show the effective value with an inline note ("Minimum obligation this
month is $510.50 — pin raised to match") instead of a negative delta. No engine change.

## Anomaly B — any pin flips all rows to overrideSim basis (DECIDED: converge the override sim)

`CreditCardEngine.tsx:760` builds `overrideSim`; :908-915 swap EVERY card's payments/balances/
interest series to it, and :973 (`const cum = overrideSim ? 0 : step3CumSurplus…`) zeroes the
step-3 surplus adjustment for all rows. So one pin changes every row, and `overrideSim` never
goes through `runDebtCashConvergence` — a pinned projection is un-converged.
**Recommendation:** route `overrideSim` through the same convergence loop the base projection
uses (`resimulateWithDebtCash` is already the seam). Engine-layer, own session, needs goldens.

## Gotchas (carry forward)

- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- SIM = `__convergenceDebug.convergedProjection`; ENGINE rows = `.forecastResult.data[]`;
  milestones live on `forecastResult`, not convergedProjection.
- Floor composition is on each row as `floorItems` + `prePaycheckBillsTotal` — use it, don't
  reconstruct by hand.
- vitest failure details on STDERR — use Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- Manual-min cards can have $0 contract revolving min (PV) — that's why Q10's engine-side
  fixes hit starvation branches.
