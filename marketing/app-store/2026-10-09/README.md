# Screenshot re-shoot brief - 2026-10-09 (for Ruby)

Three of the eight shots in `tre-forged-marketing/content/appstore.json` change. Store text is in
`listing.md`; the drop-in shot objects are in `appstore-shots.json`.

## Why these three
- The subtitle sells **Safe to Spend**, and shot 1 (`00-intro`) shows net worth. The first screenshot
  should prove the subtitle.
- **Quick add** shipped 10-09 (5 taps from Home) and no shot shows it.
- **Plan** moved into the bottom bar on 10-06. The paycheck shot came from the old Transactions -> Plan
  path, so its bar shows the wrong tab lit.

## The shots (slot = position in appstore.json `shots`)

| Slot | Replaces | New id | Screen and state on /demo | Headline | Frame file |
| --- | --- | --- | --- | --- | --- |
| 1 | `00-intro` | `00-safe-to-spend` | **Home** (`/dashboard`), Advanced view, scrolled so the **MONTHLY BUDGET SNAPSHOT** card sits at the top: Next paycheck, Month-end cash, **SAFE TO SPEND UNTIL <date> $X**, then the Available ring | Know what's safe to spend before payday. | `09-safe-to-spend.png` |
| 5 | `04-debt-plan` | `04-quick-add` | **Home**, press the gold **+** in the bottom bar (iPad: Home's **Add**), tap **Groceries**, keys **3** and **6**. Sheet open, hero "-$36", button "Add $36". **Do not press Add** | Log a purchase in five taps. | `10-quick-add.png` |
| 6 | `05-recurring` | `05-plan` | **Plan** (`/budget`), Advanced view, scrolled so **INCOME & TAXES** sits at the top (gross 1182, Weekly, Fri). Bottom bar shows **Plan** lit | Enter your paycheck once. Every forecast uses it. (kept) | `05-plan.png` |
| ? (proposed) | the current Garage shot if there is one, else the last slot | `06-car` | **Debt > Auto Loans** (`/debt?tab=auto`), Advanced, scrolled so **AUTO LOAN PAYOFF TRAJECTORY** leads: RAV4 balance falling to $0, then the loan card (Monthly Payment, **Payoff Date**). iPad also shows the Civic's down-payment saving | See the month your car is paid off. | `11-car.png` |

**The car slot (added 10-09, Tre: debt advice, Safe to Spend and the car side are the three selling points).** None of
the three re-shoots above shows the car, and the old `08-garage` frame is a guide card and two rows. The car MONEY
lives on Debt > Auto Loans, so `11-car.png` shoots that. The 8-shot `appstore.json` is in the marketing repo and was
not readable from this session, so Ruby confirms which id it replaces (`_slot` in `appstore-shots.json`). It never
replaces 00 (Safe to Spend), 01 (payoff) or 04 (quick add). Shoot it with `ONLY=11`.

Why `04-debt-plan` gives up its slot: `01-payoff` already sells the debt story ("Know the month your
cards hit zero"), so the set keeps one debt shot and gains the feature that shipped.

## How to shoot them (getforgenta, PC)
```
npm run dev
ONLY=05,09,10,11 node scripts/capture-store-frames.mjs <out-dir>
```
The script now has these three frames (05 fixed to `/budget`, 09 and 10 new). Every press asserts its
screen appeared before saving, and it writes phone (1290x2796) and iPad (2064x2752) frames. Copy them to
`screenshots/appstore/2026-10-09/` in the marketing repo (the paths `appstore-shots.json` uses). The
frames in this folder are the 10-09 cloud run, for reference.

## Before `appstore_check.py`
1. **Re-read the figures.** `demo-data.ts` dates move with the calendar, so "$2,195.64" and "OCT 16" are
   10-09's values. Put what your frames show into `figures`.
2. **Check the iPad crops.** Phone crops were measured on these frames; iPad crops are first guesses.
3. `forbidden` needs no change: every crop starts below the DEMO / Sign Up Free strip.

## Things the shots must not do
- Show a price, the word "free" next to quick add, or anything about the web app.
- Show the demo strip ("DEMO", "Sign Up Free"). The crops remove it; appstore_check enforces it.
