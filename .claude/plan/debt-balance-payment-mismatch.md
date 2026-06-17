# Implementation Plan: Fix balance-table vs. recommended-payment mismatch in useCardProjection

## Task Type
- [x] Backend (data/calculation logic only — no UI changes)

## Confirmed Root Cause (re-verified against current source, exact line numbers)

`src/hooks/useCardProjection.ts` builds the per-card balance/cycling table (`data`, what
Forecast's popup and the Debt Payoff chart read) **before** the function has finished computing
the real, cash-floor-protected recommended payment (`perCardPaymentsScaled`):

1. **Lines 736-748**: `projs` (the per-card month-by-month projection used to build `data`) is
   built by calling `projectCardVariable(c, pays, ...)` where `pays = sim.monthlyPayments.get(c.id)`.
   `sim` at this point is the simulation after 3 outer floor-protection passes — already better
   than a naive bootstrap, but it is **not** the final answer. It does not reflect the separate
   `pass3RevTotals` cash-walk (lines 886-931) or the month-0 `sim2` capped retry (lines 941-1045),
   both of which run *after* `projs`/`data` already exist.
2. **Lines 752-781**: `data` is built from `projs` plus `sim.monthlyRevolvingBalances` /
   `sim.monthlyBalances` directly (not `activeSim`) for `totalCCBalance` / `displayCCBalance`.
3. **Lines 941-1045**: when month-0 cash is over-allocated, a second simulation `sim2` runs and
   `activeSim = sim2` becomes the simulation every other return value is based on. The retry
   patches `data[i].totalCCBalance` (lines 976-980) but **never touches `data[i][cardName]`** —
   the actual per-card balance values stay frozen on the original `sim`, forever.
4. **Lines 1124-1148**: `perCardPaymentsScaled` — the true final, cash-floor-protected,
   displayed-everywhere-else recommended payment — is computed last, from `activeSim` +
   `pass3RevTotals` + `debtPaymentTotals` + `extraPerCardByMonth`/`protectedPerCardByMonth`.
   **`data` is never rebuilt from it.**

Net effect: the balance/cycling chart assumes a payment series (`sim.monthlyPayments`) that is
frequently larger than what `perCardPaymentsScaled` actually recommends/pays, so the chart shows
cards clearing/cycling faster than reality. Confirmed empirically via
`src/hooks/__tests__/cyclingDropDiagnostic.test.ts` against this user's live data:
Prime Visa month 1: raw $3546 vs scaled $2396 (~$1150 gap); Discover month 3: raw $696 vs scaled
$212 (~$484 gap); Discover month 4: raw $2003 vs scaled $1520 (~$483 gap).

### Why this isn't a simple reorder (the circular dependency)

`debtPaymentTotals` (lines 788-804) — an input to `pass3RevTotals`, hence to
`perCardPaymentsScaled` — is currently *derived from `projs`* (it reads
`proj.months[i].startBalance` and `.payment`). That makes it look like `projs` must exist before
`perCardPaymentsScaled` can be computed, which is what forced `projs`/`data` to be built early in
the first place.

**This dependency is unnecessary.** `projectCardVariable`'s `.payment` field is just an echo of
the `monthlyPayments[m-1]` fed into it (capped to not exceed balance+purchases+interest, which
for a genuinely-revolving card practically never binds). `debtPaymentTotals` can be computed
directly from `sim.monthlyPayments` + `sim.monthlyRevolvingBalances` — the exact same two sim
outputs `projs` is built from — with no need for `projs` to exist at all. Once that's done, the
circularity disappears entirely: `projs`/`data` can be built last, from `perCardPaymentsScaled`,
with nothing downstream depending on them.

## Technical Solution

1. **Decouple `debtPaymentTotals` from `projs`.** Replace the `projs`-based reduction (lines
   788-804) with a direct computation from `sim.monthlyRevolvingBalances` (for the
   start-of-month revolving check, same logic already used) and `sim.monthlyPayments` (for the
   payment amount):
   ```ts
   const computeDebtPaymentTotals = (
     simResult: { monthlyPayments: Map<string, number[]>; monthlyRevolvingBalances: Map<string, number[]> },
   ): number[] =>
     Array.from({ length: 36 }, (_, i) =>
       cards.reduce((total, c) => {
         const startRevBal = i === 0
           ? (simResult.monthlyRevolvingBalances.get(c.id)?.[0] ?? 0)
           : (simResult.monthlyRevolvingBalances.get(c.id)?.[i - 1] ?? 0);
         if (startRevBal <= 0) return total;
         return total + (simResult.monthlyPayments.get(c.id)?.[i] ?? 0);
       }, 0),
     );
   const debtPaymentTotals = computeDebtPaymentTotals(sim);
   ```
   This produces the same values as today (it's the same underlying numbers `projs` was echoing)
   but removes the dependency on `projs` existing.

2. **Simplify the `sim2` retry's `debtPaymentTotals` recompute.** Lines 987-999 currently build a
   throwaway `projs2` purely to recompute `debtPaymentTotals` from `sim2`. Replace with
   `debtPaymentTotals = computeDebtPaymentTotals(sim2)` (same helper from step 1, called with
   `sim2`). Delete the `projs2` block entirely.

3. **Delete the now-unnecessary partial `data` patch.** Remove lines 976-980 (the
   `data[i].totalCCBalance = ...` patch inside the `sim2` branch) — `data` will not exist yet at
   this point once step 4 is applied, so there's nothing to patch. `totalCCBalance` will be
   correct from the single, later `data` construction (step 4) because it will read from
   `activeSim` directly.

4. **Move `projs`/`data`/`totalLimit` construction to after `perCardPaymentsScaled` is final**
   (i.e., after current line 1148), and change what they're built from:
   ```ts
   const projs = cards.map(c => {
     const pays = perCardPaymentsScaled.find(p => p.id === c.id)?.payments || [];
     const revBals = activeSim.monthlyRevolvingBalances.get(c.id) || [];
     const purchases = cardPurchasesPerMonth.map(monthMap => monthMap[c.id] ?? 0);
     return projectCardVariable(c, pays, 36, true, purchases, revBals);
   });
   const totalLimit = cards.reduce((s, c) => s + c.creditLimit, 0);
   const data = Array.from({ length: 36 }, (_, i) => {
     // same body as today, lines 752-781, EXCEPT:
     //   - totalCCBalance reduces over activeSim.monthlyRevolvingBalances (not sim's)
     //   - displayCCBalance loop reads activeSim.monthlyBalances (not sim's)
   });
   ```
   Update the final return's `cards: projs.map(p => ({ name: p.card.name, color: p.card.color }))`
   (line 1251) — no change needed beyond `projs` now being defined later in the function body.

   This is safe because nothing between the old construction site (line 736) and
   `perCardPaymentsScaled` (line 1148) reads `projs` or `data` once step 1-3 are applied —
   confirmed by tracing every reference to both identifiers in the function body.

5. **Fix the secondary cosmetic bug** in `src/lib/credit-card-engine.ts:370`
   (`projectCardVariable`'s cycling branch). `cycleStartBal = cyclingPayment` fabricates the
   displayed cycling-row start balance as the payment amount. The function already tracks the
   real running balance in `startBal` (computed at line 316, in scope). Change:
   ```ts
   const cycleStartBal = Math.round(startBal * 100) / 100;
   ```
   This mirrors the rounding convention already used for the non-cycling branch's `startBalance`
   (line 390).

## Cross-Consumer Risk Check (already investigated, not theoretical)

- **Forecast.tsx's own PASS-3**: untouched. It's a separate, independent implementation in a
  different file with its own data — this fix only changes `useCardProjection.ts` and one shared
  helper in `credit-card-engine.ts`. No shared state, no risk.
- **`src/components/debt/CreditCardEngine.tsx`** (3 call sites of `projectCardVariable`, its own
  independent `variableSim`): unaffected by steps 1-4 (those are scoped inside
  `useCardProjection.ts`). Affected by step 5 (`cycleStartBal` fix, since it's the same shared
  function) — grep confirms the *current* live version of this file does not read `.startBalance`
  from the projection rows (only stale files under `backups/` do) — but **re-verify this directly
  against the live file before merging**, since a missed live usage would silently change a
  displayed number there too.
- **`src/lib/debt-transaction-generator.ts`** (2 call sites): one call site (line 120) reads
  `row.startBalance <= 0` to decide an `isAutopay` cosmetic label suffix
  (`"(Autopay)"`) on a generated transaction note — not used for any balance/payment math.
  Affected by step 5 only; impact is at most a label changing on some generated transaction
  notes, never an amount.
- **`src/hooks/__tests__/useCardProjection.cyclingMisclassification.test.ts`**: only asserts on
  `perCardPaymentsScaled` magnitudes. That computation chain is unchanged in value (step 1 is a
  refactor, not a behavior change for `debtPaymentTotals`) — should pass unmodified, but must be
  run to confirm.
- **`src/hooks/__tests__/cyclingDropDiagnostic.test.ts`** (temporary diagnostic, real user data):
  use this to verify the fix — after the change, `data[i][cardName]` should track
  `perCardPaymentsScaled` rather than the raw sim, closing the dollar gaps documented above.
  Delete this file once verified (per its own header comment) unless converted into a permanent
  regression test asserting `data`'s implied per-month payment matches `perCardPaymentsScaled`
  within rounding.

## Implementation Steps

1. Back up `src/hooks/useCardProjection.ts` and `src/lib/credit-card-engine.ts` to
   `./backups/<timestamp>/...` (per CLAUDE.md backup policy — multi-file, financial-calculation
   change).
2. In `credit-card-engine.ts`: apply step 5 (`cycleStartBal` fix). Run the existing test suite for
   this file's callers immediately after (cheap, isolated change) before touching the hook.
3. In `useCardProjection.ts`: apply step 1 (extract `computeDebtPaymentTotals`, call with `sim`).
4. Apply step 2 (simplify the `sim2`-branch recompute to reuse the new helper; delete `projs2`).
5. Apply step 3 (delete the now-dead `data[i].totalCCBalance` patch in the `sim2` branch).
6. Apply step 4 (relocate `projs`/`totalLimit`/`data` construction to after
   `perCardPaymentsScaled`, switch their sim references to `perCardPaymentsScaled`/`activeSim`).
7. Re-run `npx vitest run src/hooks/__tests__/useCardProjection.cyclingMisclassification.test.ts
   src/hooks/__tests__/cyclingDropDiagnostic.test.ts --reporter=verbose` and confirm:
   - existing regression test still passes unmodified
   - diagnostic test's `dataRow` sequences for Prime Visa / Discover now track
     `perCardPaymentsScaled`, not the old raw-sim-derived values
8. Run the full test suite (`npx vitest run`) to catch any other regression.
9. Manually sanity-check in the running app (Debt Payoff tab + Forecast popup) for this user's
   real data — confirm Prime Visa / Discover balances now decline at a pace consistent with the
   recommended payment shown elsewhere, not faster.
10. Delete `src/hooks/__tests__/cyclingDropDiagnostic.test.ts` once verified, unless promoted to a
    permanent regression test (recommend promoting a trimmed version — assert
    `data[i][cardName]`'s implied payment equals `perCardPaymentsScaled` for at least one
    revolving-card month — rather than deleting outright, so this exact regression can't recur
    silently).
11. Commit locally only (no push): `[debt/forecast]: rebuild balance table from the scaled
    recommended payment, not the raw simulation pass`.

## Key Files

| File | Operation | Description |
|------|-----------|--------------|
| `src/hooks/useCardProjection.ts:788-804` | Modify | Decouple `debtPaymentTotals` from `projs`; compute directly from sim outputs |
| `src/hooks/useCardProjection.ts:736-781` | Move + Modify | Relocate `projs`/`data`/`totalLimit` to after `perCardPaymentsScaled`; source from `perCardPaymentsScaled`/`activeSim` |
| `src/hooks/useCardProjection.ts:933-1045` | Modify | Simplify `sim2` retry: reuse `computeDebtPaymentTotals(sim2)`, delete `projs2`, delete dead `data` patch |
| `src/lib/credit-card-engine.ts:370` | Modify | `cycleStartBal = cyclingPayment` → `cycleStartBal = Math.round(startBal * 100) / 100` |
| `src/hooks/__tests__/useCardProjection.cyclingMisclassification.test.ts` | Verify (no change expected) | Confirm existing regression still holds |
| `src/hooks/__tests__/cyclingDropDiagnostic.test.ts` | Verify, then delete or promote | Confirms the fix closes the dollar gaps; was the diagnostic tool used to find this bug |
| `src/components/debt/CreditCardEngine.tsx` | Verify only, no planned change | Re-check no live `.startBalance` read exists before merging step 5 |
| `src/lib/debt-transaction-generator.ts:120` | Verify only, no planned change | `isAutopay` label only, no amount impact from step 5 |

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Moving `projs`/`data` later silently breaks something that read them in between | Traced every reference in the function body (Phase 1 research) — nothing between old and new construction sites reads either identifier once steps 1-3 land; re-confirm with `grep -n "projs\|data\[" useCardProjection.ts` after the edit, before running tests |
| `cycleStartBal` fix changes a number some other UI silently renders | Grep confirms no live (non-backup) consumer reads `.startBalance` from a `projectCardVariable` row today; re-verify directly against `CreditCardEngine.tsx`'s live render path before merging |
| `computeDebtPaymentTotals` doesn't reproduce today's exact values (rounding drift) | Run the diagnostic test before and after the refactor-only step (step 1) in isolation, diff `debtPaymentTotals` arrays — should be byte-identical before any other step is applied |
| Feeding `perCardPaymentsScaled` (which can be lower than sim's natural payment) into `projectCardVariable` produces a different `isCycling` classification than before | This is intentional and already anticipated by `projectCardVariable`'s own docstring on the `revolvingBalances` param ("a scaled-down displayed payment could flash 'cycling' before the real balance... has actually cleared") — the function's dual-track ground-truth/local-replay gate exists specifically for this case |
| Regression suite has blind spots for this path | Diagnostic test (real production data, not synthetic fixtures) is the primary verification; keep it (promoted) rather than deleting, per the table above |

## Next Steps

After review, execute manually — this plan does not auto-implement. No external
Codex/Gemini session was used (those backends are not installed in this environment); this plan
was produced by direct codebase research and single-model synthesis.
