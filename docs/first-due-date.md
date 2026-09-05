# A card's FIRST due date — scoped, not started

Tre, 2026-09-05: *"maybe make it a feature for cards to set there first due date."*

His Robinhood Gold card is open now and its **first payment is due Oct 10**, which is not the
same thing as "due on the 10th of every month". Today `accounts.payment_due_day` is the only
field, and it is a day-of-month that assumes a steady state the first cycle does not have.

---

## 1. `card_start_date` is NOT the right field. Checked, not assumed.

It was the obvious candidate and it is a different concept. `src/lib/card-start-date.ts` says
so plainly: `card_start_date` is when a card **opens**, and a card with a future one is *"one
the user has planned but not yet opened. Its credit limit is not available credit, so it must
not count toward utilization."*

Tre's Robinhood card is **already open**. Its limit is real credit today. Deriving a first due
date from `card_start_date` would either mean back-dating the open date — which would wrongly
remove a live limit from utilisation — or overloading one column with two meanings. Neither is
acceptable on a money path.

**So this needs a new nullable column, and that conclusion is the answer to "check before
adding one".**

## 2. The shape

```sql
alter table public.accounts
  add column if not exists first_due_date date;
```

Nullable, and **null must be byte-identical to today's behaviour** — the same standard the cash
floor buffer was held to. Almost every card in existence has no first-cycle exception, and a
feature that moves when a payment lands for everyone on the day it ships cannot ship.

The rule, in one sentence: **a card's due date in month *m* is `first_due_date` when that date
falls in month *m* and no due date has yet passed; otherwise it is `dueDateInMonth(m,
payment_due_day)` exactly as now.**

## 3. ⚠️ The surface is WIDE. This is the part to plan for.

`payment_due_day` / `dueDay` / `dueDateInMonth` appear across **199 references** in `src/lib`
and `src/hooks` alone. The ones that actually decide when money moves:

| Site | What it decides |
| --- | --- |
| `sync-cutoff.ts:149` `dueDateInMonth` | the primitive every other site calls |
| `credit-card-engine.ts:381` | whether a month-0 minimum is already captured in the balance |
| `pay-schedule.ts:937` | the same gate inside the augmented cash floor |
| `forecast-engine.ts:715, :779` | car loan and insurance due dates |
| `transaction-matching.ts:183` | the clamped due date a payment is matched against |
| `next-card-payment.ts` | the "next payment" a user actually reads |

**DO NOT change `dueDateInMonth` itself.** It is a pure month-key-plus-day primitive shared by
car loans and insurance, which have no first-cycle concept. The right shape is a new resolver —
`cardDueDateInMonth(card, monthKey, now)` — that consults `first_due_date` and falls back to the
primitive, and only the CARD sites move to it.

## 4. How it must be proven

Money-adjacent. `npm run test:tz` in all three zones, and assert NUMBERS.

1. **The no-op first.** With `first_due_date` null, every due date, every floor figure and every
   payoff month is unchanged. Assert it against the demo fixture, not by reasoning.
2. **The first cycle lands on the stated date.** A card with `payment_due_day: 12` and
   `first_due_date: 2026-10-10` is due on the **10th** in October and the **12th** in November.
3. **It must not resurrect a past date.** A `first_due_date` already behind us is spent; the
   card falls back to the recurring day. Otherwise a stale value pins a payment in the past
   forever.
4. **The floor and the matcher must agree.** `pay-schedule.ts:937` and
   `credit-card-engine.ts:381` gate on the same date. If one moves and the other does not, the
   plan reserves against one line and is judged against another — which is precisely the
   asymmetry `auto-cash-floor.ts` was written to remove.
5. **Local dates only.** `toLocalDateStr`, never `toISOString().slice(...)` — there is now an
   eslint rule that fires on the latter.

## 5. What is decided and what is not

**Decided:** a new nullable `accounts.first_due_date`; null is a strict no-op; `dueDateInMonth`
stays untouched and a card-specific resolver wraps it.

**Not decided, and worth one question to Tre when the slice starts:** whether the field should
also accept a first due date in the PAST for a card added late, so the app can say "your first
payment was on the 10th" rather than silently treating it as the recurring day. Cheap to
support, and it changes nothing if he does not want it.
