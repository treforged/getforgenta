# App Store raw captures, 2026-09-23

Raw material for Ruby's screenshot set (ask 781edc28). **These are unframed captures and have not been uploaded anywhere.** Ruby does the framing and captions. Nobody uploads without Tre.

## Provenance (DEMO-FIXTURE-SPEC §4)

- **Fixture:** `src/lib/demo-data.ts` at `1de16f7f`: the persona re-tune `cd7e1ea2`, plus the spec §3 de-rounding (no money figure ending in 00). Guide-copy fixes: `5dc058a0`, `a9d54b07`, `344df45c`. **Both sets were re-captured from a tree at `344df45c`**, which replaces the earlier `a9d54b07` frames at the same paths.
- **Round-figure check:** a Python scan of every visible money figure in all 14 frames found none ending in 00 except the $1,500 cash floor, which is a user setting. The scan's control must flag `$15,000` and `$300`, and it does.
- **Source:** `/demo` on the local dev server (Vite), wall clock 2026-09-23. demo-data.ts computes its dates from the day it loads, so a capture on another day shows other dates.
- **Viewport:** 430x932 CSS px at device scale 3, so each PNG is **1290x2796** (the iPhone 6.7"/6.9" App Store size). **Dark** theme.
- **Cookie banner:** rejected before the first frame, so the capture fired no analytics. No frame shows the banner.
- **DEMO chrome is kept** (the top "DEMO / Sample profile / Sign Up Free" bar). Every frame is an unaltered render. Hiding the bar would take DOM edits that the shipped app does not have. Crop it in framing if you want it gone.

## Frames

| File | Screen | What it shows |
|---|---|---|
| `01-dashboard.png` | Dashboard, Overview | Net worth $12,452 ($53,195 assets, $40,743 liabilities); "CREDIT CARDS PAID OFF May 2028, 1 yr 8 mo away" |
| `02-debt.png` | Debt Payoff | Avalanche guide card, Credit Card Payoff / Auto Loans tabs |
| `03-decisions.png` | Transactions, Decision Deck | "Marketway Foods -$118 - Is this your Groceries?" (1 of 78) |
| `04-forecast.png` | Transactions, Forecast tab | "NEXT MILESTONE May 2028 - CC Debt Free!" |
| `05-plan.png` | Transactions, Plan tab | Recurring-rules guide card |
| `06-accounts.png` | Dashboard, Accounts | Net worth tiles, then the accounts guide card |
| `07-goals.png` | Dashboard, Goals | Net worth tiles, Add Goal, the goals guide card |
| `08-garage.png` | Garage, Vehicles | 2024 Honda Civic (saving, $2,847 of $5,590 down), Toyota RAV4 (owned, loan) |

Strongest in Ada's view: 01, 04 and 03. They carry a date and a decision, the things this app does that a spreadsheet does not. 06 and 07 are mostly guide-card text above the fold.

## iPad 13" (`ipad-13/`), for ask e0b5154b

The same six screens Ruby used (01, 02, 03, 04, 05, 08). They are captured at 1032x1376 CSS px @2x = **2064x2752**, which is the 13" iPad App Store size. Dark theme, the same fixture and tree (`344df45c`, fixture `1de16f7f`), the same day. At that width the app renders its tablet layout with the collapsed side rail, so these frames are the real iPad layout, not the phone layout scaled up. On iPad the Decision Deck (03) is a centred panel, not full screen.

## Limits

- Every figure is what the engine computed on 2026-09-23. A later fixture change can move it. Read the figures back off the PNG before you caption.
- `demo-marketing-lines.engine.test.ts` reads the app's own provider since `93ee4587` (ask 16147de8), so its figures now match what /demo computes. Its clock is pinned to 2026-09-03, so its dates can differ by a month from these 09-23 frames (Jun 2028 against May 2028).
- Light mode, and phone sizes other than 6.7"/6.9", are not captured.
