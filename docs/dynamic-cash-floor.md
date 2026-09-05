# The dynamic cash floor — the decision, and what is already built

Tre, 2026-09-05, verbatim, because a paraphrase loses the third requirement:

> "the floor should always strive to be exactly enough to pay all bill on automatic mode.
> however with everything, especially variable items, it should actually be adjusted,
> including throughout the month as bills pass and some come out to more, or even if less
> than planned. but for variable items, the cash floor should calculate an extra buffer
> based on historical payments. ex. my electric bill for this month was like 190, but i
> planned for much less"

That is three separable requirements. They are three slices, not one, and **the first is
already built** — start from that, not from a rewrite.

---

## 1. "Exactly enough to pay all bills" — ALREADY BUILT. Do not rebuild it.

`resolveCashFloor` returning **0** in automatic mode is not "no floor", and it is not the
opposite of this requirement. It is a sentinel: `getMinSafeCash` takes
`max(cashFloor, prePaycheckBills)`, so 0 means "contribute nothing of your own and let the
measured bills decide". Read the header of `src/lib/cash-floor.ts` before touching it. That
0 has now been misread as a missing floor twice.

The floor actually in force is `getAugmentedMinSafeCash` (`src/lib/pay-schedule.ts:855`),
computed **per month** from the user's own rows:

    bills due before the next paycheck + credit-card minimums + car loan + car insurance

`src/lib/auto-cash-floor.ts` records that the bills-only version WAS shipped, was caught live
on 2026-08-21 projecting cash negative in Apr 2028, and was fixed. Do not reintroduce it.

**Verdict: requirement 1 is satisfied.** If it is reopened, the argument has to be about
which OBLIGATIONS belong in the floor, not about the 0.

## 2. Intra-month adjustment — HALF built, and the built half only moves the floor DOWN.

**Down, as bills clear: BUILT.** `dueSynced` inside `getAugmentedMinSafeCash` drops a month-0
obligation from the floor once `isCapturedInBalance` says the bank already reflects it. A paid
bill stops being reserved.

**Up, when a bill comes in OVER plan: NOT BUILT. This is the gap.** Every floor item is
reserved at the RULE'S PLANNED AMOUNT. A rule that says $120 keeps reserving $120 even after a
$190 charge has landed. The floor never learns from what actually happened.

**The slice:** when an occurrence has a matched actual, reserve `max(planned, actual)` for that
occurrence instead of `planned`. The under case is already handled by `dueSynced` — a cleared
bill leaves the floor entirely, whatever it cost — so only the over direction is missing.
Matching is `src/lib/transaction-matching.ts`, the same evidence path `sync-cutoff.ts` uses.

⚠️ **There is no `rule_id` on `transactions` or on `synced_transactions`.** The rule-to-payment
link is computed at read time and never stored. Design around that; do not add a column for it
in this slice.

## 3. A buffer for variable items, from that item's own history — NOT BUILT.

This is the requirement with the money in it. The design is decided here so the build does not
re-argue it.

### What the data says — measured 2026-09-05 against the live database, read-only

798 synced transactions, 2026-01-17 to 2026-09-03 (about 7.5 months), 155 merchants. Grouped
by merchant and month, **18 merchants have 5 or more months of history**. Their spread, as the
percentage by which the worst month exceeded the mean:

| shape | count | example |
| --- | --- | --- |
| effectively fixed (sd under 1%) | 3 | $54.07 every month, sd $0.00 |
| genuinely variable | about 9 | mean $140.46, range $99.69-$197.93, sd $33.95, p90 $180.88 |
| not a bill at all | about 3 | mean $13,263, range $460-$21,785 |

**Three decisions fall straight out of that table.**

**(a) A flat percentage buffer is wrong in both directions at once.** It strands cash on the
three items whose standard deviation is zero, and it under-covers the ones that swing 40%. The
buffer must be per item, from that item's own history.

**(b) Use the 90th percentile of the item's own matched history, not mean + N-sigma.** The
sigma is inflated by exactly the rows that are not bills. For the item matching Tre's own
example — mean $140.46, max $197.93, against his "like 190" — p90 lands at $180.88: it covers
the overrun without reserving for the single worst month ever recorded. So:

    buffer = max(0, p90(matched history) - planned amount)

and the floor reserves `planned + buffer`.

**(c) The buffer applies ONLY to items already in the floor.** That is what keeps the $13,263
row out of it: the floor is built from the user's recurring RULES, so history is only ever read
for a rule that is already being reserved. Merchant-level grouping on its own produces
nonsense, and this constraint is what prevents it. Do not loosen it.

### The rules that make it safe

- **A minimum of 3 observations.** Below that there is no distribution, so the buffer is 0 and
  the UI says so rather than inventing one. With 7.5 months of data most items have 5-7 points,
  where p90 is close to "the max" — that is the safe direction for a floor, but say it plainly
  instead of presenting it as statistics it is not.
- **Do not trust `recurring_rules.cost_type`.** The column exists and is empty in practice: 430
  null, 3 `variable`, 2 `fixed`. DERIVE variability from the history (a coefficient-of-variation
  threshold) and let `cost_type` act as an override when a user has actually set it. Do not add
  a new column, and do not gate the feature on a field nobody fills in.
- **Every dollar of the floor stays traceable to a row the user entered.** That is the standing
  rule in `auto-cash-floor.ts` and this feature gets no exemption: the buffer traces to that
  item's own past payments, and the UI must be able to show them.

### Why this is the answer to the payoff-date question underneath it

Measured 2026-09-05 (`src/lib/__tests__/payment-pin-semantics.test.ts`): a per-card payment pin
cannot add cash to debt, because the plan already spends everything above the floor. **The floor
IS the control.** Too high and it strands money that could be retiring 27% debt; too low and a
real month breaches. Sizing it correctly is worth more than any pin, which is why the manual
"pay extra" field is **SUPERSEDED** — Tre does not want to type an extra payment, he wants the
floor to be right.

## ⚠️ How this must be verified

Money-adjacent, highest effort, adversarial verification.

- **The floor is what the converged engine protects by holding back debt payments.** Raising it
  moves every payoff date in the app; lowering it can breach a real month. Assert NUMBERS, not
  that a function was called.
- **Prove it on the DEMO FIXTURE, never on Tre's live account.** `runDemoCardProjection` and
  `runDemoForecastWithCards` in `src/lib/__tests__/fixtures/demo-forecast-harness.ts`.
- **`npm run test:tz` is the gate**, in all three zones. A single-timezone run has missed a live
  money bug here before.
- **Assert the no-op case first:** with no history, or fewer than 3 observations, the floor must
  be byte-identical to today's. A feature that moves every user's floor on day one is a feature
  that cannot be shipped.
