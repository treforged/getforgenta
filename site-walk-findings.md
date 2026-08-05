# Site Walk — Findings (2026-08-04)

Environment: production `getforgenta.com`, **demo mode** (Jordan dataset). No writes performed.
A real-data pass against Tre's account is still pending (requires sign-in).

Method note: screenshots of this app are unreliable under automation — the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion
never runs, and every `initial={{opacity:0}}` element stays invisible. The "blank landing page"
this walk first saw was that artifact, **not** a bug. All findings below come from DOM text.

---

## P1 — Same month, opposite answers (most user-damaging)

### 1.1 Dashboard says +$1,655 month-end cash; Forecast says −$3,300 and "Cash goes negative!"
- Dashboard → `MONTH-END CASH $1,655` ("After all scheduled items")
- Dashboard → `AVAILABLE $6,488 to deploy`
- Forecast → milestone `Aug 2026: ⚠️ Cash goes negative!`, table row `Aug 2026 … END CASH -$3,300⚠️`
- Forecast stays negative for 10 consecutive months (Aug 2026 → May 2027), while its own
  explanatory copy claims "End cash lands exactly at $1,000 each month — no idle cash."

The app tells the user to deploy $6,488 on the same screen-set where it predicts an overdraft.
In a financial app this is the highest-severity class of defect.

### 1.2 Chase Sapphire's debt payment differs by $2,673 between tabs — ✅ FIXED (`014d5a10`), verified live 2026-08-04
- Debt Payoff → recommended Chase Sapphire payment **$6,401** (Dashboard widget agrees)
- Transactions → `Chase Sapphire Payment · debt payoff · 2026-08-15 · **-$3,728**`
- Discover matches in both places ($87), so the generator is not uniformly stale.

> **Verified fixed 2026-08-04 (demo, localhost:8080):** Transactions now reads
> `Chase Sapphire Payment · debt payoff · 2026-08-15 · -$6,401`, matching the Debt tab and the
> Dashboard widget. Discover still agrees at $87.

**This reproduces Tre's reported Discover mismatch in demo data**, which means it is not merely a
missing-Plaid-cross-reference problem — the auto-generated `debt payoff` transaction and the engine
recommendation are computed from different state. Root-cause this before assuming Plaid fixes it.

### 1.3 Net worth omits every non-credit-card liability — ✅ FIXED (`9a212129`), verified live 2026-08-04
- Accounts → `TOTAL LIABILITIES $12,700`, `NET WORTH $11,900` (assets $24,600 − CC $12,700)
- Dashboard → `LIABILITIES BREAKDOWN`: Chase Sapphire $8,500 + Discover $4,200 +
  **Student Loan $8,000** + **Auto Loan — RAV4 $26,500** = **$47,200**

Net worth is overstated by $34,500 in demo. True figure is −$22,600. Loans appear to live outside
the `accounts` table, and the net-worth rollup only sums accounts. For Tre's real data this means
net worth is overstated by at least his auto loan.

⚠️ Related memory: `project_net_worth_snapshots` warns *not* to simplify this math to Accounts'
live-only totals. Fix by adding loans to the rollup, not by changing what Dashboard reports.

> **Verified fixed 2026-08-04 (demo, localhost:8080).** Both surfaces now agree on the figure this
> finding predicted:
> - Dashboard → `NET WORTH -$22,600`, `$24,600 assets`; liabilities breakdown still sums to $47,200.
> - Accounts → `NET WORTH -$22,600`, `TOTAL ASSETS $24,600`, `TOTAL LIABILITIES $47,200`
>   (was $11,900 / $12,700).
>
> `CC DEBT $12,700` remains its own correctly-scoped tile. Asset rows sum to $24,600 exactly, so the
> tile can no longer drift from the list beneath it.

---

## P2 — Cross-tab metric disagreements

### 2.1 "Monthly income" has two values
- Budget Control → `MONTHLY INCOME $6,750` (rule-derived: $5,850 paycheck + $900 roommate) — correct
- Dashboard + Transactions → `$9,113` (transaction-derived)

Contributing causes found in the ledger:
- August 2026 has **5** Fridays, so 5 × $1,463 = $7,315 of paychecks land in one month.
- The roommate payment is **double-counted**: `Roommate Contribution +$900` (category *Income*) and
  `Roommate – April +$900` (category *Other*) both dated 2026-08-01.

### 2.2 Budget's own stated invariant is violated
Budget Control → `REMAINING CASH $6,995`, labelled *"matches Debt tab Safe to Pay"*.
Debt tab → `Safe to Pay $6,488`. It does not match. Either the number or the claim is wrong.

### 2.3 The cash floor has five different values — ✅ Dashboard row FIXED (2026-08-05), verified live
| Surface | Value |
|---|---|
| Debt tab explanatory copy | $1,000 |
| Forecast ("your … floor setting") | $1,500 |
| Debt tab `Safe Min` | $1,650 |
| Forecast ("Cash floor raised to") | $1,655 |
| Dashboard budget snapshot `Cash floor` row | $2,402 |

`Dashboard.tsx:621-623` comments that this floor is shared with Forecast and `useCardProjection`
via `getAugmentedMinSafeCash` "so the floor displayed here always matches the floor actually used".
Debt $1,650 vs Forecast $1,655 vs Dashboard $2,402 shows that guarantee does not hold.

**Root cause of the Dashboard value.** Sharing the *function* was never enough — the two calls
were given different funding accounts. Dashboard passed its own `fundingAccountId`, which takes
`profile.default_deposit_account` with **no account-type check** and ignores the persisted
debt-funding override; the engine resolves `persistedDebtFundingId || forecastFundingAccountId`
(checking / business_checking / cash only). Different account ⇒ different pre-paycheck bills ⇒
different floor.

**Fix.** `CardProjectionResult` now exposes `debtFundingAccountId` (the id the engine actually
resolved) and Dashboard's `getAugmentedMinSafeCash` call uses it. That feeds both the snapshot's
floor row and the floor-calculator popover, so the itemization matches the number.
Live demo 2026-08-05: Dashboard floor row now **$1,500**, was $2,402.

**Still open:** the Debt tab's `$1,000` explanatory copy and its `Safe Min $1,650` vs Forecast's
`$1,655` were not touched — re-walk those three on real data. And **Settings still exposes no
cash-floor control at all**, which contradicts Forecast's "your floor setting" copy. Raise with Tre.

### 2.4 Monthly expenses / savings rate disagree three ways
- Dashboard → `MONTHLY EXPENSES $5,015`, `AVG MONTHLY SPEND $2,132`, `SAVINGS RATE -10.1% / -$923`
- Transactions (same month) → `EXPENSES $9,727`, `NET -$614`
- Budget → `MONTHLY SPEND $3,519`

Dashboard's own tiles contradict each other: income $9,113 − expenses $5,015 = **+$4,098**, yet the
savings-rate tile directly below reads **−$923/mo**. Annual savings (−$11,071) is consistent with
−$923 × 12, so the two tiles are wired to different definitions with no labelling to say so.

### 2.5 Emergency Fund completion date
Goals → `Est. completion: Dec 2028`. Forecast milestone → `Mar 2029: Emergency Fund Complete!`
Three months apart; Goals appears to apply the Marcus HYS 4.5% APY and Forecast does not.
(Vacation Fund agrees at Nov 2027 in both, consistent with the zero-APY custom goal.)

### 2.6 Dashboard budget snapshot rows do not sum to their own total — ✅ FIXED (2026-08-05), verified live
Displayed chain: `$2,800 + $5,850 − $1,975 = $6,675`, then `− $2,402 floor − $150 − $267 = **$6,488**`.
Actual arithmetic: $3,856. The "=" total is *larger* than projected-remaining-minus-floor.

Cause: `MonthlyBudgetSnapshot.tsx:66` renders `availableToDeploy` (from
`cardProjection.month0.safeToPayTotal`, an engine output) inside a chain of `−` rows it was never
derived from. `Dashboard.tsx:429-431` shows a prior session patched one instance of this by adding
a missing "Vehicle Insurance (est.)" row. The reconciliation gap here is $187 of unshown items —
the structural problem was never fixed, only one line item was added.

**Fix (per Tre's 2026-08-05 decision: accuracy wins, engine total stays canonical, rows derive
from it).** The engine now publishes its month-0 cash chain term by term as
`Month0Result.chain` (`debt-model-types.ts`), each term rounded individually with `cashPreDebt`
defined as the **sum of the rounded terms** so the identity holds exactly in integer arithmetic.
New pure builder `src/lib/month0-budget-snapshot.ts` turns that chain into display rows and
**computes the leftover** (`cashPreDebt − m0SafeFloor − safeToPayTotal`) as a real labeled row,
split into the engine's own `holdback` and the remainder. `MonthlyBudgetSnapshot.tsx` no longer
does arithmetic — it renders rows. Dashboard's parallel derivation (`month0ImpliedSavings` plus
the `month0SavingsBreakdown` memo that silently *replaced* it) is deleted, hand-patched
"Vehicle Insurance (est.)" row and all.

`month0-budget-snapshot.test.ts` (11 tests) folds the rows and asserts every `=` checkpoint
equals the fold above it, across: holdback with event, holdback exceeding the residual, exact
floor bind, floor breach by card minimums (residual negative → `+` row), every reserve term
present, and negative projected remaining. That test is what stops it drifting back.

Live demo 2026-08-05: `$4,100 + $5,850 − $150 − $311 − $450 = $9,039`, then
`− $1,500 floor − $376 held = $7,163`. Both halves balance exactly.

### 2.8 Engine's month-0 remaining expenses reads $0 while bills remain (NEW — 2026-08-05, UNVERIFIED)

Surfaced *by* the §2.6 fix, which is the point of that fix: the snapshot now shows the engine's own
inputs instead of Dashboard-local sums, so an engine input that looks wrong is finally visible.

Demo, Wed 2026-08-05: the snapshot renders **no "Bills still coming" row**, i.e.
`month0.chain.expenses` rounds to $0 — and that same `m0Expenses` is what the engine subtracts in
`cashPreDebt`, so it is not a display artifact. But the same page shows `BILLS THIS WEEK $190 · 3
upcoming` and `BILLS THIS MONTH $11,025 · 20 scheduled`, including **Gas · Aug 12 · Chase Checking
$55**, which is a cash-sourced rule that `forecastMonthEvents[0].expenses` should count. (Groceries
Aug 8 is on Chase Sapphire and is correctly excluded — `allCcRuleIds`.)

Either `forecastMonthEvents[0]` is not what `useCardProjection.ts:382-383` believes it is, or the
demo fixture feeds it differently from the tile data. **Check before assuming the display is
wrong.** If real, this overstates deployable cash by the whole remaining-bills amount and is a
strong candidate for the still-open **§1.1** (Dashboard vs Forecast month-end cash, −$3,300 apart).

A fiber probe for the live `cardProjection` failed (`memoizedState` walk found nothing); read the
value by other means — a temporary log in the hook, or compare against Forecast's own August row.

### 2.7 The RAV4 loan has two different outstanding balances (NEW — 2026-08-04)
- Vehicles → `Toyota RAV4 (Owned)` · `$27,110 remaining` · `1 of 61 payments made` · 6.4% APR
- Dashboard `LIABILITIES BREAKDOWN` → `Auto Loan — RAV4` **$26,500**

A $610 gap. The same vehicle is represented **twice**: once as an `auto_loan` row in `accounts`
(the $26,500 that finding 1.3's fix now correctly pulls into net worth) and once as a `car_funds`
loan that Vehicles amortizes independently from `loan_amount`/APR/start date ($27,110).

**This is decision input for the open `car_funds` question.** If an active `car_funds` loan were
*also* added to the net-worth rollup, the demo RAV4 would be double-counted (−$53,610 of liability
for one vehicle). Any fix has to pick one source of truth per vehicle, not sum both.

---

## P3 — Logic and data-integrity bugs

### 3.1 Utilization milestones are internally impossible — ✅ FIXED (`c205eebe`), verified live 2026-08-05
Debt tab, at current utilization **65.1%**:
```
Below 25% util: ~1 months
Below 50% util: ~0 months
Below 75% util: ~0 months
```
"Below 50%: 0 months" asserts utilization is already under 50%. It is 65.1%. Also `~1 months`
should read `1 month`, and reaching 25% cannot take *longer* than… it does, but 50% showing 0
while 25% shows 1 is contradictory ordering.

> **Root cause:** the milestone returned the projection INDEX as a month count. `months[i]` is the
> END of month i, so a threshold cleared by month-end reported `0`. The ordering was never actually
> contradictory — the display was.
>
> **Verified fixed 2026-08-05 (demo, localhost:8080)** at the same 65.1%:
> `Below 25% util: ~2 months` · `Below 50% util: ~1 month` · `Below 75% util: already there`.
> "already there" now comes from a real check against the live balance, not from a 0 index.

### 3.2 Paycheck mis-categorised as "Other"
`Weekly Paycheck · 2026-08-03 · **Other**` — every other paycheck is category *Income*.
Same for `Roommate – April`. Anything keyed off category *Income* silently undercounts.

### 3.3 Auto loan and installment payments have no payment source
Transactions → `Unassigned $897` = RAV4 payment $537 + RAV4 insurance $210 + MacBook $150.
These debits hit no account, so they cannot be reflected in any account's projected balance.

### 3.4 Duplicate recurring transactions
- `Monthly CC expenses – Sapphire -$450` **and** `Monthly Expenses -$450`, both 2026-08-05, both
  Groceries / Chase Sapphire.
- `Streaming + Gym -$85` **and** `Subscriptions -$85`, both 2026-08-04, both Discover.

May be demo-fixture duplication rather than a code defect — but they inflate every
transaction-derived total, including the $9,113 income figure in 2.1.

### 3.5 A completed payment plan still counts as active — ✅ FIXED (`c205eebe`), verified live 2026-08-05
Transactions → `Payment Plans · 2 active`, but AirPods Pro shows `4/4`, `Remaining: $0`,
`Ends: 2026-07-13`. Completed plans are not being excluded from the active count.

> **Root cause:** `plan.active` is a user-toggled DB flag and **nothing writes it back to false**
> when the last installment date passes. Completion is derivable from the schedule, so it is now
> derived (`isPlanInProgress` = `active && remaining > 0`) rather than depending on a write-back
> that does not exist.
>
> **Verified fixed 2026-08-05 (demo):** `Payment Plans · 1 active`; AirPods Pro renders `4/4` with
> a `(complete)` marker, MacBook Pro `3/12` still counts.

### 3.6 — RETRACTED (was: payment-plan counter off by one)
Claimed `MacBook Pro 3/12` on the card vs `MacBook Pro (4/12)` on the transaction. **Not a bug.**
The card shows *installments paid*; the transaction shows *which installment it is*. For a
future-dated payment, `n paid` + `this is n+1` is correct. Confirmed by
`ExtremeOnlineStore CF Aero Kit`, whose past-dated 8/01 row correctly reads `(2/6)` against a
`2/6` card.

### 3.7 Dashboard still shows a car goal the Goals page has retired — ✅ FIXED (`c205eebe`), verified live 2026-08-05
Dashboard `GOAL PROGRESS` lists `2024 Honda Civic`; Goals says "Car funds have moved to Vehicles"
and lists only 2. `TOTAL SAVED $6,650 · 2 goals` sits above a list of 3.

> **Root cause:** Goal Progress injected `carFunds[0]` into a card that navigates to `/goals` — a
> page that deliberately lists no car funds. The tile pointed at a page that could not show it.
> Goal Progress is now savings goals only (up to 3, since the car slot is freed). The vehicle is
> still fully covered by the dedicated `CAR GOAL` widget, which now links to `/vehicles`.
>
> **Verified fixed 2026-08-05 (demo):** `GOAL PROGRESS` lists Emergency Fund + Vacation Fund only,
> matching `TOTAL SAVED $6,650 · 2 goals`. `CAR GOAL: 2024 Honda Civic` still shown separately.

### 3.8 CC payoff ETA off by one month — ✅ FIXED (`c205eebe`), verified live 2026-08-05
Debt → `PAYOFF ETA 3 mo` (Aug + 3 = Nov 2026). Forecast milestone → `Oct 2026: CC Debt Free!`

> **Not an off-by-one in the math** — both surfaces read the same `simRevolvingPayoffMonth = 3`.
> It is **1-indexed** (month 1 = this month); Forecast maps it to a row via `rawPayoffMonth - 1`
> = Oct, while the Debt tile printed the raw number as "3 mo", read as three months from now.
> The tile now shows the month itself in Forecast's own label format.
>
> **Verified fixed 2026-08-05 (demo):** `PAYOFF ETA · Oct 2026 · in 2 mo`, matching Forecast's
> `Oct 2026: CC Debt Free!`.

---

## P4 — Presentation bugs

### 4.1 Ordinal date suffix is wrong for 21–31 — ✅ FIXED (`617fe749`), verified live 2026-08-04
Five separate implementations, four of them broken:

| File | Line | Behaviour |
|---|---|---|
| `src/components/dashboard/DebtRecommendationsWidget.tsx` | 98 | hardcoded `th` — always wrong for 1,2,3,21,22,23,31 |
| `src/components/debt/CreditCardEngine.tsx` | 1599 | ternary handles only 1/2/3 → `21th`, `22th`, `23th`, `31th` |
| `src/components/debt/CreditCardEngine.tsx` | 1667 | same broken ternary |
| `src/components/debt/CreditCardEngine.tsx` | 1701 | same broken ternary |
| Forecast obligations list | — | `Rent — $1,600 (due 1th)`, `Gas — $55 (due 2th)` — unconditional `th` |
| Accounts account subtitle | — | `Due 22th` |

Observed live: `Due 22th` on Dashboard, Accounts, and Debt (×3); `due 1th` / `due 2th` on Forecast.

Fix: one shared `ordinalSuffix(n)` helper handling the 11/12/13 exception, replacing all five.

> **Verified fixed 2026-08-04:** Accounts reads `Due 15th` / `Due 22nd`, Dashboard's debt widget
> reads `Due 15th` / `Due 22nd`. No `22th` remains on the walked surfaces.

### 4.2 Budget allocation percentages sum to 146%
Fixed 30% + Variable 22% + Debt 77% + Transfers 17% + Remaining 0%. Each is a correct
percentage-of-income, but presented as an allocation breakdown it reads as broken.
Remaining is clamped to 0% instead of showing the −46% overspend.

---

## Verified correct (no action)

- Credit utilization, all three cards and the total.
- Spending-by-category: amounts sum to $5,015 and every percentage rounds correctly.
- Retirement projections: 401k / Roth / brokerage 1/5/10/20-year figures all reconcile to standard
  future-value-of-annuity math; the 10-year combined total is exact.
- Transactions `SPEND BY PAYMENT SOURCE` sums exactly to `EXPENSES`.
- Debt tab per-card interest sums exactly to `MONTHLY INTEREST $229.31`.
- Goals totals (saved $6,650, target $18,000) and both progress percentages.
- Vacation Fund completion date agrees between Goals and Forecast.
- Debt recommendation line items sum exactly to `Safe to Pay`.

---

## Still to do

1. **Real-data pass** — same sweep against Tre's account, especially the Discover 8/1 payment.
   Blocked: requires Tre to sign in himself; a hard reload also drops demo state, so the walk must
   stay on client-side navigation once signed in.
2. Mobile/Capacitor viewport pass.
3. ~~Settings and Vehicles pages not yet walked.~~ **Walked 2026-08-04.** Vehicles produced new
   finding 2.7. Settings is thin in demo (no cash-floor control is exposed there, which is worth
   noting against finding 2.3's "your floor setting" copy in Forecast); nothing else broken.
4. ~~Root-cause 1.2~~ — **done**, fixed in `014d5a10` and verified live.
