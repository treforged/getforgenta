# Plan: fix silent debt write-off in projectCardVariable's isCycling branch

## Task Type
- [x] Backend / financial-calculation engine (single-model analysis — ace-tool MCP and the
      codeagent-wrapper Codex/Gemini infrastructure this skill normally calls are not present
      on this machine; this plan was produced by Claude directly via Read/Grep context
      retrieval, per the skill's documented fallback path)
- [ ] Frontend
- [ ] Fullstack

## Confirmed root cause

`projectCardVariable` (`src/lib/credit-card-engine.ts:267-411`) is the single shared engine
behind all three balance/payoff-table consumers in the app. Once a card's `isCycling` flag
flips true for a month, the function does this unconditionally:

```ts
if (isCycling) {
  if (payoffMonth === null) payoffMonth = m;
  const cyclingPayment = Math.round((monthlyPayments[m - 1] ?? 0) * 100) / 100;
  const cycleStartBal = Math.round(startBal * 100) / 100;
  const endBal = Math.round(newPurchases * 100) / 100;   // <-- BUG: ignores cyclingPayment entirely
  ...
  bal = endBal;
  legacyBal = 0;
  continue;
}
```

`endBal` is hard-coded to `newPurchases`, on the assumption that "cycling" always means the
card pays last cycle's full statement balance (`startBal`) in full, so only this month's new
purchases roll forward. That assumption holds only when `cyclingPayment >= startBal`. When the
supplied payment is smaller (a scaled/capped recommended payment from the cash-floor-protected
series), the unpaid remainder (`startBal - cyclingPayment`) is silently discarded instead of
carried forward — this is the exact bug the user reported and pasted live numbers for:

- Jan 2027 row: `startBal = $4,737`, `newPurchases = $892`, displayed payment `$939`.
  Real obligation after that payment: `4,737 + 892 - 939 = $4,690`.
  Displayed/stored `endBal`: `$892` (= `newPurchases` only) — **~$4,690 of real debt erased.**

This reproduces on **every** card/path that flows through `projectCardVariable`'s cycling
branch, not just the one screen the user saw it on. Confirmed call sites, all sharing this one
function:

| Consumer | Call site | `revolvingBalances` passed? |
|---|---|---|
| `src/components/debt/CreditCardEngine.tsx` (confirmed source of the user's screenshot) | line 812 | yes — ground-truth path |
| `src/hooks/useCardProjection.ts` (Forecast/Debt-Payoff balance table, already touched by the prior fix) | line 1108 | yes — ground-truth path |
| `src/lib/debt-transaction-generator.ts` (transaction-history generation) | lines 203, 210 | no — falls back to `bal <= 0 \|\| payoffMonth !== null` |

Because all three go through the same function, **one fix in `projectCardVariable` fixes all
three** — no changes needed in the three call sites themselves (beyond one stale comment, see
below).

## The fix

Change the `endBal` computation inside the `isCycling` branch from:

```ts
const endBal = Math.round(newPurchases * 100) / 100;
```

to:

```ts
const endBal = Math.round((Math.max(0, startBal - cyclingPayment) + newPurchases) * 100) / 100;
```

This nets `cyclingPayment` against `startBal` (last cycle's statement balance) first, carries
any shortfall forward, then adds this month's new purchases on top (matching the existing
"purchases bill next cycle" comment/intent). It is a strict generalization of the current
formula:

- **Steady-state / correct case** (`cyclingPayment >= startBal`, i.e. paid in full): shortfall
  term is `0`, so `endBal = newPurchases` — **identical to current behavior, zero regression
  risk for the already-working case.**
- **Underpayment case** (`cyclingPayment < startBal`): shortfall carries forward instead of
  being erased. Verified against the user's exact numbers: `max(0, 4737 - 939) + 892 = 4,690`
  — matches the real obligation, not the erased `$892`.

`utilization` (computed from `endBal`) is automatically corrected too — the user's reported
"7.4% utilization" was an artifact of the same bug; it will now reflect the true carried
balance.

No change to `isCycling`'s trigger condition, `legacyBal` reset, or the `interest: 0` while
cycling — those are untouched, so the existing test suite's assumptions about *when* a card
enters cycling mode are preserved exactly. This keeps the change to one line plus its
surrounding comment, minimizing blast radius across the three consumers and avoiding any
re-litigation of the floor-protection / scaling logic from the prior fix.

### Known, deliberately out-of-scope follow-up

Once a card is flagged `isCycling`, this branch always charges `interest: 0`, even in the new
carried-shortfall case. Real-world issuers typically revoke the interest-free grace period when
a statement isn't paid in full. Whether to reintroduce interest accrual on a carried cycling
shortfall is a product decision, not a bug fix — it changes behavior beyond what's currently
modeled anywhere in this codebase and isn't what the user reported (they reported the balance
being erased, not missing interest). Flagging it here rather than deciding it unilaterally;
can be a separate follow-up if the user wants stricter modeling.

### Secondary cleanup (comment-only, no behavior change)

`src/components/debt/CreditCardEngine.tsx:794` has a stale comment:
```
// Months 1-35: use unscaled sim amounts so the payoff trajectory reflects what the
// simulation actually pays
```
The actual code three lines below (`forecastPays = perCardPaymentsScaled ?? perCardPayments`)
prefers the **scaled** amounts, not unscaled — this comment is left over from before that
logic changed and contradicts the code it documents. Will update the comment to describe
actual behavior. No code/behavior change.

## Implementation Steps

1. Back up `src/lib/credit-card-engine.ts` and `src/components/debt/CreditCardEngine.tsx` to
   `./backups/<timestamp>/` per CLAUDE.md backup policy.
2. Apply the one-line `endBal` fix in `projectCardVariable` (credit-card-engine.ts:371) plus an
   updated inline comment explaining the shortfall-carry behavior.
3. Fix the stale comment in `CreditCardEngine.tsx:793-796`.
4. Extend `src/hooks/__tests__/cyclingDropDiagnostic.test.ts` (kept per your instruction) with
   an assertion reproducing this exact scenario — a card whose ground-truth revolving balance
   hits $0 while the supplied payment for that same month is smaller than the prior statement
   balance — asserting `endBalance` carries the shortfall instead of dropping to `newPurchases`.
5. Run the full test suite:
   - `cyclingDropDiagnostic.test.ts` — must pass with the new assertion.
   - `useCardProjection.cyclingMisclassification.test.ts` — must remain at its known
     pre-existing failure state, not worsen (re-confirm identical failure mode).
   - `useCardProjection.cyclingBalanceDisplay.test.ts` — must continue passing (it exercises
     the same branch's purchases-fallback logic, unrelated to the part being changed).
   - Full `npx vitest run` — confirm no new regressions elsewhere (ignoring the known stray
     `backups/2026-06-17_010000/...cyclingFloor.test.ts` import-resolution failure, which is
     pre-existing backup-folder test-glob pollution unrelated to this change).
6. `npx tsc --noEmit` to confirm no type errors.
7. Commit locally (`[debt]: ...` scope), including the backup folder, the modified files, the
   extended diagnostic test, and this plan file. Do not push.
8. Report back to the user with before/after numbers for their specific Dec 2026/Jan 2027
   Prime Visa example, and note the diagnostic test is still being kept pending their
   confirmation the issue is cleared.

## Key Files

| File | Operation | Description |
|---|---|---|
| `src/lib/credit-card-engine.ts:367-380` | Modify | Fix `endBal` computation in `isCycling` branch to carry forward payment shortfall instead of discarding it |
| `src/components/debt/CreditCardEngine.tsx:793-796` | Modify | Fix stale comment (no behavior change) |
| `src/hooks/__tests__/cyclingDropDiagnostic.test.ts` | Modify | Add assertion for the underpaid-cycling-transition scenario |

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Changing `endBal` shifts downstream months' `startBal`, possibly changing `payoffMonth` or total-interest figures for cards that previously (incorrectly) looked paid off sooner | Steady-state/correctly-paid cards are mathematically unaffected (shortfall term is 0); only cards that were actually underpaid during their transition month — i.e. exactly the cards exhibiting the reported bug — will show different (more accurate, higher) balances going forward. This is the intended, correct change. |
| `debt-transaction-generator.ts`'s two call sites don't pass `revolvingBalances`, so their `isCycling` gate is purely local (`bal <= 0 \|\| payoffMonth !== null`) — could behave slightly differently than the ground-truth-gated consumers | The `endBal` fix applies identically regardless of which gate path triggered `isCycling`; not gate-dependent. No special-casing needed. |
| Test suite has a pre-existing unrelated failure (`cyclingMisclassification`) and a pre-existing unrelated stray-backup-folder import failure | Both already documented; step 5 explicitly checks neither is made worse, rather than expecting a fully green suite. |
| Interest-resumption-on-underpayment is left unmodeled | Explicitly flagged as a deliberate, scoped-out follow-up rather than silently decided either way. |

## SESSION_ID
- CODEX_SESSION: n/a (external model infrastructure unavailable on this machine)
- GEMINI_SESSION: n/a (external model infrastructure unavailable on this machine)
