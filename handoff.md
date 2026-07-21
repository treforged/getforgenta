# Handoff — 2026-07-21 (session 15 → 16) — NEW confirmed bug + Tre-approved fix: month-0 debt cap under-counts outflows → Discover overpays, current month breaches floor. Savings framing CLOSED (WAI).

## IN PROGRESS (session 15, diagnosed + Tre approved "full lean-fix", NOT yet edited) — Discover doesn't pull back to meet current-month floor
**Symptom (Tre, live):** July 2026 (current month) Ending Cash $2,966 < augmented floor $3,145 (~$179 below).
Tre: "shouldn't Discover payment this month just pull back to meet floor? why isn't it?"

**Root cause (code-confirmed, live-data-confirmed):** Discover's real minimum is only **$253** (Prime Visa
min $0), but it's paying **$1,479** — a discretionary avalanche paydown, NOT a forced minimum. The
month-0 revolving-payment cap DOES clamp to the augmented floor
(`src/hooks/useCardProjection.ts:1639-1642`: `availableForRevolving = Math.max(ccMinForMonth,
max(0, cashPreDebt - m0FloorAugmented - cyclingPayment))`), but the **cash figure it caps against is
too high**:
- `useCardProjection.ts:1638`: `const cashPreDebt = debtFundingBalance + m0Income - m0Expenses
  - monthlySavingsAndCar - m0VehicleInsurance - m0MortgagePayment;`
- vs the real End-Cash math `src/lib/forecast-engine.ts:1106` which ALSO subtracts **`transfersOut`**
  (= `b.monthTransfers`, incl. Tre's **$25 Roth IRA investment rule**), **`lumpTransferThisMonth`**
  (goal lump-sum transfers), and applies **`+ b.oneTimeNet`**.
- `monthlySavingsAndCar` (`useCardProjection.ts:1216` = goalContrib + carReserve + carLoanTotal) does
  NOT include investment/transfer rules, so the $25 (+ lump + one-time) escape the cap. Cap thinks it
  has ~$179 more spendable-above-floor than reality → authorizes ~$179 too much Discover paydown → the
  Forecast row lands $179 below the displayed floor. (The floor itself matches: `m0FloorAugmented`
  uses the same `getAugmentedMinSafeCash`, `useCardProjection.ts:1620-1629`.)

**THE FIX (Tre approved "Yes — fix it (full lean-fix)"):** make `useCardProjection.ts:1638` mirror
`forecast-engine.ts:1106` by subtracting the missing month-0 outflows. Both needed values are ALREADY
in scope:
- `m0Transfers` (`useCardProjection.ts:750-777`, remaining-after-cutoff transfer total; the $25).
- `lumpTransferByMonth[0]` (`useCardProjection.ts:717`).
- one-time net for month 0 (`oneTimeArr[0]` .income/.expenses; $0 for Tre's July, but add for parity —
  forecast does `+ b.oneTimeNet`).
So: `cashPreDebt = debtFundingBalance + m0Income - m0Expenses - monthlySavingsAndCar
- m0VehicleInsurance - m0MortgagePayment - m0Transfers - lumpTransferByMonth[0] + m0OneTimeNet`.
**DO NOT add all of `m0ExtraOutflow` (line 797)** — it re-includes m0Savings/m0CarSaving/carLoan/
vehicle/mortgage already covered by `monthlySavingsAndCar` + `m0VehicleInsurance` + `m0MortgagePayment`
→ double-count. Only the 3 terms above are missing.

**⚠️ UNRESOLVED — VERIFY BEFORE CLAIMING FIXED:** static analysis only accounts for $25 (transfers) of
the observed ~$179 gap. The other ~$154 is NOT yet explained and may be a SEPARATE issue:
(a) acknowledged `m0Income` vs forecast `netIncome` drift (~$20, code comment `useCardProjection.ts:379-381`);
(b) the displayed breakdown itself doesn't sum — screenshot lines total $3,121 but Ending shows $2,966
(~$155 hidden), likely **cycling debt on Prime Visa** folded into `monthDebtPayment`
(`forecast-engine.ts:1121` ledgerEntry.total) but not shown as its own popup line (per-card scaling
`Forecast.tsx:973-978`). Next agent MUST instrument/verify Tre's actual numbers (or a test) to confirm
whether the transfers fix fully closes the floor gap or only partially — do NOT report "fixed" on the
one-line change alone.

**EXECUTION CHECKLIST (next session):**
1. `git`/backup: copy `src/hooks/useCardProjection.ts` to `./backups/YYYY-MM-DD_HHMMSS/src/hooks/`.
2. Edit line 1638 as above (add `- m0Transfers - lumpTransferByMonth[0] + m0OneTimeNet`).
3. Add a regression test mirroring existing floor tests (e.g. `pay-schedule.augmentedFloorInsurance`
   or the `pinnedOverride`/`useCardProjection.carEarmark` patterns): a monthly transfer rule in month 0
   must reduce `month0.safeToPayTotal` (or keep Ending ≥ floor). vitest: `--silent=false --reporter=verbose`.
4. Run FULL suite (`npm test`) — watch goldenTierA payoff (currently pinned **Jul 2027**) for re-pins;
   this cap change can shift tuned convergence. If a golden re-pins, confirm it's intended before repinning.
5. `tsc` clean; `python -m graphify update .`; commit LOCAL only (never push). Backup path in summary.
6. Verify against Tre's live July: Ending Cash should rise toward the $3,145 floor. If still below after
   the transfers fix, investigate the ~$154 cycling/income residual (item ⚠️ above) as a follow-up.

Supabase facts (confirmed session 15): user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`, project
`mdtosrbfkextcaezuclh`, cash_floor $2,700 (base) / $3,145 (augmented July). Discover bal $9,608.64
min $253 apr 19.49 due_day 1; Prime Visa bal $6,677.62 min $0 due_day 7; Apple/Venture X $0. Liquid:
TOTAL CHECKING $1,999.65, Checking $5, General Operations $57.24, Savings $106.17. Investment rules:
"Roth IRA" $25/mo rule_type=investment due_day 28 start 2026-07-15 → Roth IRA acct; "Robinhood
Contributions" $25 due_day 5 (settled pre-cutoff, excluded from remaining). Car fund in `loan` phase.

## CLOSED this session (15) — "current month drops below cash floor because of savings" = WORKING AS INTENDED, no code change (savings framing only)
Tre's report: July 2026 (current month) End Cash goes below the cash floor and he attributed it to
discretionary **savings** ("when it is saveable"). Investigated end-to-end against live Supabase
data (user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`). Findings:

- **Session 14's diagnosis was WRONG.** `monthlySavingsContrib` (savings goals) and car saving-phase
  contribs are BOTH $0 in the current month:
  - 401K Roth ($236.82) + Roth IRA ($0) → linked to retirement accounts (`401k`/`roth_ira`) →
    excluded as paycheck deductions (`forecast-engine.ts:874`, retireTypes `['roth_ira','401k','ira','hsa']`).
  - Brokerage ($25) + Emergency Fund ($100) → `contribution_start_date = 2027-01-28` → not active
    until Jan 2027 (`forecast-engine.ts:873`).
  - Car fund is in `loan` phase (purchased 2026-06-21) → no saving-phase contribution.
  - So `savingsOut = 0` for July. The month-0 proration hypothesis was moot (nothing to prorate).
- **The real "− Roth IRA $25" line** Tre saw is a **recurring rule** (NOT a savings goal): name
  "Roth IRA", `rule_type='investment'`, $25/mo, due_day 28, start 2026-07-15, deposits into the
  Roth IRA account. Engine folds `investment`+`transfer` rules into `transferRulesAll`
  (`forecast-engine.ts:551`) → `monthTransfers` → `transfersOut` → subtracted in `cashPreDebt`
  (line 1104/1106) with NO floor guard. A second $25 investment rule ("Robinhood Contributions",
  due_day 5) is settled before syncCutoffDate 2026-07-20, so only the due-28 Roth IRA one shows in
  the "remaining of month" breakdown. Display is internally consistent.
- **The breach is mostly STRUCTURAL, not savings.** July: Current Cash ~$2,000, Ending ~$2,966 vs
  augmented floor $3,145 (= base cash_floor $2,700 + ~$445 reserved upcoming bills). Even zeroing
  the $25 leaves ~$2,991 < $3,145. Debt (Discover $1,479) is already floor-clamped to the BASE
  floor; the augmented floor sits above remaining cash because current liquid is genuinely low.
- **Tre's decision (AskUserQuestion, session 15): "Keep honest (leave as real outflows)" — NO engine
  change.** The scheduled auto-contributions are real money movements; the forecast should show them
  firing and the honest below-floor result, not optimistically assume he'll pause them. The global
  `pauseSavings` toggle already models pausing if he wants it. **DO NOT re-open / do not add
  per-month savings floor-suppression** unless Tre explicitly reverses this.
- No files changed, no commit (other than this handoff), no backup this session.

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
