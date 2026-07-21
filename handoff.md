# Handoff — 2026-07-20 (session 12 → 13) — cash-floor car/insurance FIXED; 4 items still queued

## DONE this session — commit `5194cf2b` (local only, NOT pushed)
**Car payment + insurance now reserved in the cash floor the month before they begin.**
- Root cause (two Q12 `5998c911` leftovers in `getAugmentedMinSafeCash`, `src/lib/pay-schedule.ts`):
  the car/insurance loops feed the NEXT-month pre-paycheck floor (via `duePostPaycheck`), but
  (1) the car loop sourced its amount from `getActiveCarLoanPayments([effective], now)` evaluated
  as-of the CURRENT month → a loan whose first payment is next month returned nothing; (2)
  `dueSynced` builds a CURRENT-month date but these are next-month obligations (never Plaid-synced
  yet) → any sync past the obligation's day-of-month nuked the reservation.
- Fix: car loop now evaluates `getActiveCarLoanPayments([effective], nextMonthStart)`; `dueSynced`
  removed from the car + insurance loops; insurance ownership check made next-month-aware.
- Proven on Tre's real C5 loan (payment_start 2026-08-07, $422.89 + insurance $173.23, due on Aug's
  first paycheck). 215/215 green (+2 regressions in `pay-schedule.augmentedFloorInsurance.test.ts`),
  tsc clean, NO golden re-pins. Backup: `backups/2026-07-20_222123/`. Memory updated
  (`project-cycling-debt-engine`, MEMORY.md unchanged — same index line covers it).
- **Left untouched on purpose:** the CC-minimum loop still applies `dueSynced` (same latent
  next-month bug, but feeds the sensitive month-0 debt convergence per Q8/Q11). Scoped follow-up
  only if Tre asks.

## STILL QUEUED (Tre raised these this session; #2 above was chosen first)
Both new symptoms are on **BOTH web + native** (Tre confirmed) → live-code bugs, not just the
stale native Capacitor bundle.

1. **Missing paycheck this month.** Config = weekly, Friday (day 5); July 2026 has 5 Fridays
   (3/10/17/24/31) → 5 paychecks. Current `getPaychecksInMonth` weekly path computes 5 correctly
   (verified). NEED: which SCREEN shows 4 (Dashboard monthly income? Forecast month-0? Budget
   Control?) — then trace that specific consumer. No service worker exists, so "older version" =
   native bundle, but since it's ALSO on web there's a live path to find.
2. **App reloads to the beginning while editing items.** No repro yet. On native, usually a webview
   reload (auth token refresh / a `window.location` reset). NEED: which items/page, and does it
   happen on web too (Tre said both). Check AuthContext refresh + any full-reload calls.
3. **Accordion multi-expand on /debt** (from session-11 handoff, still not done):
   `src/components/debt/CreditCardEngine.tsx:125-130` `expandedCard` (single) → make multi-expand
   (Set<string>), and `accordionYear` shared → per-card `Record<cardId, year>`. Toggle site ~1546.
4. **FB.9 future-start credit limit** (from session-11 handoff, still not done): exclude cards whose
   `card_start_date` is in the future from TOTAL LIMIT / utilization until that month. VX 10,000
   start 2026-12-20; Apple 10,000 start 2028-02-28; today's TOTAL should be $25,400 not $45,400.
   Sites: `CreditCardEngine.tsx:1038-1039`, `Dashboard.tsx:491`, `AiAdvisor.tsx:652-660`, per-month
   util rows `useCardProjection.ts:1067,1101` / `cardProjectionResim.ts:75,103` /
   `credit-card-engine.ts:1959-1965`. Helper exists: `src/lib/card-start-date.ts`.

## THEN — older backlog (unchanged)
- Supabase GoTrue `GOTRUE_JWT_DEFAULT_GROUP_NAME` deprecation (auth config/env).
- Google Play 5.44 / Android 15 edge-to-edge advisories (CI-owned builds).

## State / gotchas
- On `main`, clean except `backups/` (untracked, NEVER commit) and `graphify-out/` (gitignored).
- Local commits NOT pushed: this session `5194cf2b`, plus prior `64a1182b`/`6459f258`/`afd33160`/
  `2c491e87`. Push only when Tre asks.
- Supabase user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`; profiles PK `id` ≠ `user_id` (filter by
  `user_id`). Paychecks are NOT DB rows — synthesized from `profiles` pay config via pay-schedule.
- vitest hides console.log on passing tests: `--silent=false --reporter=verbose`.
- After code edits run `python -m graphify update .` (AST-only, no API cost) — done this session.
