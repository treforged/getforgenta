# Handoff — 2026-07-22 (session 19 → 20) — TIMEZONE FIX VERIFIED LIVE (both checks now show). NEW in-progress issue: month-0 Discover payment does NOT pull back to hold the cash floor. Diagnosis started, exact live numbers captured. NO new code edited session 19.

## SESSION 19 — timezone fix (653dd200) LIVE-VERIFIED on localhost web: July now shows BOTH paychecks (~$1,698). ✅
Then Tre surfaced the NEXT problem (the session-15/16 residual, now isolated from the paycheck bug):
**Month-0 Discover payment ($1,729) does NOT clamp down to keep Ending Cash ≥ floor.**

### Exact live numbers (localhost web, current code + 653dd200):
- Current Cash **$2,000**; +Paycheck **~$1,698** (2 checks ✓); +Other Income **$1,100**; −Bills **$0**;
  −Discover it Card **$1,729**; −Vehicle Insurance **$173**; −Roth IRA **$25**; +One-Time **$0**.
- **Ending Cash $2,969**; **Cash Floor $3,145** → **$176 BELOW floor.**
- ⚠️ TWO unreconciled gaps to chase:
  (1) Displayed lines sum to 2000+1698+1100−1729−173−25 = **$2,871**, but Ending shows **$2,969** → **~$98 unshown
      POSITIVE** (an add-back or a line smaller than assumed — maybe Discover in the endingCash math ≠ the $1,729
      shown, or a carReserveHeld-style add-back). RECONCILE THIS FIRST — it may explain part of the $176.
  (2) Ending is $176 under floor while paying $1,729. If the cap were BINDING it would pay ~$1,553 and land exactly
      on $3,145. So the cap is NOT binding → `availableForRevolving ≥ 1729` → `revolvingPayment = simRevolvingTotal`
      (full simulated Discover). That means `cashPreDebt − m0FloorAugmented − cyclingPayment ≥ 1729`, i.e. the cap's
      `cashPreDebt` OVERSTATES real spendable-above-floor cash by ≥ ~$176.

### Cap logic (READ this session — src/hooks/useCardProjection.ts:1620-1656):
```
m0FloorAugmented = getAugmentedMinSafeCash(...).monthMinSafe            // 1623
cashPreDebt = debtFundingBalance + m0Income - m0Expenses - monthlySavingsAndCar
            - m0VehicleInsurance - m0MortgagePayment - m0Transfers - lumpTransferByMonth[0] + m0OneTimeNet   // 1650
availableForRevolving = max(ccMinForMonth, max(0, cashPreDebt - m0FloorAugmented - cyclingPayment))          // 1652
revolvingPayment = min(simRevolvingTotal, availableForRevolving)                                             // 1655
```
0e79c5c0 already added the transfer/lump/oneTime terms (the $25 Roth). Remaining ~$176 is elsewhere.

### PRIME SUSPECTS for the cap overstating cash (next session — INSTRUMENT, don't infer):
- **`debtFundingBalance` (cap) vs engine `liquidBal` (starting cash / "Current Cash $2,000").** Cap likely uses ONLY
  the funding account ($1,999.65); if the engine's endingCash starts from a different base, they diverge.
- **`m0Income` (cap) vs engine `netIncome`.** Known ~$20 drift comment (useCardProjection.ts:379-381). With 2 checks
  now correct, re-measure. Could the cap's m0Income be summing something the engine's paycheckIncome+otherIncome
  path doesn't (or vice versa)?
- **`m0FloorAugmented` vs the displayed `row.monthMinSafe` ($3,145).** Confirm the cap's floor == the displayed floor.
  If the cap uses a LOWER floor internally, it authorizes too much.
- **Prime Visa cycling (~$80) folded into `monthDebtPayment`/`cyclingPayment`** but the popup only itemizes Discover
  (Forecast.tsx:954-957 month0.perCardAdjusted). May relate to the $98 display gap.

### NEXT STEPS (do in order):
1. Add temporary console.log in useCardProjection.ts right after line 1656 dumping: debtFundingBalance, m0Income,
   m0Expenses, monthlySavingsAndCar, m0VehicleInsurance, m0MortgagePayment, m0Transfers, lumpTransferByMonth[0],
   m0OneTimeNet, cashPreDebt, m0FloorAugmented, cyclingPayment, ccMinForMonth, availableForRevolving, simRevolvingTotal,
   revolvingPayment. Have Tre reload localhost, read console (or use claude-in-chrome on localhost) to get REAL values.
2. Separately dump the engine's month-0 endingCash + its cashPreDebt terms (forecast-engine.ts ~1106) for the SAME run.
3. Diff the two cashPreDebt computations term-by-term → the ~$176 (and ~$98) will fall out of one specific term.
4. Fix at the CAP layer (useCardProjection.ts) so cashPreDebt matches the engine's endingCash base. DO NOT touch the
   tuned debt convergence. Then availableForRevolving binds and Discover pulls back to hold $3,145.
5. Backup, add/extend a floor-cap regression test, full suite (watch goldenTierA Jul 2027), tsc, graphify, LOCAL commit.
6. Live re-verify: Ending should clamp to exactly $3,145.

### Session-19 commits (LOCAL, NOT pushed): 653dd200 (tz fix), fb9a6e24 (session-18 handoff). Push only if Tre asks.
### Backup this session: backups/2026-07-22_004304/src/lib/scheduling.ts. Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf, project mdtosrbfkextcaezuclh.

---

# Handoff — 2026-07-22 (session 18 → 19) — ROOT CAUSE FOUND + FIXED (commit 653dd200, LOCAL, NOT pushed). The "dropped paycheck" is a TIMEZONE bug, not what session 17 hypothesized. HYS and Bug 3 were non-issues.

## SESSION 18 — SHIPPED `653dd200` (local): scheduled-event dates now formatted in LOCAL time, not UTC.
**Root cause (confirmed by live repro on America/New_York):** `generateScheduledEvents` (src/lib/scheduling.ts)
seeded each event with the current LOCAL wall-clock time, then formatted with `d.toISOString().split('T')[0]`
(UTC). For EVENING loads in ET (UTC-4), every generated date shifted +1 calendar day: Jul 31 9pm ET → "2026-08-01"
→ leaked into August → the current-month forecast filter (`e.date > syncCutoffDate` within monthKey) dropped it.
Symptom: July showed 1 paycheck ($849) not 2 ($1,698) → Ending Cash below floor. Repro table: 9:10am/1:10pm ET
→ [Jul24, Jul31] (2 ✓); 9:10pm/11:30pm ET → [Jul25] only (1 ✗). Tre's screenshot was timestamped 9:10 (PM).
**Fix:** new `toLocalDateStr()` helper (local getters); all 4 gen branches (weekly/biweekly/monthly/yearly) +
`getUpcomingEvents` window bounds use it. Aligns with every consumer (monthKey/syncCutoffDate already local).
**Verify:** new src/lib/__tests__/scheduling.localDate.test.ts (2 tests, evening-load end-of-month payday stays in
month). Full suite **218 green, NO golden re-pins** (goldenTierA still Jul 2027 — fixtures carry pre-generated event
dates so golden path doesn't re-run generation). tsc clean. graphify updated. Backup:
backups/2026-07-22_004304/src/lib/scheduling.ts.

### The other two session-17 "defects" were WRONG (data-verified via Supabase):
- **HYS $100 is NOT missing-in-error** — the HYS rule `start_date = 2027-06-20`, so it correctly does not appear in
  a Jul 2026 breakdown. Not a bug.
- **Bug 3 "below floor"** was just the visible symptom of the paycheck bug; resolves once dates are fixed.
- Session-17 Bug 2 (popup non-reconcile) was computed off the STALE 1-paycheck screenshot; re-evaluate against live
  numbers only if it still doesn't sum after this fix.

### ⚠️ NEXT — LIVE VERIFY (do FIRST next session):
Have Tre reload getforgenta.com (any time of day now) → July current-month +Paycheck should show **~$1,698 (2 checks)**
and Ending should clear the $3,145 floor. If a MORNING load already showed 2 (it did in repro), the real test is an
EVENING reload now showing 2 as well. Commit `653dd200` is LOCAL only — push only if Tre asks (needed for a native
build to carry the fix to his phone).

---

# (superseded) Handoff — 2026-07-21 (session 17 → 18) — PLAN-FIRST diagnosis of Tre's new screenshots: month-0 has THREE defects. Root cause of "below floor" = a DROPPED PAYCHECK. No code edited session 17 (Tre said "plan first"); session-16 fix (0e79c5c0) is PUSHED + iOS build uploaded.

## SESSION 17 — diagnosis complete, NO edits yet (Tre: "plan first"). Two live screenshots of Jul 2026 breakdown.
Session-16 fix (0e79c5c0) + all local history were PUSHED to main this session (Tre asked, to get a TestFlight
build). iOS "Build & Upload to App Store" run 29878740219 COMPLETED/success — build is in App Store Connect but
Apple TestFlight processing + app-update may not have reached Tre's phone, so UNKNOWN whether his screenshots are
pre- or post-0e79c5c0. GitHub flagged 1 high Dependabot alert (#55) — unrelated.

### Live data confirmed (Supabase, user_id a72f416e-433a-4055-9ab0-9feae4e60edf):
- Sync cutoff ≈ **2026-07-20** (Discover+Prime `liability_synced_at` = 2026-07-20 13:00 UTC; profiles/accounts have
  no last_sync col; syncCutoffDate is computed in CardProjectionContext.tsx:123 + CreditCardEngine.tsx:188 — NOT
  yet read this session, read it next).
- Income rules (recurring_rules): **Weekly Paycheck** $848.89 weekly due_day 5 (Fri); **GF Half of Rent/Groceries**
  $1,100 monthly due_day 28 (= the "Other Income $1,100" line). Investment: **Roth IRA** $25 due 28, **Robinhood**
  $25 due 5 (pre-cutoff→excluded). Transfer: **HYS** $100 due 28 (from TOTAL CHECKING), **Owners Contribution** $50
  due 17 (pre-cutoff→excluded). Funding acct = TOTAL CHECKING 933cbc10 bal $1,999.65. Cards: Discover 9608.64,
  Prime 6677.62, others $0.

### Screenshot facts — Jul 2026 popup: Current Cash $2,000, +Paycheck $849, +Other Income $1,100, −Bills $0,
### −Discover $605, −Vehicle Insurance $173, −Roth IRA $25, +One-Time Net $0, = Ending $2,966, Cash Floor $3,145.
### Collapsed row: +INCOME $1,949 / −OUT $983 / END $2,966; chips "⏱ rest of month · 3 paychecks received", "CC $140".

### THREE DEFECTS (diagnosed):
**Bug 1 — DROPPED PAYCHECK (root cause of the floor breach).** Cutoff Jul 20 → remaining Fridays Jul 24 + Jul 31 =
**2 checks = $1,698**, but popup shows +Paycheck **$849 = 1 check**. Chip "3 received" (Jul 3/10/17) confirms 2 SHOULD
remain. Engine month-0 income path: `forecast-engine.ts:667-673` (`paycheckIncome = scheduledIncome − nonPayRemaining`);
`scheduledIncome` derives from `forecastMonthEvents[0].income` which sums scheduledEvents with `date > syncCutoffDate`
(`useCardProjection.ts:344-355`, same filter mirrored in forecast-engine). Both hook and engine share the SAME
`scheduledEvents`, so both drop the check → cap and engine agree on wrong income. **Restoring it: 2966 + 849 = $3,815 >
$3,145 floor → breach disappears.** NEXT: trace `generateScheduledEvents` (src/lib/scheduling.ts) weekly generation
for the current partial month — is it emitting only ONE Friday event after Jul 20, or is a month-0 window dropping one?
Verify with a test: weekly paycheck, cutoff mid-month, must emit ALL remaining same-month occurrences.

**Bug 2 — Popup doesn't reconcile (display-only).** Lines sum $3,146 but Ending $2,966 → **$180 unshown** = **HYS $100**
(transfer, not itemized — `Forecast.tsx:1008` transferBreakdown shows Roth $25 but not HYS) + **Prime Visa cycling ~$80**
(month-0 per-card display `Forecast.tsx:954-957` uses `month0.perCardAdjusted` = Discover only; engine subtracts full
`monthDebtPayment` ledger incl. Prime cycling). 3146 − 100 − 80 = 2966 ✓. Fix in Forecast.tsx popup: itemize ALL
month-0 transfer rules (incl. HYS) + the cycling CC payment so lines reconcile to Ending.

**Bug 3 — "Ending below floor"** is the visible symptom of Bug 1; fixing Bug 1 resolves it. (If, after Bug 1, the cap
re-authorizes more Discover, Ending clamps to floor $3,145 — still not below. Either way, no engine-convergence change
should be needed. Do NOT touch tuned convergence unless Bug 1 fix proves insufficient on the post-fix build.)

### PLAN (Tre to confirm before editing): 1) Fix Bug 1 (dropped paycheck) FIRST — root cause. 2) Fix Bug 2 (popup
### itemization). 3) Full suite (watch goldenTierA Jul 2027) + tsc + graphify + LOCAL commit. 4) Live re-verify on the
### NEW build. Backup before edits per CLAUDE.md. vitest: --silent=false --reporter=verbose.

---

# Handoff — 2026-07-21 (session 16 → 17) — month-0 debt-cap fix SHIPPED (commit 0e79c5c0, PUSHED); prior context below

## DONE this session (16) — commit `0e79c5c0` (local, NOT pushed) — month-0 debt cap now mirrors engine cashPreDebt
Applied the Tre-approved fix from session 15's diagnosis (details preserved below under "IN PROGRESS (session 15)").
- **Edit:** `src/hooks/useCardProjection.ts` — `cashPreDebt` (the `availableForRevolving` cap input, ~line 1638)
  now subtracts `- m0Transfers - lumpTransferByMonth[0] + m0OneTimeNet`, mirroring `forecast-engine.ts:1106`.
  All three terms were already in scope. `m0OneTimeNet = oneTimeArr[0].income - oneTimeArr[0].expenses`;
  `oneTimeArr[0]` is force-zeroed in this hook so the term is 0 today but kept for engine parity. Did NOT
  reuse `m0ExtraOutflow` (would double-count savings/car/vehicle/mortgage already covered above).
- **Test:** new `src/hooks/__tests__/useCardProjection.month0TransferFloor.test.ts` — runs the hook with and
  without a post-cutoff month-0 investment rule (checking-sourced, due day 28) and asserts
  `month0.safeToPayTotal` drops dollar-for-dollar (±$5) when the floor cap is binding. Passes.
- **Verify:** full suite 216/216 green (215 prior + 1 new), tsc clean, NO golden re-pins (goldenTierA still
  Jul 2027). graphify updated. Backup: `backups/2026-07-21_194610/src/hooks/useCardProjection.ts`.

### ⚠️ NOT YET LIVE-VERIFIED — carry this into session 17
Static analysis (session 15) only attributed **$25** (Tre's Roth IRA transfer rule) of the observed **~$179**
current-month floor gap to this bug. The fix subtracts that $25 (and any lump/one-time) correctly, but the
remaining **~$154 is still unexplained** and may be a SEPARATE issue:
  (a) `m0Income` vs forecast `netIncome` drift (~$20, code comment `useCardProjection.ts:379-381`);
  (b) the displayed breakdown itself doesn't sum (screenshot lines totalled $3,121 but Ending showed $2,966,
      ~$155 hidden) — likely **cycling debt on Prime Visa** folded into `monthDebtPayment`
      (`forecast-engine.ts:1121` ledgerEntry.total) but not shown as its own popup line (per-card scaling
      `Forecast.tsx:973-978`).
**Next step:** have Tre reload the live app and report the current-month Ending Cash vs the $3,145 augmented
floor. If Ending rose only by ~$25 and is still ~$154 below, investigate (a)/(b) as a follow-up bug — do NOT
assume this commit closed the whole gap. If Ending now meets the floor, close it.

Supabase facts (session 15, still current): user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`, project
`mdtosrbfkextcaezuclh`, cash_floor $2,700 base / $3,145 augmented July. Discover bal $9,608.64 min $253 due 1;
Prime Visa bal $6,677.62 min $0 due 7; Apple/VX $0. Roth IRA rule $25/mo due 28 start 2026-07-15.

---

## IN PROGRESS (session 15, diagnosed + Tre approved "full lean-fix") — [SHIPPED session 16, see above] Discover doesn't pull back to meet current-month floor
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
- **[SHIPPED 2026-07-22, commit `8ad98370`] Unverified-account email nudges.** Built + DEPLOYED to
  Supabase (`mdtosrbfkextcaezuclh`). `supabase/functions/unverified-nudge/index.ts` + migration
  `20260722_email_nudges.sql`: daily cron `unverified-nudge-daily` (`0 15 * * *`) calls
  `public.get_users_to_nudge()` (SECURITY DEFINER, service-role only) → gentle_24h / final_72h stages,
  embeds a real one-click magiclink verify link (GoTrue admin `generateLink`, redirectTo
  getforgenta.com/dashboard), sends via Resend (`noreply@treforged.com`), records each send in new
  `public.email_nudges` (PK user_id+stage, RLS on/no policies) so no stage double-sends. Verified:
  cron active, selector returns the 3 existing unverified users (all >72h → final_72h), CRON_SECRET
  resolves. **NOT yet fired** — first send is the next 15:00 UTC cron tick (or a manual invoke).
  ⚠️ ONE untested external behavior: whether `generateLink type='magiclink'` returns an action_link
  for these users — the fn records a `link_generation_failed` failure (no email) if not, so watch the
  first run's response / Resend dashboard. Still TODO (separate): GA4 + signup goal on getforgenta.com;
  later feature/promo broadcasts via Resend Broadcasts.
- **[SHIPPED 2026-07-22, commit `8ad98370`] Weekly newsletter digest.** Built + DEPLOYED.
  `supabase/functions/newsletter-digest/index.ts` + migration `20260722_newsletter_digest_cron.sql`:
  weekly cron `newsletter-digest-weekly` (`0 15 * * 1`, Mondays) fetches `treforged.com/feed.xml`,
  filters to last 7 days, reads `newsletter_subscribers` (service role bypasses INSERT-only RLS),
  sends a branded digest via Resend batch with `utm_source=newsletter` + mailto List-Unsubscribe.
  Skips cleanly if 0 posts or 0 subscribers. Uses the shared RESEND_API_KEY (no GH secret added).
  **First send is next Monday's cron tick.** One-click unsubscribe endpoint remains a later upgrade.

## State / gotchas
- On `main`, clean except `backups/` (untracked, NEVER commit) and `graphify-out/` (gitignored).
- Local commits NOT pushed: this session `5194cf2b`, plus prior `64a1182b`/`6459f258`/`afd33160`/
  `2c491e87`. Push only when Tre asks.
- Supabase user_id `a72f416e-433a-4055-9ab0-9feae4e60edf`; profiles PK `id` ≠ `user_id` (filter by
  `user_id`). Paychecks are NOT DB rows — synthesized from `profiles` pay config via pay-schedule.
- vitest hides console.log on passing tests: `--silent=false --reporter=verbose`.
- After code edits run `python -m graphify update .` (AST-only, no API cost) — done this session.
