# Handoff — 2026-07-20 (session 9) — Anomaly B DESIGNED, not yet implemented

## State: on `main`, clean except backups/ (untracked, never commit). Local commits `64a1182b` (Anomaly A) + handoff commits are NOT pushed — push only when Tre asks.

## Goal (approved by Tre — implement, don't re-ask)
Anomaly B: route the pinned-override sim in CreditCardEngine through `runDebtCashConvergence`
so pinned and unpinned accordion rows share the converged basis. Today
`CreditCardEngine.tsx:760` builds `overrideSim = variableSim.runSim(overrides)` (single-pass,
LOCAL sim) and lines 908-916 / 972-973 switch ALL rows to it when any pin exists — the Q4
divergence class.

## Design (fully derived this session — code read, plan settled, NO source edits made yet)

Backups already taken: `backups/2026-07-20_182906/` has CreditCardEngine.tsx,
useCardProjection.ts, debt-model-types.ts.

### Key facts established by reading code
- `simulateVariablePayoff` (credit-card-engine.ts:677): param #20 = `debtCashTargetByMonth`,
  param #21 = `paymentOverridesByMonth` ({cardId: {monthIdx: totalPayment}}, clamped to
  [required min, available cash]).
- `useCardProjection.ts:1736` `resimulateWithDebtCash(target, cap)` replays the ACTIVE sim's
  exact args (cards, debtFundingBalance, debtPayoffOptions.cashFloor, debtStrategy,
  monthlyTakeHome, monthlyExpenses, PROJECTION_MONTHS, simulationMonthEvents, undefined,
  cardPurchasesPerMonth, m0Income, activeSimM0Expenses, oneTimeArrWithDP, m0SafeFloor,
  `cap ?? activeSimMaxDebt`, augmentedCashFloorByMonth, ccMinInFloorByMonth,
  installmentChargeByMonth, upfrontPayByMonth, target) then
  `{...hookResult, ...buildResimOverrides(simT, {cards, cardPurchasesPerMonth, now,
  saveUpMonths, maxDebtPaymentByMonth}), resimulateWithDebtCash}`. It NEVER passes param #21 —
  that's the hole. Convergence always resims FROM BASE, so pins must be baked into the
  closure, not passed per call.
- `runDebtCashConvergence(base, engineInputs)` replaces `engineInputs.cardProjectionData`
  with `base` internally — passing the raw bundle engineInputs is fine.
- CreditCardEngine is rendered ONLY by DebtPayoff.tsx (line 357), which is inside
  CardProjectionProvider — so CreditCardEngine can call `useCardProjectionContext()` and read
  `forecastInputsBundle.engineInputs` (whose `.cardProjectionData` is the RAW pre-convergence
  hook result).
- CardProjectionResult type lives in `src/lib/debt-model-types.ts`.
- Anomaly A clamp note (CreditCardEngine.tsx:1720-1783) reads `row.payment` from
  `projections` — keeps working as long as projections come from the converged override data.
- Context's `debtPayoffOptions.overrides` is hardcoded `{}` (CardProjectionContext.tsx:143);
  the hook never sees pins. Pins are LOCAL state in CreditCardEngine (`overrides`).

### Step 1 — debt-model-types.ts: add to CardProjectionResult (optional, fixture compat):
```ts
/** Anomaly B: this same result rebuilt with user month-pins (sim param #21,
 * paymentOverridesByMonth) applied — both the base sim AND the returned
 * resimulateWithDebtCash closure carry the pins, so a convergence loop run on the
 * variant keeps them on every pass. Optional: fixture snapshots predate it. */
withPaymentOverrides?: (pinnedPayments: { [cardId: string]: Record<number, number> }) => CardProjectionResult;
```

### Step 2 — useCardProjection.ts: replace lines 1736-1767 with
```ts
const replayActiveSim = (
  target?: number[],
  forecastMaxDebtPaymentByMonth?: number[],
  pinnedPayments?: { [cardId: string]: Record<number, number> },
) => simulateVariablePayoff(
  /* same 19 args as today's resimulateWithDebtCash, keeping the existing
     PASS-2-cap comment */, forecastMaxDebtPaymentByMonth ?? activeSimMaxDebt,
  augmentedCashFloorByMonth, ccMinInFloorByMonth, installmentChargeByMonth,
  upfrontPayByMonth, target, pinnedPayments,
);

const makeResimulate = (pinnedPayments?: { [cardId: string]: Record<number, number> }) => {
  const resim = (target: number[], forecastMaxDebtPaymentByMonth?: number[]): CardProjectionResult => {
    const simT = replayActiveSim(target, forecastMaxDebtPaymentByMonth, pinnedPayments);
    const resimFields = buildResimOverrides(simT, { cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth });
    return { ...hookResult, ...resimFields, resimulateWithDebtCash: resim };
  };
  return resim;
};
const resimulateWithDebtCash = makeResimulate();

const withPaymentOverrides = (pinnedPayments: { [cardId: string]: Record<number, number> }): CardProjectionResult => {
  const simP = replayActiveSim(undefined, undefined, pinnedPayments);
  const resimFields = buildResimOverrides(simP, { cards, cardPurchasesPerMonth, now, saveUpMonths, maxDebtPaymentByMonth });
  return { ...hookResult, ...resimFields, resimulateWithDebtCash: makeResimulate(pinnedPayments), withPaymentOverrides };
};
```
(rename the current local `overrides` from buildResimOverrides to `resimFields` to avoid
clashing) and add `withPaymentOverrides,` to `hookResult` (~line 1818).

### Step 3 — CreditCardEngine.tsx
- Imports: `useCardProjectionContext` from '@/contexts/CardProjectionContext',
  `runDebtCashConvergence` from '@/lib/forecast-convergence'.
- In component: `const { forecastInputsBundle } = useCardProjectionContext();`
- Replace the `overrideSim` memo (754-763) with `overrideData`:
```ts
const overrideData = useMemo(() => {
  if (Object.keys(overrides).length === 0) return null;
  const rawBase = forecastInputsBundle.engineInputs.cardProjectionData;
  if (rawBase?.withPaymentOverrides) {
    const converged = runDebtCashConvergence(
      rawBase.withPaymentOverrides(overrides), forecastInputsBundle.engineInputs,
    ).cardProjection;
    return {
      paymentsById: new Map<string, number[]>(converged.perCardPayments.map(p => [p.id, p.payments] as const)),
      monthlyRevolvingBalances: converged.monthlyRevolvingBalances,
      monthlyCyclingOwed: converged.monthlyCyclingOwed,
      monthlyCyclingInterest: converged.monthlyCyclingInterest,
      monthlyBalances: converged.monthlyBalances,
      monthlyInterest: converged.monthlyInterest,
    };
  }
  // Fallback (context has no projection — no cards / projection error): legacy single-pass.
  const sim = variableSim.runSim(overrides);
  return { paymentsById: sim.monthlyPayments, monthlyRevolvingBalances: sim.monthlyRevolvingBalances,
    monthlyCyclingOwed: sim.monthlyCyclingOwed, monthlyCyclingInterest: sim.monthlyCyclingInterest,
    monthlyBalances: sim.monthlyBalances, monthlyInterest: sim.monthlyInterest };
}, [overrides, forecastInputsBundle.engineInputs, variableSim]);
```
- Consumers: lines 908-916 use `overrideData.paymentsById.get(c.id) ?? []` + the maps;
  line 972 `(overrideData?.monthlyRevolvingBalances ?? …)`; line 973
  `overrideData ? 0 : …`; dep arrays at 944 and 983 swap overrideSim→overrideData.
  Update comments at 725-726, 754-759, 904-907 (convergence-based now; runSim stays for the
  fallback). runDebtCashConvergence's exhaustion fallback returns the pinned single-pass
  base — zero-regression guard, no extra handling needed.
- NOT extending convergence's `pinnedMonths` (manualIsbPins NaN-target exclusion) to
  user-pinned months: a user pin fixes ONE card, others still need target feedback. If a
  fully-pinned month ever oscillates, the base fallback covers it. Deliberate.

### Step 4 — new test `src/lib/__tests__/forecast-convergence.pinnedOverride.test.ts`
Clone the harness from forecast-convergence.realData.test.ts verbatim (fixture revive, fake
Date, renderHook(useCardProjection), paymentPlans fallback). Then:
1. `const unpinned = runDebtCashConvergence(base, inputs)`; from its `.cardProjection`, find
   the first card+month m in 1..12 with start-of-month revolving balance > 500 (from
   `monthlyRevolvingBalances[m-1]`) and `payments[m] >= (perCardMinPayments.get(id)[m] ?? 0) + 50`.
2. `pin = payments[m] - 25`; `pinnedBase = base.withPaymentOverrides!({ [id]: { [m]: pin } })`.
3. `out = runDebtCashConvergence(pinnedBase, inputs)`; assert `out.converged === true` and
   converged pinned card's payment at m is within $1 of pin (pin sits strictly between min
   and available cash, so no clamp) — this proves the pin survived every resim pass.
Self-skip when fixture absent (same maybeIt pattern).

### Step 5 — verify
- Full suite via Bash (failures land on STDERR → `npx vitest run 2>&1`); expect 212+new green.
  Goldens should be UNTOUCHED (no behavior change when no pins).
- Live verify on localhost:8080 /debt (Tre's session, tab may be open): pin a month (e.g. PV
  Aug 2026 → $100), confirm pinned AND unpinned rows shift to converged basis and reconcile,
  clamp note still renders, Revert All restores.
- Commit locally `[debt]: Anomaly B — converge pinned-override projections …`; no push.

## Gotchas (carry forward)
- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push unless asked.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- otherAccountExpense suite runs on the REAL clock — assertions must stay cumulative/clock-robust.
- Payoff pins are Jul 2027 everywhere (incl. goldenTierA). Fixture has native paymentPlans
  (recaptured 07-20); harness loadRealPaymentPlans() fallback is dormant.
- manualISB test titles say "(2026-07-15)" — cosmetically stale, clock derives from capturedAt.
- perCardPayments are ROUNDED ints; Anomaly A clamp-note threshold is 0.5 — fine with ±$1 test tolerance.

## Also queued (unchanged)
- Optional hardening (discuss first): sim/engine cash-walk divergence warning; Step-5 drain
  clamp for ISB-pinned months (pinned months get NaN targets BY DESIGN, forecast-convergence.ts:61-66).
- Stages 4-5 on hold.
