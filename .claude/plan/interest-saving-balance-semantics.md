# Q5 — Manual interest-saving balance semantics fix

Date: 2026-07-14. Ruled by Tre (authoritative, see handoff.md "NEW TOP PRIORITY — Q5").

## Problem

`accounts.statement_balance` (the manual "Interest-saving balance" entered via the Q3 UI
control) is consumed by `buildCardData` as a REPLACEMENT for the card's balance
(`simBalance = statementBalance ?? balance`, credit-card-engine.ts:240). Entering Prime
Visa's real ISB ($1,164.79) made the whole app treat $1,165 as the card's entire balance:
header balance, utilization (8.1%), total CC debt ($14,453 → $9,614), and the payoff sim
all wrong.

## Correct semantics (Tre's ruling)

- Card balance stays the real balance (PV: $6,004) everywhere — display, utilization, sim walk.
- `statement_balance` = the amount due at the card's NEXT due date only (the current
  statement). Paying it keeps the card interest-free.
- Expected sim: PV due day = 7, today = Jul 14 → July payment $0 (statement already paid
  this cycle); August pays exactly $1,164.79; Discover's August payment pulls back as needed
  to fund it; cash floor holds.
- DB value 1164.79 is correct — fix the interpretation, not the data.

## Design

Model the manual ISB as a **synthetic payment pin** inside `simulateVariablePayoff`,
reusing the Q1 override-rebalance machinery (pool deduction → other cards rebalance;
exact payment; exempt from min-guard; reservedForRevolving carries the pinned share so
the Step-2 cycling pool shrinks → Discover pulls back):

- `dueMonth = (dueDay != null && dueDay >= today's day) ? 0 : 1`
- months `< dueMonth`: synthetic pin `0` (statement already paid this cycle)
- month `== dueMonth`: synthetic pin `= statementBalance` (clamped at owed by the existing
  pin clamp)
- months `> dueMonth`: no pin — normal statement-preference behavior resumes (the unbilled
  remainder becomes the next statement; cascade targets startBal+interest as before)
- A user override (paymentOverridesByMonth) on the same card/month wins over the synthetic pin.

Grace rules (a manual ISB implies the card is in grace):
- grace inits (projectCard :269, projectCardVariable :391, graceMap :831) also true when
  `statementBalance != null`
- grace update (Step 6 :1527): `m < dueMonth` → grace persists unconditionally;
  `m == dueMonth` → grace persists iff `pay >= statementBalance`; else existing full-statement rule.

`buildCardData`: stop substituting the balance; `autopayFullBalance = balance <= 0`.

`generateRecommendations` (current-month Dashboard/month-0 recs): a manual-ISB card's
this-month obligation = $0 if due day passed, else exactly the ISB; no extra-cascade cash;
totalMinDue uses `min(minPayment, obligation)`.

No UI change needed: CreditCardEngine.tsx only displays `card.statementBalance` (badge) and
`card.balance` (header) — both correct after the mapping fix. Forecast consumes the hook's
sim outputs (`cardProjectionData`), so both pipelines are fixed at the engine layer.

## Files

- `src/lib/credit-card-engine.ts` — all changes (mapping, grace inits, synthetic pins,
  grace update, recommendations)
- `src/lib/__tests__/credit-card-engine.manualStatementBalance.test.ts` — new acceptance tests

## Acceptance tests (fake clock mid-month, due day earlier)

1. Month 0 payment $0; month 1 payment exactly the ISB.
2. Tight cash: competing cycling card's month-1 payment pulls back vs no-ISB baseline; no
   floor breach.
3. Grace holds: no interest charged through and after the ISB month when it's paid in full.
4. Due day >= today → ISB paid in month 0.
5. User override beats the synthetic pin.
6. `buildCardData` keeps the real balance; no-ISB behavior byte-identical (regression).
