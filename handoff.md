# Handoff — 2026-07-07 (session 3) — branch debt-model-fixes-p0

## Status: Option A CC display unification SHIPPED + LIVE-VERIFIED ✅

Commit `75eef32` ([forecast/debt]: unify per-card CC balance display via step3-display helper).
All surfaces (Forecast month popup, CSV export getCreditCardBalances, Debt Payoff accordion
Start/End + gated rows + chart) now derive revolving card balances via the shared
`src/lib/step3-display.ts` helpers (sim balance − cumulative PASS-3 surplus, floored at 0,
gated on monthlyRevolvingBalances > 0; cycling statement balances untouched).

Live verification (localhost:8080, 2026-07-07):
- Sep 2026 popup: Prime $4,060 / Discover $6,377 — accordion Sep 2026 End: $4,060 / $6,377 ✓
- Popup per-card lines now sum to Total CC ($10,436, $1 rounding) ✓
- Accordion rows reconcile: End = Start + purchases + interest − payment − surplus ✓
  (Prime Sep: 4,863 + 148 + 6.55 − 860 − 98 = 4,060)
- ETA 14 mo == milestone Aug 2027 == Discover payoff month — internally consistent ✓
- Tests: suite green except 3 known pre-existing activeLoanInsurance failures; tsc clean.

Known accepted gap (this IS Phase 2): popup PAYMENT lines still diverge from accordion
payment+surplus in months where the engine cash walk clamps/exceeds the hook plan
(live Sep 2026: popup Prime payment $1,260 vs accordion 860+98=$958).

## Next: Phase 2 — Option C convergence rework (USER-CONFIRMED: "we want no gaps")
Dedicated session; plan before touching code. Scope: feed the forecast's ACTUAL monthly debt
cash (engine walk) back into the card sim so sim balances/payments/extras reflect real routing —
converge the two walks into one.
- READ memory `project_cycling_debt_engine` first — this was attempted before and REVERTED
  repo-wide; understand why it failed before designing.
- Constraints: simulateVariablePayoff params are positional (new ones at END); golden Tier-A
  fixture re-pin only with live-data justification; TDD against
  src/lib/__tests__/fixtures/forecast-inputs.real.json (gitignored, tests self-skip without it);
  iterate engine→sim→engine to a fixed point with bounded iteration count.
- Definition of done: popup payments == accordion payments+surplus AND balances == every month,
  no ETA/milestone regression, Ending Cash consistent with displayed debt.
- Root-cause context (session 2, confirmed): hook replica pass-3 walk
  (useCardProjection.ts ~1353-1404 → pass3RevTotals → extraPerCardByMonth/surpluses) vs engine
  step-3 walk are structurally divergent in BOTH directions (fixture: Jul/Aug 2026 floor-clamp,
  Mar 2027 +$702 engine-only surplus).

## Gotchas (carry forward)
- Do NOT feed adjusted display balances into projectCardVariable / payoff detection.
- Supabase: always filter user_id='a72f416e-433a-4055-9ab0-9feae4e60edf'. Never push.
- Browser `find` MCP tool burns rate limit — prefer screenshots+coordinates.
- 3 activeLoanInsurance test failures are pre-existing backlog — don't chase.

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring;
3 activeLoanInsurance test failures.
