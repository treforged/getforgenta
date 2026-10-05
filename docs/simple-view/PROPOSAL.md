# Simple view + Advanced view - proposal (ask 7515c3fa, Ada, 2026-10-05)

Tre, 2026-10-05: *"a little too much detail that sometimes can make it a little overwhelming ...
organized somewhat simple but an advanced version or advanced view for the people who want it like
myself"*.

## What the other apps do (researched 2026-10-05)

| App | Default screen | Where detail goes |
| --- | --- | --- |
| **Copilot** | 6 blocks: spend-pace graph with one "Free to Spend" figure, To Review, trending budgets (a snapshot, not all), Upcoming recurrings, Net This Month (income vs spend). | Every block ends in a link ("Categories >", "Recurrings >", "Cash Flow >"). The full view is one tap away, never on the home screen. |
| **Monarch** | Card stack: budget, net worth, recurring, spending trend, transactions, investments. | User turns cards on/off and reorders them ("Customize"). Phone and web layouts are separate. |
| **Origin** | Net worth + assets first, then a small "Favorites" section (budget, latest transactions, top categories). Reviewers call it "not too busy". | Planning and forecasting live on their own tabs. |
| **Capital One / Chase** | Account tiles: balance, available credit, payment due. One personalised insight (monthly spend). | Statements, tools, credit score sit behind a tap on the tile or a menu. |

**The shared pattern:** the home screen answers 3-5 questions with ONE number each, and every
block links to its full view. Nobody shows the engine's working on the home screen.

## Measured: how much Forgenta shows now (390x844, walk account, `node scripts/measure-detail-load.mjs`)

| Screen | Cards | $ figures | Phone screens to scroll |
| --- | ---: | ---: | ---: |
| Dashboard (Overview) | 16 | 37 | 4.5 |
| Dashboard > Goals | 6 | 12 | 2.3 |
| Dashboard > Accounts | 11 | 20 | 3.1 |
| Transactions | 8 | 31 | 5.0 |
| Budget | 10 | 10 | 2.5 |
| Forecast | 17 | 31 | 3.0 |
| Debt Payoff | 8 | 26 | 3.5 |

Simple mock (`docs/simple-view/simple-mock.html`, `node scripts/render-simple-mock.mjs`):
Home 6 cards / 10 figures / 1.2 screens; Debt 4 / 6 / 0.8; Spending 3 / 11 / 0.9; Accounts 3 / 5 / 0.6.
Figures in the mock are the walk account's real ones except lines marked ILLUSTRATIVE.

## The design

- **One switch: Simple | Advanced.** A segmented control in each main screen's header, plus a
  "Show advanced detail" link at the foot of every Simple screen. Stored on the profile, so phone
  and web agree. Forecast's existing Summary/Detail toggle folds into it.
- **Nothing is deleted.** Advanced is today's app, unchanged. Simple only chooses what is on screen.
- **Defaults:** new accounts start in Simple. Existing accounts keep Advanced (no silent change to a
  screen somebody already uses); they get a one-time card offering Simple. Tre stays Advanced.
- **Every Simple block links to its Advanced home**, the Copilot rule.

## Screen-by-screen: what moves

| Screen | Simple keeps | Moves to Advanced only |
| --- | --- | --- |
| **Dashboard** | Safe to spend until payday + next paycheck; ONE alert (cash floor or update reminder - already one-at-a-time); Due this week (bills AND debt minimums in one list); This month in vs out; Debt total + payoff date; top goal. | Net-worth strip (5 figures); Monthly Budget Snapshot donut and its 8 lines; This Month's Budget 7 tiles; Debt Recommendations card (its total joins Due this week); Net Worth Trend chart; Customize/Guide buttons; Next Lesson line. |
| **Accounts** | Net worth; 4 group totals (Cash, Investments & retirement, Credit cards, Loans); update reminder. | Per-account rows and metadata, net-worth history, assets/liabilities breakdown. Group rows tap through to the accounts in them. |
| **Transactions** | Search + list. | Filter rows, bulk actions, split/match tools behind a "Filters" button. |
| **Budget** | Spent of planned (one bar); categories with one progress bar each. | Fixed / variable / transfers breakdowns, annual spend, rule editors. |
| **Forecast** | One line chart; lowest point and date; months below floor (count). | Monthly breakdown table, assumptions panel, per-row chips. |
| **Debt Payoff** | Total debt, debt-free date, interest this month; what to pay this month per card; strategy name with one line why; one "pay $X more, done by <date>" line from the engine. | Trajectory chart, utilization grid, strategy/payment-mode/cash-floor controls, pay-from, recommended-this-month breakdown, per-card engine panel, consolidation, Which Card?. |
| **Goals** | Each goal: name, bar, saved of target. | Contribution schedules, car-fund maths. |

## Build order (each a separate slice with its own gate)

1. `view_mode` on profiles + the switch + a test that pressing it changes what renders (both ways).
2. Dashboard Simple (the biggest win: 16 -> 6 cards). Gate: `measure-detail-load` reads fewer cards in
   Simple and the same count as today in Advanced.
3. Debt, then Accounts, then Budget/Forecast/Transactions.
4. `walk:press` and the contrast sweeps in BOTH modes.

**Not covered by this proposal:** desktop layout (the rail and the wider grid need their own pass),
and the "pay $X more" engine call, which does not exist as a single function yet.
