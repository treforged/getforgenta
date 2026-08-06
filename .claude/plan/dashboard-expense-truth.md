# Implementation Plan: Dashboard expense truth (§2.4)

Fix the Dashboard's $1,226/mo expense under-count, then apply Option B (debt principal is not an
expense; interest is) across Dashboard, Budget and Transactions.

Planned 2026-08-06. Session 85. Status: **awaiting approval, nothing implemented.**

## Task Type

- [x] Frontend (display aggregates)
- [x] Backend (lib extraction + accounting model)
- Fullstack, but **no schema change and no engine change**.

---

## What the context map established (this reversed two assumptions)

**1. The MONTH-END CASH invariant is NOT at risk from the stream fix.** `monthEndCash` resolves as
`cardProjection?.month0?.endCash ?? txMergeMonthEndCash` (`Dashboard.tsx:599`). The primary path is
built entirely inside `useCardProjection.ts:1694`, an explicit mirror of `forecast-engine.ts`
PASS-3, and **never reads the transaction stream**. `planCashThisMonth` (`Dashboard.tsx:526`) feeds
only `txMergeMonthEndCash` (`:596`) and one fallback drawer row (`:745`), both dead unless the user
has zero credit cards. **The comment at `Dashboard.tsx:522-525` claiming plan cash is folded into
surplus / available-to-deploy is stale** — those consumers no longer exist. Fix the comment.

So the split is clean:
- **Engine-derived numbers** (MONTH-END CASH, Safe to Pay, floor, donut) are **already correct** —
  they count plans, car loans and vehicle insurance as separate cash-chain terms.
- **Transaction-stream aggregates** (MONTHLY EXPENSES, SPENDING BY CATEGORY, SAVINGS RATE, ANNUAL
  SAVINGS, EMERGENCY RUNWAY, Cash Flow Overview) are the **only** wrong surfaces, because
  `mergeWithGeneratedTransactions` (`pay-schedule.ts:1182`) expands **recurring rules only** —
  never plans, never car loans.

**2. The real hazard is not double-counting cash — it is that the generators over-emit.** Merging
`planTxns` / `carLoanTxns` raw would be wrong three ways:

| Generator | Over-emits | Evidence |
|---|---|---|
| `generatePaymentPlanTransactions` (`payment-plan-generator.ts:223`) | **CC-sourced plans** (already inside card balances the engine pays down) and installments **already settled** this month | only filter is `!plan.active` (`:225`); `getMonthlyPlanCashExpenses:133,136` excludes both |
| `generateCarLoanTransactions` (`vehicle-loan-engine.ts:262`) | **saving-phase (not-yet-purchased) vehicles**, and **historical already-paid installments** — schedule is anchored at `payment_start_date`, not today | no `phase` filter (`:268-270`); contrast `getActiveCarLoanPayments:197,208,221` which filters all three |
| both | — | dedupe in `mergeWithGeneratedTransactions:1193` keys on `date:note:amount`; generator notes are `"<vehicle> Payment (i/n)"` / `"<plan> (i/n)"`, so a user's hand-made recurring car-payment rule will **not** dedupe → genuine duplication vector |

**3. There is no test coverage to break, and none to lean on.** No `src/pages/__tests__` directory
exists. Nothing tests `summary`, `expenseBreakdown`, `categoryData` or `txMergeMonthEndCash`. There
is also **no test asserting Forecast END CASH == Dashboard MONTH-END CASH** — that invariant has
only ever been checked by hand in a browser.

---

## Technical Solution

Do **not** merge the raw generators into `allMonthTransactions`. Instead extract a single testable
module that answers one question — *what did this month actually cost, and how much of it was
borrowing rather than spending?* — and point every stream aggregate at it.

New file **`src/lib/monthly-expense-model.ts`**:

```ts
export type ExpenseClass = 'living' | 'interest' | 'principal' | 'transfer';

export type MonthlyExpenseModel = {
  living: number;          // groceries, bills, gas, insurance, dining...  (Option B: "expenses")
  interest: number;        // card + auto-loan interest                   (Option B: expense)
  principal: number;       // card + auto-loan + plan principal           (Option B: NOT expense)
  transfers: number;       // goal/investment contributions               (neither)
  byCategory: Record<string, number>;   // living + interest only, for SPENDING BY CATEGORY
  expenses: number;        // living + interest        <- the Monthly Expenses tile
  debtService: number;     // interest + principal     <- its own row
  cashOut: number;         // living + interest + principal + transfers
};

export function buildMonthlyExpenseModel(input: {
  monthTxns: ExpenseTransaction[];   // allMonthTransactions, current month
  paymentPlans: PaymentPlan[];
  carFunds: CarFund[];
  year: number; month: number;
  creditCardIds: Set<string>;
  syncCutoffDate: string | null;
}): MonthlyExpenseModel;
```

Rules it applies — each one is a bug fixed:

1. **Plans**: use `getMonthlyPlanCashExpenses`-equivalent filtering (skip inactive, skip
   CC-sourced) but **without** the sync-cutoff filter — this is a whole-month total, not a
   remaining-cash figure. Reuse the existing function's predicate; do not re-implement it.
2. **Car loans**: derive from **`getActiveCarLoanPayments`** (`vehicle-loan-engine.ts:192`), not
   `generateCarLoanTransactions` — it already filters phase, not-yet-started and paid-off. Take
   the current month's row only.
3. **Vehicle insurance**: classify `living`. It is a real recurring cost, not debt service.
4. **Classification** replaces `categorizeExpenses`'s name-matching (`expense-filtering.ts:63-67`
   matches on the strings `'debt'` / `'credit card'`, which is why a category rename would silently
   change a headline number). Classify on **structure**: `isDebtPayment` / `isPlanPayment` /
   `isCarLoanPayment` flags and account type, never on the display name.
5. **Interest split**: card interest from the projection's month-0 interest term; auto-loan interest
   from the amortization row already computed inside `getActiveCarLoanPayments`. Where interest is
   genuinely unavailable, classify the whole payment `principal` and say so in the drawer rather
   than guessing.

Then rewire consumers. `summary.expenses` → `model.expenses`; `savingsRate` →
`(income − model.expenses) / income`; `categoryData` → `model.byCategory`; runway burn →
`model.cashOut`; Cash Flow Overview month 0 → `model.cashOut` (so the bar matches the other five,
which are recorded actuals).

---

## Implementation Steps

### Phase 1 — stream truth (behaviour-changing, no definition change yet)

1. **Backup** to `backups/YYYY-MM-DD_HHMMSS/` (Dashboard.tsx, expense-filtering.ts). Deliverable: backup path.
2. **Create `src/lib/monthly-expense-model.ts`** with `buildMonthlyExpenseModel`, classification
   pure and injectable. No React. Deliverable: new module.
3. **Write tests FIRST** (`src/lib/__tests__/monthly-expense-model.test.ts`) — this is the TDD gate:
   - reproduces Tre's real August shape: living/interest/principal split summing to $6,242
   - a CC-sourced plan installment is **excluded** (it is inside the card balance)
   - a saving-phase vehicle contributes **nothing**
   - a paid-off vehicle contributes **nothing**
   - a historical (pre-`payment_start_date`) installment is **not** counted into the current month
   - a category literally named "Credit Card Rewards" is **not** silently dropped (the
     name-matching bug in `expense-filtering.ts:63-67`)
   - vehicle insurance classifies `living`, auto-loan principal classifies `principal`
   Deliverable: failing tests, then green.
4. **Wire Dashboard to the model.** Replace `expenseBreakdown` / `summary.expenses` /
   `categoryData` / runway burn / Cash Flow month 0. Delete the stale comment at
   `Dashboard.tsx:522-525`. **Do not touch `monthEndCash`, `cardProjection`, or the donut.**
   Deliverable: Dashboard MONTHLY EXPENSES rises $3,196 → ~$4,422 on real data.
5. **Add the missing invariant test** — assert Forecast END CASH == Dashboard MONTH-END CASH from
   shared inputs. It has never existed; add it before touching anything near it.
   Deliverable: `src/lib/__tests__/monthEndCash.invariant.test.ts`.
6. **Verify**: `npx tsc --noEmit`, `npx eslint`, `npx vitest run` all green; then a **live read on
   real data** confirming MONTH-END CASH is **unchanged** and MONTHLY EXPENSES has moved.
   Live-check rules: wait ~10s after each nav; confirm the served module first.
7. **Commit** Phase 1 alone. It is defensible on its own and easy to revert.

### Phase 2 — Option B (definition change; only after Phase 1 is live-verified)

8. **Dashboard**: `MONTHLY EXPENSES` = `model.expenses`; new **`DEBT SERVICE`** row =
   `model.debtService` split interest/principal; `SAVINGS RATE` = `(income − expenses) / income`;
   `ANNUAL SAVINGS` follows. Drawer shows the full chain so income − expenses − debt = cash flow is
   followable on screen.
9. **Transactions**: keep `EXPENSES $6,243` (it is the honest all-in cash figure) but label it
   **`TOTAL CASH OUT`** and add a `of which debt service` sub-line. `NET −$1,523` is correct — do
   not touch it.
10. **Budget**: label `MONTHLY SPEND` as **planned (from rules)** to stop it being read as an
    actual. Numbers unchanged.
11. Tests for each rewire; verify; **live-check on real data**; commit separately.

---

## Key Files

| File | Operation | Description |
|---|---|---|
| `src/lib/monthly-expense-model.ts` | **Create** | classification + month rollup, the whole fix |
| `src/lib/__tests__/monthly-expense-model.test.ts` | **Create** | TDD gate, 7+ cases above |
| `src/lib/__tests__/monthEndCash.invariant.test.ts` | **Create** | the never-written invariant |
| `src/pages/Dashboard.tsx:449,464-485,617-649,652,922-937,1167` | Modify | point aggregates at the model |
| `src/pages/Dashboard.tsx:522-525` | Modify | delete stale comment |
| `src/pages/Transactions.tsx:698` | Modify | relabel + sub-line (Phase 2) |
| `src/pages/BudgetControl.tsx:1331` | Modify | "planned" label (Phase 2) |
| `src/lib/expense-filtering.ts:63-67` | Read-only | name-matching is superseded, leave callers alone |
| `src/hooks/useCardProjection.ts`, `src/lib/forecast-engine.ts` | **DO NOT TOUCH** | already correct |

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Merging generators over-counts (CC plans, saving-phase cars, historical installments) | Never merge raw rows; derive from `getMonthlyPlanCashExpenses` + `getActiveCarLoanPayments`, which already filter. Explicit test per case. |
| A user's hand-made recurring rule for their car payment duplicates the derived row (dedupe keys on `date:note:amount` and will not match) | Detect overlap by account + amount + month and prefer the real rule; test it. **Open question — see below.** |
| Touching `monthEndCash` breaks the cross-surface invariant | Out of scope in both phases. Write the invariant test (step 5) *before* any nearby change. |
| Numbers move on real data with no test net | Phase 1 and 2 committed separately; live-check each; `backups/` before edits. |
| Interest genuinely unavailable for some rows | Classify as `principal` and label it in the drawer; never estimate silently. |

## Open questions for Tre (do not code past these)

1. **CC-sourced payment plans.** A BNPL plan charged to a card is already in the card balance. If
   it is also counted as living spend, it double-counts; if excluded, a real purchase is invisible
   in SPENDING BY CATEGORY. Plan assumes **exclude** (matches the engine). Confirm.
2. **The hand-made-rule overlap** above — is any of your real car/plan spend currently entered as a
   recurring rule? If so I must dedupe it, and I would rather check your data than guess.
3. **Auto-loan interest.** Splitting it out is the consistent choice, but it makes the Monthly
   Expenses tile move again in Phase 2. Confirm you want the split rather than treating the whole
   auto payment as debt service.

## SESSION_ID

- CODEX_SESSION: unavailable — `codex` returned 401 Unauthorized (not logged in)
- GEMINI_SESSION: `15e2b73d-e2bf-42d5-889e-25a874d479f0` — errored, exit 41, `GEMINI_API_KEY` unset

Dual-model planning degraded to Claude-only. To restore: `codex login`, and set `GEMINI_API_KEY`
in `~/.claude/.env`.
