# Handoff — 2026-07-17 09:35 — main — Q11 root-caused, fix fully designed, test at RED

## Goals

Q11 (Tre, verbatim): "i think discovers payments is counting for this month even though the
payment was due on the first. the min needs to be paid next month on the first though."

Fix: a revolving card whose current-month due date is on/before syncCutoffDate already made
this cycle's payment (live Plaid balance reflects it) — month 0 must NOT force its minimum
(Discover's $227 in July); the minimum obligation lands in month 1 (Aug 1). Optional/extra
paydown in month 0 stays allowed. Done = new test green, all existing tests green, live
verify on localhost:8080 (Tre is logged in), local commit.

## Current State — DIAGNOSIS COMPLETE, TDD RED CONFIRMED, ZERO SOURCE EDITS YET

- Live DB verified (Supabase mdtosrbfkextcaezuclh): Discover it Card id
  34c9574b-3557-4729-a812-f0b1b508b882, payment_due_day=1, min_payment=245 (not manual),
  balance 9300.10, preference 'full', statement_balance null. Only card affected today
  (Prime Visa due day 7 is an ISB-pin card, min manual $0; Apple/Venture X zero-balance).
- ROOT CAUSE: the floor side already treats a past-due-date min as settled
  (pay-schedule.ts getAugmentedMinSafeCash `dueSynced()` ~line 777 skips it from month-0
  floor), but the PAYMENT side never got that convention — the sim, hook month-0 block,
  recommendation summary, and forecast-engine all force the min in month 0.
- New test file committed at RED: `src/lib/__tests__/credit-card-engine.m0MinSettled.test.ts`
  — `npx vitest run src/lib/__tests__/credit-card-engine.m0MinSettled.test.ts`
  → 5 failed / 2 passed (the 2 passing are the unchanged-behavior controls). Expected:
  it imports `m0MinDueSettled` and uses `CardData.m0MinSettled`, neither exists yet.
- Backups of the 3 files to modify already taken: `backups/2026-07-17_093047/`.

## Active Files

- `src/lib/credit-card-engine.ts` — main edits (see Next Steps).
- `src/hooks/useCardProjection.ts` — stamp flag + month-0 min exclusions.
- `src/lib/forecast-engine.ts` — ccMinByMonth month-0 adjustment.
- `src/lib/__tests__/credit-card-engine.m0MinSettled.test.ts` — the RED test (committed).
- `src/lib/pay-schedule.ts` — READ ONLY reference: dueSynced() ~777 is the convention to mirror.

## Changes Made

- Committed this session: test file + backups + this handoff (see commit).
- NO source files touched yet — implementation is entirely pending.

## Failed Attempts

- None (no implementation attempted). Two IMPORTANT prior-art constraints:
  1. useCardProjection.ts ~1692-1708 (perCardAdjustedFinal): zeroing non-autopay cards'
     WHOLE month-0 payment was tried historically and reverted (comment in code explains:
     hid real debt, diverged from sim). Q11 fix is different — zero only the FORCED MINIMUM,
     at the ENGINE level, so sim and recommendation stay in agreement. Do not re-zero the
     whole payment there.
  2. Use the syncCutoffDate convention (due date string <= syncCutoffDate), NOT
     `dueDay < now.getDate()` — payment made but not yet Plaid-synced must still count
     (balance doesn't reflect it yet). No cutoff ⇒ never settled (conservative).

## Next Steps (exact implementation plan, all decided — just execute)

1. `src/lib/credit-card-engine.ts`:
   a. CardData: add optional field `m0MinSettled?: boolean` (~line 42, with JSDoc).
   b. Export helper (near revolvingMinDue ~line 155):
      `m0MinDueSettled(dueDay, syncCutoffDate, now)` → dueDay!=null && syncCutoffDate &&
      `${now-YYYY-MM}-${dd(dueDay)}` <= syncCutoffDate.
   c. simulateVariablePayoff — gate SIX month-0 min sites on `m === 0 && card.m0MinSettled`
      (zero the revolving-min part only; keep instMinPay — installments are separately
      cutoff-gated by deriveUpfrontPlanFields):
      - ~956 perCardMinPayments push: `(settled ? 0 : revMinPay) + instMinPay`
      - ~1089 reservedForRevolving revolving branch: `(settled ? 0 : revolvingMinDue(c, revBal)) + instMinPay`
      - ~1337 totalMins: settled → contribute 0
      - ~1409 FLOOR_BREACHED branch `min`: settled → 0
      - ~1446 Step 5a `min`: settled → 0
      - ~1488 minimum-enforcement guard `minRequired`: settled → 0 (skip)
      (Backlog cards: month-0 backlog is always 0 — no changes needed there.)
   d. buildCurrentMonthRecommendationSummary (~1731+, has syncCutoffDate param):
      - totalMinDue ~1746: settled non-ISB card contributes 0.
      - basePayment loop ~1857: settled non-ISB card → basePayment 0,
        reason 'Paid this cycle — minimum due next month', isMinimumOnly false.
        Leave the extra-allocation loop's maxExtra logic unchanged (extra still allowed).
2. `src/hooks/useCardProjection.ts`:
   a. Import m0MinDueSettled; at the `cards = rawCards.map(...)` block (~105-113) stamp
      `m0MinSettled: m0MinDueSettled(card.dueDay, syncCutoffDate, now)` on every card
      (restructure so the stamp applies with or without installment `derived`).
   b. ccMinByMonth ~997-1004: revolving branch contributes 0 when `m === 0 && c.m0MinSettled`.
   c. ccMinTotalRevolving ~1606-1611: exclude settled cards.
   d. Distribution block ~1659-1690: use `protectedMin = c.m0MinSettled ? 0 : c.minPayment`
      in ccMinSumActive, naturalExtraTotal, and perCardAdjusted's extra/payment math.
   e. Do NOT touch perCardAdjustedFinal autopay zeroing (~1696-1708).
3. `src/lib/forecast-engine.ts` ~911-944: compute
   `m0SettledCcMin = simCards.reduce(+ (c.m0MinSettled ? minPayment : 0))`; build ccMinByMonth
   when `manualIsbPins.length > 0 || m0SettledCcMin > 0`, with month-0 entry
   `ccMinTotal - m0SettledCcMin` (+ existing pin adjustment term; pins are months>0 only).
4. OPTIONAL consistency (check, decide then): CreditCardEngine.tsx ~234-237 builds its own
   cards for the Debt tab's internal sim — stamp the flag there too if it has syncCutoffDate.
5. Run: new test → green; then FULL `npx vitest run` (all engine tests must stay green);
   then `npx tsc --noEmit` (or the build) for types.
6. Live verify on localhost:8080 (Tre logged in): /forecast month-0 debt strip should drop
   Discover's $227 from July; August plan must still include Discover's min; August
   pre-paycheck floor must still reserve it (floor side already did). Check
   `window.__convergenceDebug.forecastResult` month0.safeToPayTotal.
7. Backup policy: backups already at backups/2026-07-17_093047/ — reuse it (same session's
   files, unmodified since backup). Commit locally `[debt]: Q11 due-day-settled month-0 min ...`.
   Never push.
8. After Q11: update project_cycling_debt_engine memory; then Q10 candidate (revolving dust
   nulls payoff months / suppresses CC Debt Free milestone) per previous handoff.

## Gotchas (carry forward)

- Repo PUBLIC — real-data fixtures stay gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED by Tre (current-month floor) — do not re-propose next-month.
- `window.__simDebug.raw` is PASS-0; SIM side = `__convergenceDebug.convergedProjection`;
  ENGINE rows = `__convergenceDebug.forecastResult`.
- Debt page is /debt; dev server localhost:8080; vitest needs --disable-console-intercept
  to show console.logs.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (currently 2 ≥ 1).
- q9 diagnostic harness: `npx vitest run src/lib/__tests__/q9-diagnostic.isbPullback.test.ts`
  (skip-if-no-fixture; fixtures gitignored; funding id 933cbc10-bceb-4c20-8227-4a02e6db728a).
