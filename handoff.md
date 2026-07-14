# Handoff — 2026-07-14 — Q3 shipped + Q2 concluded; Q1 override-rebalance remains

## STATE
- **Q3 DONE, commit `4e5be68e`** — "Interest-saving balance" inline field added to
  CreditCardEngine.tsx under the Payment-type selector, statement-preference cards only.
  Shows "Auto ($balance)" when `statement_balance` is null; manual value + "manual" badge +
  edit (Edit2) + revert-to-auto (RotateCcw, sends null) otherwise. Reuses the existing
  `handleSaveStatementBal` (gained optional `rawValue` param so the revert button reuses it).
  Verified: tsc clean, 165/165 tests, live round-trip on Prime Visa (set $5,500 → whole
  projection re-ran → reverted → Auto ($6,004)). Backup: backups/2026-07-14_001159/.
- **Q2 CONCLUDED (report given to user)** — After Prime Visa full→statement correction
  (07-13), Forecast shows ONE breach milestone: May 2027, ending cash $2,798 vs $2,800 floor
  ($2, rounding-level). Feb 2027 lands exactly at floor. CC Debt Free Jul 2027. `__simDebug`
  re-pulled 07-14: save-up months Jul 2027+ cap revolving pool at $222 minimums; mandatory
  statement/cycling payments (~$450+/mo) remain uncapped by design. Verdict: working as
  designed; throttling statement cards is the only residual lever (bigger-scope option the
  user previously did NOT pick).

## NEXT: Q1 override-rebalance feature (user-approved, NOT STARTED)
Make a per-month per-card payment override re-route freed/consumed cash across the other
cards (respect avalanche/snowball strategy, minimums, cash floor). Design fork is OPEN —
asked user 2026-07-14, answer pending:
  (a) re-run the allocation (`buildCurrentMonthRecommendationSummary`,
      credit-card-engine.ts ~:1636-1726) with the overridden card pinned, or
  (b) lighter local redistribution inside CreditCardEngine.tsx's `projections` useMemo.
Context: `handleOverrideMonth` (CreditCardEngine.tsx:1039 area) sets
`overrides[cardId][monthIdx]`; applied only to that card's forward walk via
`projectCardVariable`. Other cards come from the `perCardPayments` prop (the sim) which
ignores overrides. This is non-trivial multi-concern work → /multi-plan first, backup
before editing.

## ENVIRONMENT
- Dev server http://localhost:8080 running; browser tab group logged in (tab IDs go stale
  across sessions — call tabs_context_mcp fresh).
- `window.__simDebug` live on /debt: `.rows(36)` / `.csv(36)`. No floor/endingCash columns.
- Supabase MCP works; ALWAYS filter by user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Real card data: Discover $8,449 / 19.49% / min $222 / full-pref; Prime Visa $6,004 /
  27.49% / min $0 manual / statement-pref / statement_balance null (Auto).
- Stale fixture src/lib/__tests__/fixtures/forecast-inputs.real.json (2026-07-03, gitignored)
  — predates recent purchases + statement switch.

## GUARDRAILS
- Repo is PUBLIC. Captured sim/fixture data holds real financial data — never commit.
- Never push unless asked. Back up files to ./backups/YYYY-MM-DD_HHMMSS/ before editing.
