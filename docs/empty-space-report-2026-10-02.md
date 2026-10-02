# Empty-space report - 2026-10-02 (ask f20e814d)

Tre: *"I also want to know all the areas of like empty space where it just seems a little unnecessary."*

## How it was measured

`npm run inventory:spacing` at 390x844 (phone). Two arms:

- 11 routes signed in as the walk account
- 5 routes in `/demo`, which carries goals, auto and student loans that the walk account does not have

Two readings come from the rendered page, never from class names:

- **Empty bands** - the vertical stretches inside a card that no text, icon or control covers (over 16px).
- **Right-side space** - content grouped into rows. A row that stops 100px or more before the card's
  inner right edge is listed.

Each reading has a planted control on every route: a 120px band and a 176px right gap. Both were found.

| Measure | Result |
|---|---|
| Empty bands over 16px | 175 (102 walk, 73 demo) |
| Right-side rows of 100px or more | 159 |
| Distinct card paddings | 6, over 109 cards |
| Distinct gaps between cards | 16, over 93 gaps |

The walk arm read 102 bands, the same count as the run before this one, so the new arms did not move the old numbers.

## Worth fixing - largest first

| # | Where | What is empty | Proposed fix |
|---|---|---|---|
| 1 | `/forecast` Retirement & Investment Growth | 55px and 51px between the figures ($17,082 / Roth IRA, $8,441 / $25,523) | Tighten the stat grid gap. The figures are a group, so they should sit as one block. |
| 2 | `/dashboard` Monthly Budget Snapshot | 49px between "$25.00" and "Spent"; 36px under the chart | Put each label on the same row as its value. Cut the chart's bottom margin. |
| 3 | `/budget` Per Paycheck | 45px twice under "$0". Each figure row stops 297px short of the right edge. | Two tiles across instead of one per row. That removes the bands and the right space together. |
| 4 | `/debt` card tile (Discover It) | 42px at the card bottom. "Payment type", "Total Interest" and "Never pays off" stop 220-258px short. | Label on the left, value on the right, one row each. Remove the bottom padding stack. |
| 5 | `/dashboard` Debt - Recommended This Month | 41px and 40px between the payment rows and the total | Same row rhythm as the payment list (one gap token). |
| 6 | Goals: Where the extra money goes (demo) | 40px between every "Auto extra for ..." row and the next goal | Halve the gap between rows. Keep the gap between sections. |
| 7 | Net Worth card (every route it is on) | 38px between its two buttons | Put the buttons side by side, or use a smaller gap. |
| 8 | Savings goals guide (demo goals) | 38px between each explanation line and its arrow | Arrow inline at the end of the line. |
| 9 | `/dashboard` Goal Progress, empty state | 40px between the heading and "No savings goals yet." | Reduce the empty state to one line under the heading. |
| 10 | `/account` What people you follow back can see | 35px between each sharing row | Tighter row gap. Each switch already carries its own label. |
| 11 | `/settings` Support | 38px between "Upgrade" and "Report a Bug". Its rows stop 211-252px short. | A list with one row per action and a chevron on the right, like iOS Settings. |

Fixes already shipped from this work: goal card actions moved onto the amount row (-41px per card,
`npm run check:goal-card-row`).

## Not waste - left alone on purpose

- **Form labels above their input** (`/settings` Profile, `/budget` Pay Schedule: "Email", "Tax Rate (%)",
  "Paycheck Day"). These read as 216-275px of right space, but label-over-field is the standard phone
  form layout. Moving them beside the field would squeeze the input.
- **Card headings** ("Net Worth History", "Per Paycheck") stand alone on their row by design.

## Limits

- Phone width only. Desktop is not measured.
- Nothing behind a press (dialogs, menus, expanded panels).
- Space outside cards is not measured.
- This is a measurement. I have not looked at a rendered frame for each item, so check each proposed fix
  on screen before shipping it.
- The single-spacing-system work (6 paddings, 16 gaps) is ask 259f01ba and uses the same instrument.
