# Implementation Plan: Premium Loading Fix + Feature Gate Audit

## Task Type
- [x] Frontend (→ Gemini)
- [ ] Backend
- [ ] Fullstack

---

## Audit Results

### Currently gated (2 existing gates)

| Location | Feature | Gate | Bug? |
|----------|---------|------|------|
| `Dashboard.tsx:663` | Advanced Analytics | `<PremiumGate isPremium={isPremium}>` | YES — demo users see paywall |
| `NetWorth.tsx:298` | Detailed Account Management | `<PremiumGate isPremium={isPremium}>` | YES — demo users see paywall |

**Root cause of demo bug**: `useSubscription` returns `isPremium=false` when `isDemo=true`. Both existing gates pass bare `isPremium` without OR-ing `isDemo`, so demo users hit the paywall.

### Missing gates (2 new gates required)

| Location | Feature | Free limit | Premium |
|----------|---------|------------|---------|
| `SavingsGoals.tsx` (~line 267) | Add Goal + Car Fund buttons | 3 goals total | unlimited |
| `DebtPayoff.tsx` (~line 108) | Add Debt button (Other Debts tab) | 1 debt | unlimited |

### Not implementable (feature UI does not exist)

| Feature | Reason |
|---------|--------|
| Export to CSV/PDF | No export button/functionality in any page |
| Custom categories | No category management UI |
| Multiple budgets | App has one budget concept (BudgetControl); multi-budget not built |
| Priority support | Not a UI feature |
| Car fund tracker pro | Unclear distinction from standard car fund; no separate pro variant in UI |

---

## Implementation Steps

### STEP 1 — Fix Premium.tsx loading flash (Task 1)

**File**: `src/pages/Premium.tsx`

Currently, the component renders `isPremium ? 'Your Premium Plan' : 'Upgrade to Premium'` on every render including while `isLoading=true`, causing a flash of the upgrade UI for premium users.

**Fix**: Add a loading guard at the top of the return that renders a neutral skeleton
while `isLoading` is true. Only render the cards and CTA after `isLoading` is false.

**Pseudo-code**:
```tsx
// At top of JSX return, before the existing divs:
if (isLoading) {
  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <div className="h-7 w-48 bg-muted rounded animate-pulse mx-auto" />
        <div className="h-4 w-64 bg-muted rounded animate-pulse mx-auto" />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-forged p-6 h-64 bg-muted/30 animate-pulse rounded" />
        <div className="card-forged p-6 h-64 bg-muted/30 animate-pulse rounded" />
      </div>
    </div>
  );
}
// existing return content follows unchanged
```

The skeleton must match the rough layout of the two-column card grid to avoid layout shift when it resolves.

Do NOT change any of the existing JSX below the loading guard — just insert the early return.

---

### STEP 2 — Fix isDemo bypass on existing gates

**File**: `src/pages/Dashboard.tsx:663`

Change:
```tsx
<PremiumGate isPremium={isPremium} message="Unlock advanced analytics with Premium">
```
To:
```tsx
<PremiumGate isPremium={isPremium || isDemo} message="Unlock advanced analytics with Premium">
```

`isDemo` is already destructured from `useAuth()` at line 99 — no new import needed.

---

**File**: `src/pages/NetWorth.tsx:298`

Change:
```tsx
<PremiumGate isPremium={isPremium} message="Unlock unlimited account tracking with Premium">
```
To:
```tsx
<PremiumGate isPremium={isPremium || isDemo} message="Unlock unlimited account tracking with Premium">
```

`isDemo` is already destructured from `useAuth()` at line 46 — no new import needed.

---

### STEP 3 — Gate savings goals (3 goal limit)

**File**: `src/pages/SavingsGoals.tsx`

**Imports to add**:
```tsx
import { useSubscription } from '@/hooks/useSubscription';
```
`useAuth` is likely already imported; if not, add it too.

**In component body, after existing hooks**:
```tsx
const { isPremium } = useSubscription();
const { isDemo } = useAuth(); // only add if not already there
```

**Goal count for gate**: The limit applies to ALL goal types combined.
Use `(goals?.length ?? 0) + (carFunds?.length ?? 0)` or the equivalent combined count.
Check what data arrays are available at line 267 to determine the right count expression.

**Gate logic**: Wrap the Add Goal and Car Fund buttons (~line 267–268) together:
```tsx
<PremiumGate
  isPremium={isPremium || isDemo || (totalGoals < 3)}
  message="Upgrade to add unlimited savings goals"
>
  <div className="flex gap-2">
    <button onClick={() => openAdd('Custom')} ...>Add Goal</button>
    <button onClick={() => openAdd('Car Fund')} ...>Car Fund</button>
  </div>
</PremiumGate>
```

Where `totalGoals = (goals?.length ?? 0) + (carFunds?.length ?? 0)`.

This means:
- Free user with 0-2 goals → `isPremium` prop = true (gate open, buttons clickable)
- Free user with 3+ goals → `isPremium` prop = false (gate shows lock overlay)
- Premium user → `isPremium` prop = true (gate open)
- Demo user → `isPremium` prop = true (gate open, no paywall ever)

---

### STEP 4 — Gate other debts (1 debt limit)

**File**: `src/pages/DebtPayoff.tsx`

**Imports to add**:
```tsx
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
```

**In component body**:
```tsx
const { isPremium } = useSubscription();
const { isDemo } = useAuth();
```

**Debt count**: `otherDebts` is the array of non-credit-card debts (it's filtered from `debts` in the component body around line 80–100). Check the exact variable name for the other-debts array.

**Gate**: Wrap the Add Debt button (~line 108) in the Other Debts tab:
```tsx
<PremiumGate
  isPremium={isPremium || isDemo || (otherDebts.length < 1)}
  message="Upgrade to track unlimited debts"
>
  <button onClick={openAdd} ...>
    <Plus size={12} /> Add Debt
  </button>
</PremiumGate>
```

The button is currently inside a conditional `{activeTab === 'other' && (...)}`
— keep that outer condition, only replace the button with the wrapped version.

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `src/pages/Premium.tsx` | Modify | Add loading skeleton early-return guard |
| `src/pages/Dashboard.tsx` | Modify | Fix `isPremium` → `isPremium \|\| isDemo` on existing gate |
| `src/pages/NetWorth.tsx` | Modify | Fix `isPremium` → `isPremium \|\| isDemo` on existing gate |
| `src/pages/SavingsGoals.tsx` | Modify | Add useSubscription import + gate Add Goal/Car Fund buttons |
| `src/pages/DebtPayoff.tsx` | Modify | Add useSubscription import + gate Add Debt button |

**No backend changes. No changes to PremiumGate component itself.**

---

## Backup Policy (CLAUDE.md)

Before touching any file, copy to:
```
./backups/YYYY-MM-DD_HHMMSS/src/pages/<filename>
```

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| SavingsGoals car fund count variable may differ | Read file before patching; verify the exact variable holding total goal+carfund count |
| DebtPayoff `otherDebts` variable name may differ | Read file before patching; grep for the filter expression |
| Skeleton height mismatch causes layout shift | Use fixed-height skeleton divs that match card proportions |
| Goals count doesn't include carFunds | Use combined count; if carFunds not loaded at that scope, fallback to goals.length only |

---

## SESSION_ID
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
