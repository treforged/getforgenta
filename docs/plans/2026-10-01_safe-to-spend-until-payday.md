# Safe to spend until payday - design (ask 23fe1862) - 2026-10-01, Ada

## Why
Tre approved the App Store listing "Safe to Spend & Payoff Date" (decision 69c9bdc0) and the promo
text "what is safe to spend before payday". The app shows NO figure by that name: it shows "Safe to
Pay" (what can go to cards this month). Sam (2026-10-01): build the real figure, so the app honours
what Tre chose. Then switch the welcome headline and Example card (Auth.tsx, fff69abb) to
"safe to spend", with /demo figures read back on build day.

## Definition
**Safe to spend until payday = the LOWEST projected cash-account balance from today up to (and
including) the next paycheck day, before that paycheck lands, minus the cash floor. Never below 0.**

The low point, not the end point: a bill due on day 3 must be covered on day 3, even if an
income on day 5 refills the account later. An end-point formula would let a user spend money a
bill needs first.

## Inputs, and the trap to avoid
- **Do NOT build from the transaction-merge helpers** (`getRemainingTransaction*ByDay`). Dashboard.tsx
  says why (Finding §1.1): that merge omitted savings goals, the car down-payment reserve, car loans,
  insurance, mortgage and transfers, and read $3,487 above Forecast's END CASH. It survives only as a
  fallback. A payday figure built on it repeats that overstatement.
- The canonical cash chain is the engine's `month0` (`useCardProjection` -> `Month0Result`, see
  `src/lib/debt-model-types.ts`). It is MONTH-scoped. The new work is a DATED version of the same
  outflows: every item month0 subtracts, carried with its date, so the walk can stop at payday.
- Next paycheck: `getNextPaycheckDate(payConfig)` (pay-schedule.ts:269). Its window must wrap into
  next month correctly when payday is early next month.
- Floor: `resolveCashFloor(profile)` for a manual floor. In AUTO mode the floor IS committed
  outflows (`auto-cash-floor.ts`). Those outflows are already in the dated walk, so subtracting them
  again double-reserves. Decide this explicitly and test it.
- Paid already: use the same settled/confirmed-occurrence handling month0 uses (sync cutoff +
  `confirmedOccurrences`), so a bill paid early is not reserved again.
- Card-charged purchases do not reduce cash. Only cash-account outflows count (funding sources).

## Conventions already decided
- **Bills due ON payday are reserved** (`getNextMonthPrePaycheckCutoff`: "Include bills due ON the
  first paycheck day"). Keep it, so this figure agrees with the floor shown beside it. Tre's
  "save the user the most money" rule breaks ties between correct answers. It does not override
  an existing convention that keeps two figures on one screen consistent.
- The paycheck ON payday is NOT counted (the figure is what is safe BEFORE it lands).
- Scheduled non-paycheck income before payday IS counted at its date (the low-point walk already
  stops it from covering a bill that comes first).

## Empty state, never a guess
Show no figure, and say what is missing, when: there is no funding/cash account; no pay schedule or
income (weekly_gross_income 0 and no income rule); or the engine returned no month0. A new account
must show the empty state. Sam's gate requires that.

## Where it shows
Dashboard (Overview), beside Safe to Pay / Month-End Cash in the Monthly Snapshot hero, labelled
"Safe to spend until payday (<date>)". A tooltip walks the arithmetic, as Safe to Pay's does.

## Gate
- Pure helper `src/lib/safe-to-spend.ts` + `__tests__/safe-to-spend.test.ts`: low point before an
  income refill; payday next month (wrap); bill on payday reserved; paid bill not reserved;
  card-charged purchase ignored; auto floor not double-counted; empty-state cases return null.
  Each asserts a NUMBER. Prove red by mutation.
- `npm run test:tz` (3 time zones; a date bug here is a money bug).
- `walk:empty` on a fresh @forgenta.test account: no safe-to-spend figure, the empty state shows.
- Reconciliation: on Tre's account, today's figure <= month0.endCash-based cash minus floor when
  payday is after month end (a low point can never exceed the end point).
- Then the welcome copy change, `check:welcome` updated, /demo figures read back.
