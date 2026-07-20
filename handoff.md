# Handoff — 2026-07-20 (session 11 → 12) — two fixes DIAGNOSED, not implemented; then backlog

## Goal (Tre's request this session)
1. Fix the accordion UI on /debt (Debt Payoff, Credit Card Payoff tab).
2. Fix FB.9 "total credit limit" — REAL ROOT CAUSE ESTABLISHED (see below, NOT inactive cards).
3. Then triage the queued backlog (GoTrue env deprecation, Play 5.44 advisories — bottom).

NO SOURCE EDITS made this session. Anomaly B was closed earlier this session (live-verified,
memory + MEMORY.md already updated, handoff commit afd33160).

## Fix 1 — accordion: allow multiple cards expanded at once
- `src/components/debt/CreditCardEngine.tsx:125-130`:
  `expandedCard` (usePersistedState<string|null> 'tre:debt:expanded-card') = single-card
  accordion — expanding one collapses the other. Tre wants independent expansion.
- GOTCHA: `accordionYear` ('tre:debt:accordion-year', '1'|'2'..'5') is SHARED state,
  deliberately (2026-06-21 session: "shared state since only one card is ever expanded at a
  time"). Going multi-expand REQUIRES per-card year state (e.g. Record<cardId, year> or move
  year state into the per-card render). Toggle site: line ~1546-1552 (`isExpanded =
  expandedCard === proj.card.id`, button setExpandedCard(...)).
- Suggested: expandedCards as Set<string> persisted (see Builds.tsx expandedPhaseIds pattern),
  year as Record<string, '1'..'5'>. Keep persisted-state keys NEW (old key holds a string).

## Fix 2 — FB.9 total credit limit: FUTURE-START cards, NOT inactive cards
- Tre's clarification (2026-07-20, authoritative — FB.9's wording was wrong): "some cards have
  a start date thats in the future. its limit should not be included until that time comes."
- Verified in DB (accounts, Tre's user_id): Venture X credit_limit 10,000 card_start_date
  2026-12-20; Apple Card 10,000 start 2028-02-28; PV 14,400 + Discover 11,000 start null.
  All 4 active. So today's TOTAL LIMIT should be $25,400, not $45,400.
- Existing helper: `src/lib/card-start-date.ts` (future-card detection; engine already excludes
  future cards from purchases via CardData.startDate, credit-card-engine.ts:280).
- Sites that sum credit limits (ALL currently include future cards):
  - `src/components/debt/CreditCardEngine.tsx:1038-1039` header TOTAL LIMIT + overallUtil (/debt).
  - `src/pages/Dashboard.tsx:491` ccLimit.
  - `src/pages/AiAdvisor.tsx:652-660` per-card limit list.
  - PER-MONTH utilization rows (should count a card's limit FROM its start month, per "until
    that time comes"): `src/hooks/useCardProjection.ts:1067,1101`,
    `src/hooks/cardProjectionResim.ts:75,103`, `src/lib/credit-card-engine.ts:1959-1965`.
    CardData.startDate is available in those scopes (check month index vs start month).
  - Accounts page per-card display (Accounts.tsx:772 etc.) is per-card info, leave alone.
- Decide during implementation: month-0/header = exclude cards whose start month > current
  month; monthly rows = include from the month containing card_start_date onward. Keep display
  vs engine distinction: engine cash math does NOT use totalLimit (display/utilization only) —
  verify no behavioral goldens shift (utilization is displayed in accordion rows + fixtures may
  pin it: check goldens/tests mentioning utilization before changing the per-month functions).
- FB.9 in memory/project_roadmap.md should be reworded to the future-start semantics when done.

## Verification after both fixes
- tsc + full vitest (213 tests green baseline). Live check /debt: TOTAL LIMIT $25,400,
  utilization recomputed (16,286/25,400 ≈ 64%), two cards expandable simultaneously with
  independent year navigators. Backups to ./backups/YYYY-MM-DD_HHMMSS/ before edits; commit
  locally, never push.

## THEN — queued backlog from Tre (unchanged, not started)
- Supabase deprecation: GOTRUE_JWT_DEFAULT_GROUP_NAME not supported by GoTrue, removal soon —
  find where it's set (Supabase project auth config/env) and remove/migrate.
- Google Play (release 5.44), Android 15 edge-to-edge: deprecated Window.setStatusBarColor /
  setNavigationBarColor (minified "n1.c.a" — likely a Capacitor plugin, check versions first);
  R8: optimization off, 25% obfuscation/shrink, AGP 9.0+ suggested. Advisory; builds CI-owned.

## State
- On `main`, clean except backups/ (untracked, never commit). Local commits NOT pushed
  (64a1182b Anomaly A, 6459f258 Anomaly B, afd33160 + this handoff) — push only when Tre asks.
- Anomaly B: CLOSED (live-verified session 11; memory updated). Stages 4-5 on hold.

## Gotchas (carry forward)
- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push unless asked.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- otherAccountExpense suite runs on the REAL clock — assertions must stay cumulative/clock-robust.
- Payoff pins are Jul 2027 everywhere (incl. goldenTierA). Fixture has native paymentPlans.
- perCardPayments are ROUNDED ints; Anomaly A clamp-note threshold is 0.5.
- Card panels' override/pin state persists across collapse; pin is useState (reload clears).
