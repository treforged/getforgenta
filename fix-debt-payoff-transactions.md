# Bug Fix Task — Debt Payoff Logic, Transaction Rendering, Liquid Cash Carryover

**Before making ANY changes:** Create a git backup branch from the current state:
```
git checkout -b backup/pre-debt-fix-$(date +%Y%m%d)
git add -A && git commit -m "backup: pre-debt-payoff-fix snapshot"
git checkout main
```

---

## Context

This is a personal budgeting web app (React + Supabase + Vercel). There are 3 bugs to fix across the debt payoff simulation, transaction history rendering, and cash projection logic. Fix them in the order listed below. After all 3 are fixed, commit and push.

---

## Bug 1: Debt Payoff Simulation — Cards Never Reach $0

### Where to look
Find the debt simulation engine. Console logs reference `DebtSim:CCEngine`, `buildCardData`, and the file is likely named something like `DebtPayoff`, `debtSimulator`, `ccEngine`, or similar. Also check for a `buildCardData` function that logs `monthlyPurchases (Future only)` and `recurringExplicit`.

### Current broken behavior
- The simulation runs monthly projections for each credit card (Prime Visa and Discover Card)
- Neither card ever actually reaches a $0 balance in the projection
- New purchases ($567/mo on Prime Visa) keep getting added every month even while the card has a carried balance
- Interest keeps accruing because the balance never hits zero
- The sim treats each card as perpetually carrying a balance with payments chipping away, but never models the card being "paid off" and switching to pay-in-full mode
- The 120-month payoff ETA confirms this — it's just doing minimum + small surplus payments forever

### Correct logic (implement this)
The simulation should use **avalanche strategy** (highest APR first) with this monthly loop:

```
For each month in the projection:
  1. Calculate available surplus = liquid cash - cash floor - minimum payments on ALL cards
  2. Sort cards by APR descending (avalanche order)
  3. For the PRIMARY TARGET card (highest APR with balance > 0):
     a. Calculate total owed = previous balance + interest accrued + new monthly purchases
     b. Apply the full surplus toward this card's balance (on top of its minimum payment)
     c. If payment >= total owed → card balance = $0, card is NOW PAID OFF
     d. If payment < total owed → card balance = total owed - payment, interest accrues next month
  4. For all OTHER cards with a remaining balance:
     a. Pay only the minimum payment
     b. Balance = previous balance + interest + new purchases - minimum payment
  5. Once a card reaches $0 and is marked PAID OFF:
     a. It still has monthly purchases going on it (if purchases/mo > 0)
     b. BUT those purchases are auto-paid in full each month (statement balance = $0 after payment)
     c. NO interest ever accrues on this card again
     d. The surplus that was going to this card NOW redirects to the next highest-APR card
  6. Update liquid cash: ending cash = starting cash + income - expenses - all card payments made
```

### Key rules
- A card with `monthlyPurchases > 0` that has been paid off should NOT show an increasing balance again — purchases happen, then get paid in full within the same month cycle
- The "paid off" state is permanent once reached (balance hits $0) — the card transitions from "debt mode" to "pay-in-full mode"
- Interest is ONLY charged on cards that carried a balance from the previous month (not paid in full)
- Once ALL cards are in pay-in-full mode, surplus cash stays in checking (liquid cash grows)
- The Payoff ETA should reflect the month the LAST card hits $0, not infinity/120 months

### Validation after fix
- Prime Visa ($4,000 at 27.49% APR) should pay off within ~4-6 months given the aggressive surplus allocation
- After Prime Visa hits $0, its $567/mo purchases should show as auto-paid each month with $0 carried balance
- Discover ($3,620 at 19.49% APR) should start getting the full surplus after Prime Visa is paid off
- After both are paid off, liquid cash in the forecast should start growing month over month
- The credit card debt payoff trajectory chart should show both lines reaching $0, not flatlining above it

---

## Bug 2: Transactions Not Rendering in Transaction History

### Where to look
Find the Transactions page/component. It renders a list of transactions filtered by month with income/expense totals and a "Spend by Payment Source" breakdown. Also check the data fetching query or hook that populates this list.

### Current broken behavior
- Transactions that exist in the database (confirmed visible in Budget Control view) are NOT appearing in the Transactions list view
- This is happening specifically after account balance updates/reconciliations
- The March 2026 Transactions page shows $0 income despite paychecks existing
- Balance Adjustment entries (reconciled) show up, but regular income transactions may be hidden or filtered out

### What to investigate and fix
1. **Check the query/filter logic** for the transactions list:
   - Is it filtering by `account_id` or `source_id` that might change after a reconciliation?
   - Is there a date range filter that's excluding older transactions when the month rolls over?
   - Is there a `status` or `type` filter that hides transactions after they're "reconciled"?
   - Are transactions being soft-deleted or having a flag set during balance adjustment that removes them from the default query?

2. **Check if reconciliation/balance adjustment is modifying existing transactions:**
   - When a balance adjustment is created, does it alter or re-associate existing transactions?
   - Is the `payment_source` or `account_id` foreign key being updated in a way that breaks the join?

3. **Fix the query** so that:
   - ALL transactions for a given month render regardless of reconciliation status
   - Income transactions (paychecks) always appear and are counted in the monthly income total
   - Balance adjustments are additive entries — they should NOT hide or modify pre-existing transactions

### Validation after fix
- Navigate to Transactions → March 2026
- ALL previously entered transactions should be visible (income, expenses, debt payments)
- Monthly Income on the Command Center dashboard should show the correct total, not "—" or $0
- Adding a new balance adjustment should NOT cause any existing transactions to disappear

---

## Bug 3: Liquid Cash Should Carry Over Between Months

### Where to look
Find the forecast/projection logic that calculates month-over-month cash position. This is likely in the same area as the net worth/assets projection or the monthly breakdown table (the one showing Start → End Cash → Income → Out → One-Time columns).

### Current broken behavior
- The monthly breakdown shows ending cash values that don't logically flow as starting cash for the next month in all cases
- The simulation may be pulling liquid cash from a static account balance rather than using the previous month's calculated ending cash
- This causes the forecast to be inaccurate after month 1

### Correct logic
```
Month 1: starting_cash = current actual liquid cash (from checking account balance)
Month 2: starting_cash = Month 1 ending_cash
Month 3: starting_cash = Month 2 ending_cash
...and so on

ending_cash = starting_cash + total_income - total_expenses - total_debt_payments - one_time_expenses + one_time_income
```

- Every month's `Start` column value MUST equal the previous month's `End Cash` value
- The only exception is Month 1, which uses the real current checking balance
- This chain must not break even when debt payoff events happen (large lump payments should reduce ending cash, which carries into the next month's start)

### Validation after fix
- In the Monthly Breakdown table, verify that every row's `Start` value = previous row's `End Cash` value
- The net worth projection chart should reflect this corrected cash flow
- June's cash dip (car purchase month) should show in the starting cash for July

---

## After all 3 fixes are complete

1. Test the full flow:
   - Open Debt Payoff Planner → verify both cards eventually reach $0
   - Open Forecast → verify cash carries over correctly and milestones update
   - Open Transactions → verify all transactions render for each month
   - Open Command Center → verify Monthly Income shows correctly

2. Commit and push:
```
git add -A
git commit -m "fix: debt payoff zero-balance logic, transaction rendering, cash carryover

- Debt sim now pays cards to $0 one at a time (avalanche), then auto-pays in full
- Fixed transaction list not rendering after account reconciliation
- Liquid cash now properly carries over month-to-month in forecast"
git push origin main
```
