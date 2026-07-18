# Handoff — 2026-07-18 (session 2) — main — Q10: metric-layer fix chosen, helper test at RED

## Goals

1. Q10: engine-layer revolving dust (Prime Visa $0.04 from m12 onward) nulls
   simRevolvingPayoffMonth / forecastRevolvingPayoffMonth and suppresses the CC Debt Free
   milestone (live milestones array empty). Close it WITHOUT destabilizing convergence.
2. Tre's new ask (NOT started): "recheck Discover — I could cut back the Discover payment
   this month (July) to maintain next month's cash floor" — i.e. re-examine the Aug 2026
   ~$381 floor miss (see session-1 notes below) with a July-Discover-cut as the lever.
3. Tre asked to look at his Forecast tab in the browser (he's logged in, localhost:8080).
   Not done yet — do it for step 2 and for live verification.

## THE KEY DECISION THIS SESSION (read before touching the engine)

Root cause chain fully diagnosed:
- PV's Amazon plan (5145.16 @ ~347.02/mo via upfrontPayByMonth) leaves $0.04 installment
  dust at m12; after m12 the schedule is 0, so `upfrontDueFor` never pays the remainder.
  The paid-off transition's `remainingInstAfterPay <= 0.01` gate then blocks PV forever.
- TRIED + REVERTED (#3): installment final-payment true-up in `upfrontDueFor` (pay full
  instBal when remainder < $1). It WORKS at the sim level (payoff month 13) but breaks
  convergence: once PV can retire, the loop becomes bistable — branch A: PV funded,
  retires m13-17; branch B: damped target runs tight, cascade gives PV $0 (its manual
  contract revolving min is $0!), grace breaks, balance snowballs 1589→3298. m20
  debtPayment flips 420↔1251 (an $831 PV statement), period ~5 passes, never settles.
  promoParity went RED.
- TRIED + REVERTED (#4): Step-5a "grace-keep" priority (statement-pref card in grace
  claims its statement due ahead of the surplus cascade, capped by remaining). Kills the
  starvation branch in theory but perturbs payments on ALL fixtures: realData, manualISB
  (3 tests), promoParity, scratch all went RED (convergence must settle). Too aggressive.
- CHOSEN FIX (in progress): the pre-existing converged state is economically CORRECT
  (PV pays statements monthly, keeps grace, zero interest — identical to a retired
  cycling card). Only the derived payoff METRICS treat $0.04 as live debt. So: leave sim
  state alone entirely; make the payoff-month reducers dust-tolerant (<$1, matching the
  engine's existing sub-dollar dust convention). This cannot touch convergence (payoff
  months feed milestones only, never targets).

## Current State

- Working tree: committed Fix #1 (7a330677 transition tolerance) intact; both engine
  experiments fully reverted; all temp diagnostics removed from credit-card-engine.ts and
  forecast-convergence.ts. `git diff` clean except NEW files below.
- NEW (uncommitted... committed with this handoff): src/lib/__tests__/revolving-payoff.test.ts
  — 6 tests for `firstRevolvingPayoffMonth` + `REVOLVING_DUST_DOLLARS`, currently RED
  (src/lib/revolving-payoff.ts does not exist yet).
- Backups: backups/2026-07-18_183000/src/hooks/{useCardProjection.ts,cardProjectionResim.ts}
  (originals, pre-metric-fix; backups/ is untracked — do NOT git add).

## Next Steps (mechanical from here)

1. Create src/lib/revolving-payoff.ts: export `REVOLVING_DUST_DOLLARS = 1` and
   `firstRevolvingPayoffMonth(monthlyRevolvingBalances: Map<string, number[]>, cardIds:
   string[], months: number): number | null` — ids filter is callers' (cards with month-0
   revolving > 0 are passed in); loop m 0..months-1, sum per-card Math.max(0, bal), payoff
   at `total < REVOLVING_DUST_DOLLARS` (was `<= 0`), return m+1; null otherwise.
   Run revolving-payoff.test.ts → GREEN.
2. Wire it in (both existing loops are identical copies):
   - src/hooks/useCardProjection.ts:1725-1739 (simRevolvingPayoffMonth)
   - src/hooks/cardProjectionResim.ts:174-188 (payoffMonth)
   - PASS-3 scalar checks useCardProjection.ts:1292 and :1436 — change `p3RevBal <= 0` /
     `p3RevBal2 <= 0` to `< REVOLVING_DUST_DOLLARS` (import the const). Leave every other
     `p3RevBal > 0` guard alone.
3. Battery: revolving-payoff, q10RevolvingDust (3), promoParity, realData (Jun 2027 pin),
   manualISB, goldenTierA, resimulateWithDebtCash, then full suite + tsc. Expect all green —
   this change is metric-only.
4. Delete src/lib/__tests__/q10-scratch2.test.ts (temp diagnostic; it asserts converged
   only — with reverts it passes but is no longer needed once live-verified).
5. Live-verify in Chrome (Tre is logged in, localhost:8080/forecast): __convergenceDebug —
   payoff months should be ~13 (non-null), milestones array non-empty (CC Debt Free fires),
   converged true. ETA sane on /debt.
6. THEN do Tre's Discover question (goal 2): from live data / fixture, quantify cutting
   July's Discover payment (mandatory min vs extra portion) and how much of the saved cash
   survives into Aug ending cash vs the $381 miss. Remember Q11: Discover min 192.09 was
   moved to Aug; check what July actually pays Discover first. Report options; floor
   protection already pulls discretionary extra, so the lever is any July extra + possibly
   the Aug PV ISB pin (session-1 note). Don't change engine behavior for this — it's analysis.
7. Update memory project_cycling_debt_engine, commit, summarize.

## Failed Attempts (do NOT retry)

- Fix #2 (session 1): report-only dust-clear of monthlyRevolvingBalances push → promoParity
  RED. Never make the REPORT arrays disagree with sim state.
- Fix #3 (this session): upfrontDueFor final-payment true-up → bistable convergence (see above).
- Fix #4 (this session): Step-5a grace-keep priority → perturbs all fixtures, 6 tests RED.
  If grace-keep mandatory-ness is ever wanted, it's a DESIGN decision to raise with Tre,
  not a Q10 fix.

## Answered session 1 (relay if asked)

Aug 2026 cash floor miss (~$435 → effective ~$381 after cutting all discretionary): floor =
Sep 1-7 bills (rent 1915, car 422.89, ins 173.23, PV min 510.50, Discover min 192.09,
groceries 300, utilities 255, life 54) before first Sep paycheck. Aug carries $1,409.79
mandatory card cash: PV ISB pin 1,164.79 (Q4/Q5: pins mandatory) + Discover 245 (Q11-moved
min 192.09 + extra). Self-heals Sep (3,865 vs 3,469). Levers: lower/remove Aug PV ISB pin
(costs interest) — and now Tre's July-Discover-cut idea (goal 2, unanalyzed).

## Gotchas (carry forward)

- backups/ untracked (95d93a58) — never git add backups/.
- Repo PUBLIC — real-data fixtures stay gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- `window.__simDebug.raw` is PASS-0; SIM = `__convergenceDebug.convergedProjection`;
  ENGINE rows = `__convergenceDebug.forecastResult.data[]`.
- vitest: --disable-console-intercept for logs; failure details on STDERR (use Bash 2>&1,
  not PowerShell). Env vars for test runs via Bash `VAR=1 npx vitest ...`.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- simulateVariablePayoff positional #20 = debtCashTargetByMonth, #21 =
  paymentOverridesByMonth (see credit-card-engine.paymentOverrides.test.ts).
- Manual-min cards can have $0 contract revolving min (PV) — the min-enforcement guard
  protects nothing for them; that's why starvation branches exist.
