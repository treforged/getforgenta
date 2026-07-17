# Handoff — 2026-07-17 — main — Q11 RESOLVED (implemented, tested, live-verified, committed)

## Goals

Q11 (Tre): Discover's payment (due on the 1st) was still counted in this month's plan even
though that cycle was already paid; the next min belongs to next month. DONE.

## Current State — Q11 COMPLETE

- Implemented per the prior handoff's plan, all steps including the optional
  CreditCardEngine.tsx stamp (step 4).
- `m0MinDueSettled(dueDay, syncCutoffDate, now)` exported from credit-card-engine.ts;
  `CardData.m0MinSettled` stamped in useCardProjection.ts and CreditCardEngine.tsx.
- Six sim sites gated in simulateVariablePayoff; generateRecommendations totalMinDue +
  basePayment loop gated (reason: 'Paid this cycle — minimum due next month');
  useCardProjection ccMinByMonth / ccMinTotalRevolving / distribution (protectedMin helper);
  forecast-engine ccMinByMonth month-0 minus m0SettledCcMin (works with or without ISB pins).
- perCardAdjustedFinal autopay zeroing untouched (as required).
- Test `src/lib/__tests__/credit-card-engine.m0MinSettled.test.ts` GREEN (7/7). One test-case
  amendment was needed: the "tight month" case originally left $200 above the floor, so the
  avalanche legitimately cascaded optional extra to the settled card (which the spec allows);
  cash now sits exactly at the floor and the expected min uses the post-interest balance (3050).
- Full suite: 197/197 green. `npx tsc --noEmit` clean.
- Live-verified on localhost:8080 (Jul 17, cutoff ≥ Jul 15 so all four cards settled):
  Forecast month0 safeToPayTotal 0, Discover July $0 / Aug $245, Aug floor still reserves
  "Discover it Card min: 192.09", converged in 1 pass, no fallback. Debt tab: Minimums Due $0,
  Discover "Due Aug 1st", ETA 13 mo.
- Backups: backups/2026-07-17_093047/ (3 planned files from prior session + CreditCardEngine.tsx
  added from git HEAD this session).

## Next Steps

1. Q10 candidate: engine-layer revolving dust nulls simRevolvingPayoffMonth /
   forecastRevolvingPayoffMonth, likely suppresses the CC Debt Free milestone.
2. Anomaly A/B design calls pending; Stages 4-5 on hold.

## Gotchas (carry forward)

- Repo PUBLIC — real-data fixtures stay gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED by Tre (current-month floor) — do not re-propose next-month.
- `window.__simDebug.raw` is PASS-0; SIM side = `__convergenceDebug.convergedProjection`;
  ENGINE rows = `__convergenceDebug.forecastResult` (rows live at `.data[]`).
- Debt page is /debt; dev server localhost:8080; vitest needs --disable-console-intercept
  to show console.logs.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (currently 2 ≥ 1).
- q9 diagnostic harness: `npx vitest run src/lib/__tests__/q9-diagnostic.isbPullback.test.ts`
  (skip-if-no-fixture; fixtures gitignored; funding id 933cbc10-bceb-4c20-8227-4a02e6db728a).
