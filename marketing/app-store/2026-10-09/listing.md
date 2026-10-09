# Store listing text - 2026-10-09 (Tre pastes it himself)

The App Store and Google Play text, kept in the repo so the next pass can diff it against what
shipped. **Nothing here was submitted.** Character counts measured by script. Approved basis:
growth pass (docs/growth-pass-2026-10.md on claude/growth-pass-10-09) and the landing headline Tre
approved 10-09 ("Know what's safe to spend before payday, and the day you're debt-free.").

⚠️ **Rules for every field below:** no prices (the stores show them), no mention of the web app or
web pricing (App Review 3.1.1), no competitor names (2.3.7), and nothing the app does not do today.
Quick add is Premium in the native app (decision 10-09); the text names it without calling it free.

## App Store (App Store Connect > Forgenta > App Information / version page)

| Field | Limit | Text | Length | When it can change |
| --- | --- | --- | --- | --- |
| Name | 30 | `Forgenta: Budget Planner` | 24 | with a version submit (already set on 6.8.2 by `scripts/asc-aso-metadata.mjs`) |
| Subtitle | 30 | `Safe to Spend & Payoff Date` | 27 | keep (decision 69c9bdc0) |
| Promotional text | 170 | Know what's safe to spend before payday and the month your cards hit zero. Save for your next car, or pay one off, on the same plan. | 132 | **any time**, no submit |
| Keywords | 100 | `budgeting,paycheck,payday,bills,tracker,debt,forecast,expense,money,cash,calendar,savings,simple` | 96 | with a version submit (set on 6.8.2) |
| Description | 4000 | below | 1691 | with a version submit |

No word repeats across name, subtitle and keywords (Apple combines them; checked by script).

### Description
```
Know what's safe to spend before payday, and the day you're debt-free.

Forgenta takes your paychecks, your bills and your cards and answers the two questions that matter: how much can I spend before my next paycheck without missing a bill, and what month will my credit cards hit zero?

SAFE TO SPEND UNTIL PAYDAY
One number, checked through your next paycheck, after every bill due before it. Tap it to see exactly how it was worked out.

YOUR DEBT-FREE DATE
Forgenta ranks your cards by what each one actually costs you and tells you what to send each one this month, after every minimum is covered. See how many months sooner you finish if you pay a little more.

YOUR CAR, ON THE SAME PLAN
Saving for a car? Forgenta sets the down payment aside each month toward the date you plan to buy. Paying one off? See the month the loan hits zero, and how much sooner an extra payment gets you there. A Garage keeps every car, its build and its service log.

QUICK ADD
Tap the gold + and log a purchase in five taps: amount, category, done. Your last category and account are remembered.

A PLAN THAT LOOKS 60 MONTHS AHEAD
Enter your paycheck and the bills that repeat once. Forgenta projects your cash, debt and net worth five years out, and warns you before a month runs short.

CONNECT YOUR BANK, OR DON'T
Your first bank connection is free. Or add every account by hand: cash, investments, a loan from a friend.

GOALS AND PARTNERS
Savings goals on the same timeline as your debt. Share a budget with a partner.

NO ADS. EVER.
Your data is never sold.

Forgenta is free to start. Premium adds daily bank sync, more linked accounts, CSV and PDF exports, and unlimited goals and debt trackers.
```

## Google Play (Play Console > Grow > Store presence > Main store listing)

| Field | Limit | Text | Length |
| --- | --- | --- | --- |
| App name | 30 | `Forgenta: Budget Planner` | 24 |
| Short description | 80 | Know what's safe to spend before payday, and the day you're debt-free. | 70 |
| Full description | 4000 | the App Store description above | 1691 |

Play listing edits need no app release.

## What's New
Generated from `Release-Note:` trailers (`scripts/release-notes.mjs`): Android publishes it, iOS is pasted
from the run summary. Do not hand-write it here.

## Screenshots
Re-shoot brief for three slots: `README.md` in this folder; drop-in JSON for Ruby: `appstore-shots.json`.
