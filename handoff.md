# Handoff — 2026-07-07 (session 2) — branch debt-model-fixes-p0

## Goal
**Forecast-popup CC balance mismatch, Option A (user-confirmed)**: Forecast month popup's
per-card CC balances and the Debt Payoff accordion/chart must agree for the same month,
rows must reconcile (End = Start + purchases + interest − payment − surplus), no ETA /
Ending Cash / milestone regression. Implementation is ~40% done (engine + tests GREEN);
popup/export/accordion edits remain.

## Root cause (CONFIRMED via fixture diagnostic — do not re-derive)
Ran a scratch test against `src/lib/__tests__/fixtures/forecast-inputs.real.json` (gitignored)
comparing engine vs hook derivations month-by-month. Findings:
- The hook's replica pass-3 walk (useCardProjection.ts:1353-1404 → `pass3RevTotals` →
  `extraPerCardByMonth`/`surpluses`) and the engine's real walk (forecast-engine.ts step-3)
  are STRUCTURALLY divergent, in BOTH directions — not a fixable skip-condition:
  - Aug 2026: hook plans +$347 extra to Prime (inside perCardPaymentsScaled) but engine only
    pays $568 total that month (floor-clamped) — the extra never actually happens in engine cash.
  - Mar 2027: engine routes +$702 step-3 surplus the hook replica never sees.
- Three displays disagreed: popup subtracted engine `revolving3Extra` (cumA); DebtPayoff showed
  raw sim balances + hook surplus lines (cumB) without subtracting; export subtracted nothing.
- Fixture numbers: by Sep 2026 cumA=$2 vs cumB=$350 (Prime); live 07-07 data: cumA=$369 vs
  cumB=$210. Fully reconciling the two walks = option C (deferred convergence rework).

## Decided design (Option A, settled — implement as specified)
One shared display derivation, engine CASH walk untouched:
- NEW `src/lib/step3-display.ts` (DONE): `cumulativeSurplusesByCard(perCardPaymentsScaled)` +
  `adjustedDisplayBalance(simBal, cumSurplus)` = max(0, simBal − cum). Display rule everywhere:
  card line = revolving? max(0, monthlyBalances[i] − cum[i]) : cycling statement (untouched).
  Gate on monthlyRevolvingBalances.get(id)[i] > 0.
- Engine (DONE): forecast-engine.ts revolvingAdj (was min(cumulativeStep3Extra, ccEngRevBalEnd)
  at old line ~1184) now = Σ per-card gated subtraction via the helper; import added; precompute
  `hookCumSurplusByCard` before the month loop. `cumulativeStep3Extra` / step-3 routing /
  milestones / Ending Cash intentionally NOT touched.

## Current state
- Tests GREEN: `src/lib/__tests__/step3-display.test.ts` (new; unit + fixture test asserting
  engine ccDisplayBalance == displayCCBalance − Σ per-card gated adj, was RED before engine fix,
  includes non-vacuous guard) AND `forecast-engine.goldenTierA.test.ts` (milestone May 2027).
- Backups taken: `backups/2026-07-07_120558/` (Forecast.tsx, forecast-engine.ts,
  forecast-export.ts, CreditCardEngine.tsx, DebtPayoff.tsx).
- Scratch diagnostic deleted (scratch-pass3-diff.*). Full test suite NOT yet run.
- This commit contains: handoff, backups, step3-display.ts, step3-display.test.ts,
  forecast-engine.ts change.

## Next steps (in order)
1. **Forecast.tsx ~1084-1116** (popup per-card lines): replace the inline `rem3 =
   row.revolving3Extra` cascade with the helper: for each simCard, revBal>0 →
   `adjustedDisplayBalance(monthlyBalances.get(id)[absoluteI], cum.get(id)[absoluteI])`,
   else keep cyclingBal = data[absoluteI][card.name]. Compute `cum` once via
   `cumulativeSurplusesByCard(cardProjectionData?.perCardPaymentsScaled)` (useMemo).
   Leave popup PAYMENT lines as-is (engine-scaled) — out of scope, noted for user.
2. **src/lib/forecast-export.ts:149-161** `getCreditCardBalances`: same formula (it currently
   mirrors the popup WITHOUT any adj — make it use the helper identically).
3. **CreditCardEngine.tsx**: accordion (~1638-1698) displayed Start/End: for revolving months
   (monthlyRevolvingBalances.get(id)[idx] > 0) show End = max(0, row.endBalance − cum[idx]),
   Start = max(0, row.startBalance − cum[idx−1]); surplus line at 1642/1683 already shows the
   matching payment → rows reconcile (this is the fix the reverted overlay lacked — see
   DebtPayoff.tsx:35-40). Chart `debtChartData` (~916-941): subtract the same way. Do NOT
   change projectCardVariable inputs (raw sim stays the model; payoff detection must not move).
   Keep ETA label on simRevolvingPayoffMonth.
4. Update the DebtPayoff.tsx:35-40 revert-history comment to describe the new adjusted-display-
   with-matching-payment approach.
5. `npm run` full vitest suite + `npx tsc --noEmit` (or build). Note: 3 pre-existing
   activeLoanInsurance test failures are known backlog — don't chase.
6. `python -m graphify update .` (CLAUDE.md), commit locally (no push).
7. Live-verify (dev server localhost:8080, Chrome MCP — re-fetch tabs_context, old tabId stale):
   /forecast → 2026 → Sep 2026 popup per-card CC balances == /debt accordion Sep 2026 end
   balances (Prime + Discover), accordion rows reconcile, ETA still 13 mo / Jul 2027-ish
   (manual-min Prime $0 flag is live — see previous session), Ending Cash unchanged vs before.
8. Write session notes to `C:\Users\tvonh\Desktop\claudecontext\sessions\2026-07-07_forecast-cc-display-unification.md`.

## Gotchas / do NOT
- Do NOT feed adjusted balances into projectCardVariable or change sim/payoff detection —
  that's the previously-reverted failure mode.
- Do NOT touch engine step-3 routing (cumulativeStep3Extra lines ~1156-1176) — display only.
- Expect popup payment lines vs accordion payment+surplus to still differ in months where the
  engine's cash walk clamps/exceeds the hook plan (Aug 2026, Mar 2027 on fixture) — accepted,
  balances are the deliverable; flag to Tre in the final summary.
- Fixture is gitignored real data; tests self-skip without it. Supabase queries: always filter
  user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'. Never push. Browser `find` MCP tool burns
  rate limit — prefer screenshots+coordinates.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance test failures.
