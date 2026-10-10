# Onboarding audit and fast path (2026-10-09)

Ask (Tre via Sam): 5 real signups in 90 days, and the most recent quit on the FIRST onboarding screen.
Goal: a new user sees their own Safe to Spend or payoff date in under a minute.
Branch: `claude/onboarding-fast-10-09`, stacked on `claude/release-10-12` (aa26159).

Source of truth: `src/pages/Onboarding.tsx` (one flow, `buildSteps`). Tap counts below are read from
the code and walked on /demo at 375x667 with Playwright (the wizard renders in demo; saving needs a real
account, so the save itself is a PC `walk:first-run` item). "Tap" = one press; typing a value counts as
the tap that focuses the field plus the typing.

## Before: the full wizard (unchanged, still reachable)

Free account: 9 screens. Premium: 8 (no Premium pitch).

| # | Screen | What it asks | Required | Min taps (no bank) |
| --- | --- | --- | --- | --- |
| 1 | Welcome | Name (prefilled from sign-up if given), "Just me / Me and a partner", demo link | nothing | 1 (Continue) |
| 2 | Bank | Link a bank via Plaid (first link free) | no | 1 (skip) |
| 3 | Income | Pay frequency (select), gross per paycheck, tax rate (22 default), money in checking | gross, to see a number | 5 (select 2, gross 1, checking 1, Continue 1) |
| 4 | Expenses | Rent, utilities, groceries, subscriptions | no | 1 ("Save what I have") or 5 |
| 5 | Debts | Name, balance, APR, minimum, limit per debt | no | 1 or ~7 per debt |
| 6 | Savings | Savings balance, APY | no | 1 or 3 |
| 7 | Goals | Goal rows (incl. Car Fund) | no | 1 ("See your plan") - saves here |
| 8 | Premium (free only) | Upgrade pitch | no | 1 (decline) |
| 9 | Finish | Summary, partner card, premium card, "where things are" | no | 1 ("Continue free") |

- **Shortest path to Home with a number:** 10 taps and 2 typed values across 6 screens (Welcome,
  Bank skip, Income, "Save what I have" on Expenses, Premium decline, Finish). Pressing through every
  screen without the early save is about 13 taps and 9 screens. Entering bills, one debt and savings
  is about 30 taps.
- **Never asked:** the payday. The engine defaults to Friday (`buildPayConfig`: `paycheck_day || 5`),
  so Safe to Spend's "until <date>" can be wrong for everyone paid on another day.
- **The first screen asks nothing the number needs** (name, who the budget is for). It is the screen
  the latest signup quit on.
- **Finding, not fixed here:** the Debts step writes `debts` rows only. The card payoff engine builds
  cards from credit-card ACCOUNTS (`buildCardData` filters `account_type === 'credit_card'`), so a card
  entered there does not appear to produce a "Credit cards paid off" date until an account exists.
  Reasoned from the code, not measured with a real account; the PC `walk:first-run` should confirm it.

## After: the fast screen (`step === 'quick'`, now the first screen for a new user)

One screen, everything on it visible at 375x667 (save button bottom 660px of 667, measured):

| Field | Writes | Required |
| --- | --- | --- |
| How often are you paid? (Weekly / Every 2 weeks / Monthly, default every 2 weeks) | `paycheck_frequency` | default |
| Pay per check (before tax) | `weekly_gross_income`, `gross_income`, `monthly_income_default` (22% tax estimate, editable under Plan) | **yes** |
| In checking now | a `checking` account row (what Safe to Spend starts from) | no |
| Next payday | `paycheck_day` (+ `paycheck_start_date` for every-2-weeks) | no |
| Biggest credit card: balance, APR | a `credit_card` ACCOUNT row, so the payoff date computes | no |

- **Taps:** 4 to 6 taps and 2 typed values (pay and checking), 1 screen. Measured walk: Weekly,
  pay, checking, payday (tap and pick), save = 6. With the default frequency and no payday: 3.
  Before: 10 taps over 6 screens.
- **Saving:** "See my Safe to Spend" runs the SAME `persist()` as the wizard: same profile write, same
  `onboarding_completed_via: 'wizard'`, same `onboarding_finished` funnel event, same bounded writes and
  error messages. It then goes straight to Home. There is no finish screen and no Premium pitch on this
  path (Tre's call, below).
- **Funnel:** the fast screen records `onboarding_furthest_step = 'quick'` (its own order,
  `QUICK_STEPS`), so fast finishers stay distinguishable from wizard finishers (`'finish'`).
- **Nothing is lost:** both paths share one draft. "Set up step by step (link a bank)" opens the full
  wizard's Welcome with the answers carried over (walked: pay 1200 typed on the fast screen reads 1200 on
  Income). `/onboarding?full=1` opens the full wizard directly. "Skip setup" is unchanged.
- **Finish later on Home:** an account whose furthest step is `'quick'` gets the existing checklist in a
  new `finishLater` mode, placed UNDER Safe to Spend, the payoff card and the car card. It adds "Add your
  monthly bills" (the fast screen asks for none) and counts a credit-card account as a debt. It never
  writes completion: the ordinary checklist writes `onboarding_completed_via: 'checklist'` when all items
  are ticked, which would overwrite the fast path's `'wizard'`. The car card's own empty state
  ("Planning a car?") covers the car.

## Gates that assume the old first screen (need a PC update)

These open /onboarding and expect "Welcome to Forgenta" / "What should we call you?" first. Each needs
`/onboarding?full=1` instead of `/onboarding` (or a press of "Set up step by step"):
`check:first-save`, `check:save-timeouts`, `walk:first-run`, `check:onboarding-orientation`,
`check:onboarding-stay`, `measure:first-save`. None can run in the cloud session (they need walk
credentials). The fast screen needs its own signed-in walk: create a throwaway `@forgenta.test` user,
press through the fast screen, and confirm Home shows Safe to Spend, the payoff date from the one card,
and the "Finish setting up" list.
