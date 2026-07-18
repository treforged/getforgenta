# Handoff — 2026-07-18 (session 3) — main — Q10 CLOSED; Discover-July analysis delivered

## State: no work in flight

Q10 is RESOLVED and live-verified (commit `[debt]: Q10 resolved — dust-tolerant revolving
payoff metrics`). Metric-only fix: `src/lib/revolving-payoff.ts`
(`firstRevolvingPayoffMonth`, `REVOLVING_DUST_DOLLARS = 1`) wired into both payoff-month
reducers (useCardProjection.ts, cardProjectionResim.ts) and the two PASS-3 scalar checks.
Sim/convergence untouched. Live: payoff months 13, milestone "CC Debt Free! Jul 2027",
converged, /debt ETA 13 mo. 206/206 + tsc clean. q10-scratch2 diagnostic deleted.
Full history + the two reverted engine-side attempts (do NOT retry) are in memory
`project_cycling_debt_engine.md` (2026-07-18 entry).

## Tre's Discover-July question: ANALYSIS DELIVERED, decision pending

Live numbers (2026-07-18): Aug 2026 floor gap is now ~$205 (rawEndingCash 3,603.08 vs
rawMonthMinSafe 3,807.59) — smaller than session 1's ~$381 (Q11 + fresh sync moved it).
July pays Discover $790, ALL discretionary (m0 min $0 per Q11 — due day 1 already settled).
Aug is floor-clamped to mandatory only (PV ISB pin 1,007.95 + Discover 246), so every July
dollar withheld survives into Aug ending cash dollar-for-dollar up to the gap.
Recommendation given: hold back ~$210 of July's Discover payment (pay ~$580); cost ≈
$3.40/mo Discover interest (19.49% APR, no grace at stake — it's revolving), self-heals Sep
(headroom ~$398). Alternative lever (Aug PV pin cut) costs PV grace — worse. No engine
change made; awaiting Tre's call.

## Open items (unchanged)

- Anomaly A (pin floor-clamps at cycling obligation — accept+hint / allow below / toast) and
  Anomaly B (any pin flips all rows to overrideSim basis) design calls await Tre.
- unify-cycling-model Stages 4-5 on hold.
- Cosmetic backlog: rec reason string not threaded to UI strips; PV "TOTAL INTEREST" runaway
  stat with $0 min; Dashboard "Due 1th" typo.

## Gotchas (carry forward)

- backups/ untracked — never git add backups/. Repo PUBLIC — real fixtures gitignored, never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- SIM = `__convergenceDebug.convergedProjection`; ENGINE rows = `__convergenceDebug.forecastResult.data[]`
  (milestones live on forecastResult, not convergedProjection).
- vitest failure details on STDERR — use Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- Manual-min cards can have $0 contract revolving min (PV) — min-enforcement protects nothing
  for them; that's why Q10's engine-side fixes hit starvation branches.
