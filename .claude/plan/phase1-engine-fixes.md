# Plan: Phase 1 Engine Fixes — Debt Payoff Accuracy

**Written:** 2026-03-27
**Status:** Awaiting approval
**Scope:** Targeted fixes — no full engine rewrites

---

## Audit Findings

### Files read
| File | Key observations |
|------|-----------------|
| `src/lib/credit-card-engine.ts:292-508` | `simulateVariablePayoff` loop — `monthExpenses` is subtracted from both `availableCash` (Step 2) AND `currentCash` (Step 7). CC-tagged expenses are included in `monthExpenses`, causing double-count. `card.monthlyNewPurchases` is NOT added to balances in the loop — so cards with ongoing purchases are never fully paid to $0. |
| `src/lib/credit-card-engine.ts:115-175` | `buildCardData` computes `monthlyNewPurchases` by summing CC-tagged rules and transactions. This is used for chart display (`projectCardVariable`) but NOT currently added to balances in `simulateVariablePayoff`. |
| `src/pages/Forecast.tsx:136-152` | `cardProjectionData` builds `monthEvents` from `scheduledEvents` but includes ALL expense events (CC + cash) in `expenses`. This is the root of TASK 1. |
| `src/lib/scheduling.ts:29-101` | `generateScheduledEvents` handles `weekly`, `monthly`, `yearly` — **missing `biweekly`**. Does correctly handle `start_date` and `end_date` for all supported frequencies. |
| `src/lib/pay-schedule.ts:680-747` | `generateCurrentMonthTransactionsFromRules` handles `biweekly` but is current-month only. Also checks `start_date > monthEnd` to exclude future-starting rules. |
| `src/integrations/supabase/types.ts:144` | `recurring_rules` schema: `{ id, name, active, rule_type ('income'/'expense'/'transfer'/'investment'), frequency ('weekly'/'biweekly'/'monthly'/'yearly'), due_day, due_month, start_date, end_date, amount, category, payment_source, deposit_account, ... }` |
| `src/lib/debt-transaction-generator.ts:46-56` | Uses flat scalars for income/expenses — ignores all non-paycheck income, ignores start_date. |

### Conflicts flagged
1. **CC double-count root**: `monthEvents.expenses` in `Forecast.tsx:147` currently includes CC-tagged expenses. These must be moved to a new `cardPurchasesPerMonth` structure.
2. **Engine signature change**: Adding `cardPurchasesPerMonth` parameter must be backward-compatible (optional, undefined = fallback to old behaviour).
3. **TASK 3 + TASK 1 are coupled**: TASK 1 removes CC from `monthExpenses`; TASK 3 re-adds them as per-card balance additions. They must be implemented together, not independently.
4. **`buildCardData.monthlyNewPurchases`** remains used by `projectCardVariable` for chart display — do NOT remove it. The simulation will now receive separate `cardPurchasesPerMonth` instead of implicitly relying on `monthlyNewPurchases`.
5. **`generateRecommendations`** (current-month only) is unaffected — it has its own cash calculation path and does not go through `simulateVariablePayoff`'s new param.
6. **TASK 5** is largely already handled: `generateScheduledEvents` already respects `start_date`. The only remaining gap is `debt-transaction-generator.ts` flat scalars — fixed by TASK 2's event-based update.
7. **TASK 4 toggle location**: Put in `DebtPayoff.tsx` (near `CreditCardEngine` component). State key: `tre:debtpayoff:pause-savings`.

---

## Files Changing

| File | Tasks | Change summary |
|------|-------|---------------|
| `src/lib/credit-card-engine.ts` | T1, T3 | New optional param `cardPurchasesPerMonth`; add purchases to balances in loop (Step 2.5); pay-in-full logic in Step 4; remove interest when end balance = 0 (already correct per Step 6 guard) |
| `src/lib/scheduling.ts` | T2, T5 | Add `biweekly` case to `generateScheduledEvents` |
| `src/pages/Forecast.tsx` | T1, T2, T4, T5 | Update `monthEvents` builder: separate cash vs CC expenses, build `cardPurchasesPerMonth`, filter income to checking-bound, apply `pauseSavings`; pass new args to engine |
| `src/pages/Transactions.tsx` | T1, T2, T4, T5, T6 | Same `monthEvents` fix in `projectedDebtPaymentTxns`; add `projectedRecurringTxns` useMemo for T6 |
| `src/pages/DebtPayoff.tsx` | T4 | Add "Pause optional savings transfers" toggle; store in `usePersistedState` |
| `src/lib/debt-transaction-generator.ts` | T2, T5 | Replace flat scalars with event-based income/expense from `generateScheduledEvents` |

---

## TASK 1 + TASK 3 — Engine: CC purchase separation + pay-in-full

### New engine parameter

```ts
// New optional 9th parameter (index 8)
cardPurchasesPerMonth?: { [cardId: string]: number }[]
// cardPurchasesPerMonth[m][cardId] = total CC purchases for card in month m
// When omitted → falls back to card.monthlyNewPurchases (legacy callers)
```

Full updated signature:
```ts
export function simulateVariablePayoff(
  cards: CardData[],
  liquidCash: number,
  cashFloor: number,
  strategy: 'avalanche' | 'snowball',
  monthlyTakeHome: number,        // scalar fallback
  monthlyExpenses: number,        // scalar fallback (CASH-only when using new path)
  months = 36,
  monthEvents?: { income: number; expenses: number }[],
  fundingAccountId?: string,
  cardPurchasesPerMonth?: { [cardId: string]: number }[],  // NEW — T1+T3
): { ... }
```

### New Step 2.5 — Add monthly CC purchases to card balances

Insert BEFORE Step 3 (pay minimums), AFTER computing `availableCash`:

```ts
// Step 2.5 — Add monthly CC purchases to each card's balance
for (const card of cards) {
  const purchases = cardPurchasesPerMonth?.[m]?.[card.id]
    ?? (m === 0 ? 0 : card.monthlyNewPurchases);
    // month 0: already in card.balance (live balance)
    // months 1+: fallback to monthlyNewPurchases if no per-month data
  if (purchases > 0) {
    balances.set(card.id, (balances.get(card.id) ?? 0) + purchases);
  }
}
```

**Why month 0 = 0?** The live `card.balance` already includes any CC purchases made this month before today. Adding month 0 purchases again would double-count within the current partial month.

### Step 4 change — pay-in-full when possible

Replace current `maxExtra` logic:

```ts
// CURRENT (does not support pay-in-full)
const maxExtra = bal - alreadyPaid;
const extra = Math.min(remaining, maxExtra);

// NEW (pay-in-full: bal already includes purchases from Step 2.5)
const maxExtra = bal - alreadyPaid;  // bal is now balance+purchases
const extra = Math.min(remaining, maxExtra);
// No structural change needed — when remaining >= maxExtra, card reaches 0.
// The existing C8 overpayment clamp `if (pay > bal) payments.set(card.id, bal)`
// already ensures we never overpay. This is already correct.
```

The pay-in-full behaviour falls out naturally once purchases are added to `bal` in Step 2.5. No additional logic required in Step 4.

### Step 6 — No interest when balance = 0 (verify existing)

```ts
// EXISTING — already correct:
if (bal > 0 && card.apr > 0) {
  const interest = (card.apr / 100 / 12) * bal;
  balances.set(card.id, bal + interest);
}
// If end balance = 0, no interest. ✓
```

### Recurrent pay-in-full card logic (Step 8 / C8 override)

When a card reaches balance = 0 with recurring purchases, it needs to stay payable each month. Currently `activeCards` filters to `balance > 0`, which means a $0-balance card with purchases gets skipped.

Fix: change `activeCards` check to include cards that have purchases this month even if current balance = 0:

```ts
// CURRENT
const activeCards = cards.filter(c => (balances.get(c.id) ?? 0) > 0);

// NEW — include cards with purchases this month (they'll be added in Step 2.5)
const monthPurchasesForCard = (card: CardData) =>
  cardPurchasesPerMonth?.[m]?.[card.id] ?? (m === 0 ? 0 : card.monthlyNewPurchases);

const activeCards = cards.filter(c =>
  (balances.get(c.id) ?? 0) > 0 || monthPurchasesForCard(c) > 0
);
```

And the `activeCards.length === 0` early-exit guard (for C8 overpayment) becomes:
```ts
// Only exit early if ALL cards are at 0 AND no card has purchases this month
const allPaid = cards.every(c =>
  (balances.get(c.id) ?? 0) === 0 && monthPurchasesForCard(c) === 0
);
if (allPaid) { ... accumulate cash, continue ... }
```

---

## TASK 2 — Fix income calculation + biweekly support

### 2a. Add biweekly to `generateScheduledEvents` (`scheduling.ts`)

Insert after the `weekly` block (line 65):

```ts
} else if (rule.frequency === 'biweekly') {
  const dayOfWeek = rule.due_day ?? 5;
  const d = new Date(Math.max(from.getTime(), startDate.getTime()));
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  while (d <= effectiveEnd) {
    events.push({
      date: d.toISOString().split('T')[0],
      name: rule.name,
      amount: Number(rule.amount),
      type: rule.rule_type,
      source: accountName,
      ruleId: rule.id,
    });
    d.setDate(d.getDate() + 14);
  }
```

### 2b. Income filtering — only checking-bound income

When building `monthEvents`, filter income events to rules where `deposit_account` resolves to a liquid (checking/cash) account:

```ts
// Build set of liquid account IDs
const liquidAccountIds = new Set<string>(
  accounts
    .filter((a: any) => a.active && ['checking','business_checking','cash'].includes(a.account_type))
    .map((a: any) => a.id)
);

// Build set of rule IDs that deposit into a liquid account
// (income rules with no deposit_account = paycheck → treat as liquid)
const incomeToLiquidRuleIds = new Set<string>(
  rules.filter((r: any) => {
    if (!r.active || r.rule_type !== 'income') return false;
    if (!r.deposit_account) return true;   // paycheck — assume checking
    return liquidAccountIds.has(r.deposit_account);
  }).map((r: any) => r.id)
);
```

Then in the `monthEvents` income filter:
```ts
income: eventsInMonth
  .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
  .reduce((s, e) => s + e.amount, 0)
```

**Note**: `ScheduledEvent` has `ruleId?: string`. All events from `generateScheduledEvents` have `ruleId` set. This filter is safe.

### 2c. Fix `debt-transaction-generator.ts` to use event-based income/expenses

Replace the flat-scalar block in `generateDebtPaymentTransactions`, `getDebtPaymentsByMonth`, and `getDebtBalancesByMonth` with event-based computation using `generateScheduledEvents`.

Refactor: extract a shared helper inside `debt-transaction-generator.ts`:

```ts
import { generateScheduledEvents } from './scheduling';

function buildFlatMonthlyTotals(rules: any[], accounts: any[], profile: any) {
  // Keep as flat scalar fallback — used by existing callers
  const weeklyGross = Number(profile?.weekly_gross_income) || 1875;
  const taxRate = Number(profile?.tax_rate) || 22;
  const monthlyTakeHome = weeklyGross * (1 - taxRate / 100) * 4.33;
  const monthlyExpenses = rules.filter((r: any) => r.active && r.rule_type === 'expense')
    .reduce((s, r) => { ... }, 0);
  return { monthlyTakeHome, monthlyExpenses };
}

// New: event-based (used by getCardProjections when called from outside this file)
// Add optional monthEvents/cardPurchasesPerMonth params to getCardProjections
```

For now, `debt-transaction-generator.ts` callers will continue using flat scalars (they don't have `accounts` in the right shape for per-card CC filtering). TASK 2+5 for this file = the start_date gap is already covered by `generateScheduledEvents` (which we're not yet using here). Mark as a follow-up unless you want it addressed now.

**Decision point for user**: Should `debt-transaction-generator.ts` also be upgraded to event-based, or is it sufficient that `Forecast.tsx` and `Transactions.tsx` use event-based (the two places that render the data)?

---

## TASK 4 — Pause savings transfers toggle

### DebtPayoff.tsx

Add near top of component:
```ts
const [pauseSavings, setPauseSavings] = usePersistedState('tre:debtpayoff:pause-savings', false);
```

Add toggle UI below the `CreditCardEngine` component (or near the top of the page):
```tsx
<div className="flex items-center justify-between p-3 bg-secondary border border-border" style={{ borderRadius: 'var(--radius)' }}>
  <div>
    <p className="text-xs font-medium">Pause optional savings transfers during payoff</p>
    <p className="text-[10px] text-muted-foreground">Excludes Savings and Investing transfers from available cash calculation</p>
  </div>
  <button
    onClick={() => setPauseSavings((v: boolean) => !v)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pauseSavings ? 'bg-primary' : 'bg-muted'}`}
  >
    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${pauseSavings ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
</div>
```

### Pass `pauseSavings` to engine callers

`Forecast.tsx` `cardProjectionData` and `Transactions.tsx` `projectedDebtPaymentTxns` both need to read this persisted value:

```ts
const [pauseSavings] = usePersistedState('tre:debtpayoff:pause-savings', false);
```

Then in `monthEvents` builder, filter out savings/investing expenses:

```ts
// Build set of savings/investing rule IDs (to exclude when pauseSavings)
const savingsRuleIds = new Set<string>(
  rules.filter((r: any) =>
    r.active && r.rule_type === 'expense' &&
    (r.category === 'Savings' || r.category === 'Investing')
  ).map((r: any) => r.id)
);

// In cashExpenses filter:
.filter(e =>
  e.type === 'expense' &&
  !isCcExpense(e) &&
  !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId))
)
```

### Transactions.tsx "paused" visual

When `pauseSavings` is on and a transaction matches a savings/investing rule, show a muted "paused" badge (similar to "projected" badge styling). This applies to recurring transactions shown in any view.

Add to render logic (alongside existing badge checks):
```tsx
{pauseSavings && (t as any).ruleId && savingsRuleIds.has((t as any).ruleId) && (
  <span className="text-[9px] text-muted-foreground bg-muted/30 px-1 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
    paused
  </span>
)}
```

Note: `baseTxns` from `mergeWithGeneratedTransactions` includes `ruleId` on generated transactions. This is already preserved.

---

## TASK 5 — start_date filtering (already mostly handled)

`generateScheduledEvents` already handles `start_date` for all frequencies (verified in audit).

The only remaining gap is `debt-transaction-generator.ts` flat scalars (see TASK 2c above — flagged as decision point).

No additional changes needed beyond TASK 2.

---

## TASK 6 — Projected recurring transactions in Forecast Range view

### New `projectedRecurringTxns` useMemo in `Transactions.tsx`

```ts
// Build account name → ID lookup for source mapping
const accountByName = useMemo(() => {
  const map: Record<string, string> = {};
  accounts.forEach((a: any) => { map[a.name] = a.id; });
  return map;
}, [accounts]);

// Build set of savings rule IDs for "paused" badge
const savingsRuleIds = useMemo(() => new Set<string>(
  rules.filter((r: any) => r.active && r.rule_type === 'expense' &&
    (r.category === 'Savings' || r.category === 'Investing'))
  .map((r: any) => r.id)
), [rules]);

// Build rule ID → category lookup
const ruleCategoryMap = useMemo(() => {
  const map: Record<string, string> = {};
  rules.forEach((r: any) => { map[r.id] = r.category || 'Other'; });
  return map;
}, [rules]);

const projectedRecurringTxns = useMemo(() => {
  if (filterMonth !== 'forecast') return [];

  const schedEvts = generateScheduledEvents(rules, accounts, 36);
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return schedEvts
    .filter(e => {
      const monthKey = e.date.substring(0, 7);
      return monthKey > currentMonthKey;  // future months only (current month handled by baseTxns)
    })
    .map(e => {
      const acctId = e.source ? accountByName[e.source] : undefined;
      return {
        id: `proj:sched:${e.ruleId ?? e.name}:${e.date}`,
        date: e.date,
        type: e.type as 'income' | 'expense',
        amount: e.amount,
        category: e.type === 'income' ? 'Income' : (e.ruleId ? ruleCategoryMap[e.ruleId] ?? 'Other' : 'Other'),
        note: e.name,
        payment_source: acctId ? `account:${acctId}` : '',
        isGenerated: true,
        isDebtPayment: false,
        projected: true,
        ruleId: e.ruleId,
      };
    });
}, [filterMonth, rules, accounts, accountByName, ruleCategoryMap]);
```

Add `projectedRecurringTxns` to `allTransactions` merge:
```ts
const allTransactions = useMemo(() => {
  const merged = mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTransactions);
  return [
    ...merged,
    ...reconciliationTxns,
    ...projectedDebtPaymentTxns,
    ...projectedRecurringTxns,  // NEW T6
  ].sort((a, b) => b.date.localeCompare(a.date));
}, [..., projectedRecurringTxns]);
```

The existing `projected: true` guard in `filtered` already prevents these from showing in non-forecast views.

---

## monthEvents + cardPurchasesPerMonth builder (shared logic for Forecast + Transactions)

Both `cardProjectionData` (Forecast.tsx) and `projectedDebtPaymentTxns` (Transactions.tsx) need the same builder. To avoid duplication, extract a helper. But since both live in `.tsx` files calling hooks differently, the simplest approach is to keep the logic inline (it's ~40 lines) and accept the duplication.

**Builder pseudocode** (inline in both useMemos):

```ts
const now = new Date();
const todayStr = now.toISOString().split('T')[0];

// 1. Lookup sets
const liquidAccountIds = new Set<string>(
  accounts.filter((a: any) => a.active && ['checking','business_checking','cash'].includes(a.account_type))
         .map((a: any) => a.id)
);

const incomeToLiquidRuleIds = new Set<string>(
  rules.filter((r: any) => r.active && r.rule_type === 'income' &&
    (!r.deposit_account || liquidAccountIds.has(r.deposit_account)))
  .map((r: any) => r.id)
);

// CC rule IDs (explicitly tagged + default-card rules for CC_DEFAULT_CATEGORIES)
const ccPaymentSourceIds = new Set<string>(
  cards.flatMap(c => [c.id, `account:${c.id}`])
);
const ccExplicitRuleIds = new Set<string>(
  rules.filter((r: any) => r.active && r.rule_type === 'expense' &&
    r.payment_source && ccPaymentSourceIds.has(r.payment_source))
  .map((r: any) => r.id)
);
// Default-card rules (no payment_source, category in CC_DEFAULT_CATEGORIES)
const highestAprCardId = cards.length > 0
  ? [...cards].sort((a, b) => b.apr - a.apr)[0].id : '';
const ccDefaultRuleIds = new Set<string>(
  rules.filter((r: any) => r.active && r.rule_type === 'expense' &&
    !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
  .map((r: any) => r.id)
);
const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

// Per-card explicit rule IDs (for cardPurchasesPerMonth)
const cardRuleIdMap = new Map<string, Set<string>>(
  cards.map(c => {
    const cKey = `account:${c.id}`;
    const ruleIds = new Set<string>(
      rules.filter((r: any) => r.active && r.rule_type === 'expense' &&
        (r.payment_source === c.id || r.payment_source === cKey))
      .map((r: any) => r.id)
    );
    return [c.id, ruleIds];
  })
);
// Add default-card rules to highest-APR card
if (highestAprCardId) {
  const existing = cardRuleIdMap.get(highestAprCardId) ?? new Set();
  ccDefaultRuleIds.forEach(id => existing.add(id));
  cardRuleIdMap.set(highestAprCardId, existing);
}

// Savings/investing rule IDs (for pauseSavings)
const savingsRuleIds = new Set<string>(
  rules.filter((r: any) => r.active && r.rule_type === 'expense' &&
    (r.category === 'Savings' || r.category === 'Investing'))
  .map((r: any) => r.id)
);

// 2. Build per-month arrays
const monthEvents: { income: number; expenses: number }[] = [];
const cardPurchasesPerMonth: { [cardId: string]: number }[] = [];

for (let i = 0; i < 36; i++) {
  const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
  const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const eventsInMonth = scheduledEvents.filter(e =>
    e.date.startsWith(monthKey) && (i > 0 || e.date >= todayStr)
  );

  const income = eventsInMonth
    .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
    .reduce((s, e) => s + e.amount, 0);

  const cashExpenses = eventsInMonth
    .filter(e =>
      e.type === 'expense' &&
      !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
      !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId))
    )
    .reduce((s, e) => s + e.amount, 0);

  monthEvents.push({ income, expenses: cashExpenses });

  // Per-card purchases (only for months 1+; month 0 = 0, already in card.balance)
  const cardPurchases: { [cardId: string]: number } = {};
  if (i > 0) {
    for (const card of cards) {
      const ruleIds = cardRuleIdMap.get(card.id) ?? new Set();
      cardPurchases[card.id] = eventsInMonth
        .filter(e => e.type === 'expense' && e.ruleId && ruleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);
    }
  }
  cardPurchasesPerMonth.push(cardPurchases);
}

// 3. Call engine
const sim = simulateVariablePayoff(
  cards, liquidCash, cashFloor, strategy,
  monthlyTakeHome, monthlyExpenses,  // scalar fallbacks (no longer used since monthEvents provided)
  36,
  monthEvents,
  fundingAccountId,
  cardPurchasesPerMonth,
);
```

---

## Implementation Steps (execution order)

```
Step 1: scheduling.ts — add biweekly case
Step 2: credit-card-engine.ts — add cardPurchasesPerMonth param + Step 2.5 + activeCards fix
Step 3: Forecast.tsx — update cardProjectionData monthEvents builder + add pauseSavings read
Step 4: Transactions.tsx — update projectedDebtPaymentTxns + add projectedRecurringTxns
Step 5: DebtPayoff.tsx — add pause toggle UI
Step 6: debt-transaction-generator.ts — (optional, see decision point in TASK 2c)
```

---

## Key Files Summary

| File | Lines affected | Operation |
|------|---------------|-----------|
| `src/lib/scheduling.ts:65` | ~10 lines | Add biweekly block after weekly |
| `src/lib/credit-card-engine.ts:292-320` | Signature + ~20 lines | Add `cardPurchasesPerMonth` param |
| `src/lib/credit-card-engine.ts:355-365` | ~8 lines | Fix `activeCards` to include cards with purchases |
| `src/lib/credit-card-engine.ts:~368` | ~10 lines | Add Step 2.5 purchase accumulation |
| `src/pages/Forecast.tsx:136-152` | ~60 lines (replace 15) | Full monthEvents + cardPurchasesPerMonth builder |
| `src/pages/Forecast.tsx:~5` | +1 import | Add `usePersistedState` for pauseSavings (already imported) |
| `src/pages/Transactions.tsx:~97-150` | ~65 lines | Update projectedDebtPaymentTxns builder |
| `src/pages/Transactions.tsx:~97` | ~30 lines | Add projectedRecurringTxns useMemo |
| `src/pages/Transactions.tsx:~99` | 1 line | Add projectedRecurringTxns to allTransactions merge |
| `src/pages/Transactions.tsx:render` | ~5 lines | Add "paused" badge render |
| `src/pages/DebtPayoff.tsx:~25` | 1 line | Add pauseSavings persiested state |
| `src/pages/DebtPayoff.tsx:JSX` | ~15 lines | Toggle UI |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Month 0 CC purchases double-count if card balance was already updated | Set `cardPurchasesPerMonth[0][cardId] = 0` — live balance already reflects current purchases |
| `ScheduledEvent.ruleId` is `string \| undefined` — filtering by `e.ruleId && set.has(e.ruleId)` is safe | Confirmed: all events from `generateScheduledEvents` have `ruleId` set; undefined events pass through to cash expenses (conservative) |
| biweekly rules generating wrong dates (first occurrence not aligned to due_day) | Logic mirrors the existing biweekly handling in `generateCurrentMonthTransactionsFromRules` — advance to first occurrence of `due_day`, then +14 days each iteration |
| T6: 36 months × many rules = large array | Forecast Range view is opt-in; array is built lazily (only when `filterMonth === 'forecast'`). Acceptable trade-off. |
| `debt-transaction-generator.ts` still using flat scalars after T2 | Decision point — see TASK 2c. If left as-is, `getDebtPaymentsByMonth` and `getDebtBalancesByMonth` (used in Forecast.tsx `projections` useMemo) will still use scalars for the outer forecast loop. This is a separate concern from `cardProjectionData`. |

---

## Decision Point Required Before Execution

**Q1 (TASK 2c)**: Should `debt-transaction-generator.ts` (`getDebtPaymentsByMonth`, `getDebtBalancesByMonth`, `generateDebtPaymentTransactions`) be upgraded to event-based income/expenses in this pass, or deferred?

These functions feed `Forecast.tsx projections` (outer useMemo, not `cardProjectionData`). Updating them would require passing `scheduledEvents`, `accounts` context into them. If deferred, the outer Forecast projection loop still uses scalars for its debt payment estimates.

**Recommendation**: Defer to a follow-up. The `cardProjectionData` fix (what drives the CC debt payoff chart and Transactions projected payments) is the highest-impact change. The outer forecast loop's debt estimates are secondary.

**Q2 (TASK 4 location)**: Toggle in DebtPayoff.tsx only, or also visible on Forecast.tsx? Recommend DebtPayoff.tsx only.

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
