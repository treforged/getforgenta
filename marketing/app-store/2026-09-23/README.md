# App Store raw captures, 2026-09-23

Raw material for Ruby's screenshot set (ask 781edc28). **These are unframed captures and have not been uploaded anywhere.** Ruby does the framing and captions. Nobody uploads without Tre.

## Provenance (DEMO-FIXTURE-SPEC §4)

- **Fixture:** `src/lib/demo-data.ts` at commit `cd7e1ea2` (the persona re-tune that makes the cards clear), plus the copy fixes in `5dc058a0` and `a9d54b07`. The frames were captured from a tree at `a9d54b07`.
- **Source:** `/demo` on the local dev server (Vite), wall clock 2026-09-23. demo-data.ts computes its dates from the day it loads, so a capture on another day shows other dates.
- **Viewport:** 430x932 CSS px at device scale 3, so each PNG is **1290x2796** (the iPhone 6.7"/6.9" App Store size). **Dark** theme.
- **Cookie banner:** rejected before the first frame, so the capture fired no analytics. No frame shows the banner.
- **DEMO chrome is kept** (the top "DEMO / Sample profile / Sign Up Free" bar). Every frame is an unaltered render. Hiding the bar would take DOM edits that the shipped app does not have. Crop it in framing if you want it gone.

## Frames

| File | Screen | What it shows |
|---|---|---|
| `01-dashboard.png` | Dashboard, Overview | Net worth $12,618; "CREDIT CARDS PAID OFF May 2028, 1 yr 8 mo away" |
| `02-debt.png` | Debt Payoff | Avalanche guide card, Credit Card Payoff / Auto Loans tabs |
| `03-decisions.png` | Transactions, Decision Deck | "Marketway Foods -$118 - Is this your Groceries?" (1 of 78) |
| `04-forecast.png` | Transactions, Forecast tab | "NEXT MILESTONE May 2028 - CC Debt Free!" |
| `05-plan.png` | Transactions, Plan tab | Recurring-rules guide card |
| `06-accounts.png` | Dashboard, Accounts | Net worth tiles, then the accounts guide card |
| `07-goals.png` | Dashboard, Goals | Net worth tiles, Add Goal, the goals guide card |
| `08-garage.png` | Garage, Vehicles | 2024 Honda Civic (saving), Toyota RAV4 (owned, loan) |

Strongest in Ada's view: 01, 04 and 03. They carry a date and a decision, the things this app does that a spreadsheet does not. 06 and 07 are mostly guide-card text above the fold.

## Limits

- Every figure is what the engine computed on 2026-09-23. A later fixture change can move it. Read the figures back off the PNG before you caption.
- `demo-marketing-lines.engine.test.ts` does NOT agree with these frames. Its harness leaves out car funds, goals and debts, so it says the cards clear in "Dec 2026". The app says May 2028 (ask 16147de8).
- Light mode, phone sizes other than 6.7"/6.9", and iPad are not captured.
