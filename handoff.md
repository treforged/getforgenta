# Handoff — 2026-07-21 (session 14 → 15) — paycheck-display FIXED + NEW in-progress: savings breaches current-month floor

## IN PROGRESS (session 14, NOT yet started implementing) — "current month drops below cash floor when it is saveable"
Tre's new report (right after the paycheck fix): the CURRENT month's End Cash goes below the cash
floor, and the culprit is discretionary **savings**. "when it is saveable" = the money pushing it
below is savings (goals + car-fund saving-phase contributions), which is skippable — so it should
NOT force a floor breach.

**Diagnosis so far (high confidence, code-confirmed, NOT yet verified against Tre's live numbers):**
- `src/lib/forecast-engine.ts` Step 1 (line ~1102-1106): `savingsOut = monthlySavingsContrib +
  carContribThisMonth` is subtracted as a plain outflow in `cashPreDebt` BEFORE the debt step.
- Only DEBT payments are floor-aware (Step 2/3, lines ~1108-1169: the sim clamps debt down to stay
  above `step3SpendFloor`). Savings has NO floor cap.
- There IS a global `pauseSavings` boolean (forecast-engine line 115, 259, 349) that zeroes ALL
  savings+car contributions, but it's an all-or-nothing user toggle, not a per-month floor guard.
- So when savings is on and savings > headroom above floor, the current month shows a (arguably
  false) floor breach. Tre wants savings to yield to the floor.
- POSSIBLE INTERACTION w/ the paycheck fix (same session): month 0's `b.netIncome` is REMAINING
  income (post-sync, partial) but `monthlySavingsContrib` is the FULL month amount (line 872, not
  prorated). If part of the month elapsed, full savings is subtracted against partial income →
  month 0 can dip below floor. Worth checking whether savings should be prorated/remaining for
  month 0 the same way income is. (Our chip change was display-only; it did NOT change this math,
  but it made the reduced current-month income visible, which may be why Tre noticed the breach now.)

**NEXT STEPS (do these in order):**
1. Pull Tre's live data to CONFIRM savings is the cause & quantify (queries half-done this session):
   `savings_goals` (contribution amounts, contribution_start_date, linked_account, active),
   `car_funds` (phase='saving', monthly contribution fields), profile `cash_floor`, funding-account
   balance. user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`, project `mdtosrbfkextcaezuclh`. Tables
   confirmed: `savings_goals`, `car_funds`. (recurring_rules/budget_items are the rule tables.)
2. **STOP and ask Tre (AMBIGUITY RULE — this is a financial-engine behavior change w/ debt-engine
   ripple):** desired behavior + scope. Key decisions: (a) cap savings to protect the floor
   automatically vs keep manual `pauseSavings`? (b) current-month only, or all months? (c) reduce
   goal savings, car-fund saving, or both, and in what priority vs debt? (d) is this really the
   month-0 partial-income-vs-full-savings mismatch (→ prorate month-0 savings) OR a general
   "savings must respect floor" rule? These are different fixes — do NOT guess.
3. Only then implement (lean-fix: strong model owns root-cause; backup to ./backups/ first; keep
   diff scoped; tsc + pay-schedule/forecast tests; `python -m graphify update .`; commit local only).

## DONE this session (14) — commit `3d1832d5` (local, NOT pushed) — "missing paycheck this month" = NOT a bug, display-only UX fix
Screen was the Forecast **current-month row**. Root cause: current-month `+Income` shows only
paychecks REMAINING after last Plaid sync (`syncCutoffDate`); already-received ones are folded into
Current Cash — the reduced income read like a missing paycheck. Verified vs Supabase: weekly/Fri,
net $848.89/check ("Weekly Paycheck" rule due_day 5 active); July Fridays 3/10/17/24/31 = 5; all
Plaid items synced 2026-07-20 → Jul 24+31 in +Income, Jul 3/10/17 in Current Cash. Total 5, nothing
lost. The "4" was earlier in the month (1 banked, 4 remaining). Paychecks are NOT DB rows
(synthesized). **Fix:** `src/pages/Forecast.tsx` collapsed current-month row now shows a chip
"⏱ rest of month · N paycheck(s) received" when N>0 (received = paychecks dated ≤ syncCutoffDate).
Display-only, no math/engine change. tsc clean; pay-schedule tests 12/12 green; graph updated.
Backup `backups/2026-07-21_090953/`.

---
# (prior) Handoff — 2026-07-20 (session 13 → 14) — cash-floor "missing after current month" CLOSED (no change, WAI); 4 items still queued

## Session 13 decision — car/insurance "missing in floor after current month": WORKING AS INTENDED, no code change
Tre asked why the C5 loan ($422.89) + insurance ($173.23) show in the CURRENT month's floor but
vanish in every later month, and expected them persistent-until-payoff. Traced it:
- The augmented floor only reserves an obligation due BEFORE next month's first paycheck
  (`duePostPaycheck`, `src/lib/pay-schedule.ts:808`). C5 is due the **7th**.
- July→Aug: Aug's first Friday paycheck is **Aug 7**, so the 7th is on/before it → reserved → shows.
- Aug→Sep onward: the first Friday paycheck lands on the **2nd–6th** (before the 7th) → the paycheck
  covers it → correctly dropped. Only month 0 happens to align.
- Payoff auto-removal already works: loan sources from `getActiveCarLoanPayments` (returns nothing
  past term); insurance intentionally persists after payoff (you still pay insurance).
- **Tre chose "Leave as-is (it's correct)"** in a 3-way clarify (display-only persistent / reserve-
  every-month / leave-as-is). The car payment is already modeled as a monthly EXPENSE
  (`vehicleForecastByMonth`); the floor only holds the pre-paycheck TIMING gap, so force-reserving
  it every month would double-count and could shift the tuned debt payoff. DO NOT re-open this.
- No files changed, no commit, no backup this session.

---
# (prior) Handoff — 2026-07-20 (session 12 → 13) — cash-floor car/insurance FIXED; 4 items still queued

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

1. **Missing paycheck this month — RESOLVED (session 14), display-only UX fix.** NOT a lost
   paycheck. Screen = Forecast **current-month row**. Root cause: the current-month `+Income` shows
   only paychecks REMAINING after the last Plaid sync (`syncCutoffDate`); paychecks already received
   this month are folded into **Current Cash**, so the reduced income read like a missing check.
   Verified against real data (Supabase): weekly/Fri, net $848.89/check ("Weekly Paycheck" rule,
   due_day 5, active); July Fridays 3/10/17/24/31 = 5; all Plaid items synced 2026-07-20 →
   `syncCutoffDate=2026-07-20` → Jul 24+31 shown in +Income, Jul 3/10/17 in Current Cash. Total 5,
   nothing lost. The "4" was seen earlier in the month (1 banked, 4 remaining). Paychecks are NOT DB
   rows (synthesized). Fix: `src/pages/Forecast.tsx` collapsed current-month row now shows a chip
   "⏱ rest of month · N paycheck(s) received" when N>0 (received = paychecks with date ≤
   syncCutoffDate). Display-only, no math/engine change; tsc clean; pay-schedule tests green.
   Backup `backups/2026-07-21_090953/`.
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
