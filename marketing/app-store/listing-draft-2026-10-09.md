# Store listing draft - 2026-10-09 (growth pass, DRAFT ONLY)

Nothing here has been submitted or pasted anywhere. Each block is a proposal for Tre. Character
counts were measured by script, not estimated.

## What the repo holds today, and what it does not
- **App Store name and keywords**: `scripts/asc-aso-metadata.mjs` (approved 10-07, "Forgenta: Budget
  Planner"). It is still waiting on the 6.8.2 submit (run 37886070198 uploaded the binary).
- **App Store subtitle**: "Safe to Spend & Payoff Date" (decision 69c9bdc0). Live, keep it.
- **App Store description and promotional text**: NOT in the repo. They live only in App Store
  Connect, so nobody can diff them against what shipped. Proposal 4 in `docs/growth-pass-2026-10.md`.
- **Play title, short and full description**: NOT in the repo either; Play Console only.
- **Screenshot captions**: NOT in the repo ("Ruby does the framing and captions",
  `marketing/app-store/2026-09-23/README.md`). The frames are from 09-23, so **none shows quick add**
  (shipped 10-09) and none shows Plan in the bottom bar (10-06).
- **What's New**: generated from `Release-Note:` trailers (`scripts/release-notes.mjs`). Android
  publishes it automatically; iOS needs a manual paste from the run summary.

## 1. App Store promotional text (170 max) - 130 chars
> Know what's safe to spend before payday. Log a purchase in five taps, see the month your cards hit zero, and plan 60 months ahead.

Promo text changes WITHOUT a version submit, so this is the one field that can go live today
(Tre pastes it in App Store Connect). It replaces the approved "what is safe to spend before payday"
line only if Tre wants quick add named; otherwise keep his.

## 2. App Store description (4000 max) - proposed
> **Know what's safe to spend before payday.**
>
> Forgenta takes your paychecks, your bills and your cards and answers the two questions that matter:
> how much can I spend before my next paycheck without missing a bill, and what month will my credit
> cards hit zero?
>
> **SAFE TO SPEND UNTIL PAYDAY**
> One number, checked through your next paycheck, after every bill due before it. Tap it to see exactly
> how it was worked out.
>
> **YOUR DEBT-FREE DATE**
> Forgenta ranks your cards by what each one actually costs you and tells you what to send each one this
> month, after every minimum is covered. Add $100 a month and see how many months sooner you finish.
>
> **QUICK ADD**
> Tap the gold + and log a purchase in five taps: amount, category, done.
>
> **A PLAN THAT LOOKS 60 MONTHS AHEAD**
> Add your income and the bills that repeat once. Forgenta projects your cash, debt and net worth five
> years out, and warns you before a month runs short.
>
> **CONNECT YOUR BANK, OR DON'T**
> Your first bank connection is free. Or add every account by hand: cash, investments, a loan from a
> friend.
>
> **GOALS, CARS AND PARTNERS**
> Savings goals on the same timeline as your debt. A Garage for saving for a car, paying one off or
> building one. Share a budget with a partner.
>
> **NO ADS. EVER.** Your data is never sold.
>
> Forgenta is free to start. Premium adds daily bank sync, more linked accounts, CSV and PDF exports and
> unlimited goals and debt trackers.

Check before pasting:
- Every claim maps to a shipped screen (Safe to Spend drawer, Debt "Finish sooner", QuickAddSheet,
  Forecast, FreeBankLinkNotice, Garage, partner sharing).
- "Quick add" is Premium in the native app (decision 10-09). The description names it without saying
  it is free, which is accurate for both tiers. **It must never say "free on the web"** (guideline
  3.1.1 / anti-steering): the same reason the release branch stripped that Release-Note.
- No prices in the description; Apple shows them.

## 3. Google Play
- **Short description (80 max) - 73 chars**: `Safe to spend until payday, your debt-free date, and quick add in 5 taps.`
- **Full description**: reuse section 2 (Play allows 4000).

## 4. What's New for the first native release carrying quick add (Release-Note trailer, one line)
> Quick add (Premium): tap the gold + in the bottom bar to log a purchase in five taps. Your last category and account are remembered.

The 10-09 release branch deliberately carries `Release-Note: none` for the web-pricing commit. The
quick-add FEATURE commit should carry a line like this one, so the store notes say what shipped.
**Check `git log` on the release before adding it; do not duplicate a trailer already there.**

## 5. Screenshot set - proposed changes (Ruby frames, Tre approves)
| Slot | Today (09-23) | Proposed caption | Frame |
| --- | --- | --- | --- |
| 1 | Dashboard (net worth) | "Safe to spend until payday" | Home in **Simple** view, Safe to Spend card on top (/demo) |
| 2 | Debt | "Know the month your cards hit zero" | keep 02-debt |
| 3 | Decisions | "Log a purchase in five taps" | **NEW**: QuickAddSheet open with $36 / Groceries (`npm run check:quick-add` already drives it) |
| 4 | Forecast | "Plan 60 months ahead" | keep 04-forecast |
| 5 | Plan | "Bills and paychecks, set once" | re-shoot: Plan is now in the bottom bar |
| 6-8 | Accounts, Goals, Garage | "Goals on the same timeline" / "Every account in one place" / "Saving for a car? Track it" | keep |

Why slot 1 changes: the subtitle sells "Safe to Spend", and the first frame shows net worth. The
first screenshot should prove the subtitle.
