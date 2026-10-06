# Competitors: onboarding and navigation - what to copy (ask 2fb9bc69)

Tre, 2026-10-06: *"look for more to copy/improve from our competitors. onboarding and navigation potentially"*.
Earlier passes: `navigation-jakobs-law.md` (2026-09-06), `onboarding-inventory-2026-09-18.md`.

## What they do (sources at the bottom)

| App | Onboarding | Navigation |
|---|---|---|
| Copilot Money | 6 screens: sign up, consent, verify, Face ID, then **link a bank**. Then a guided list: set budget (pre-built **from history**), review transactions ("To Review" queue), confirm income, create recurrings, create goals. | Dashboard (with review queue), Categories, Transactions, Cash Flow, Recurrings, Goals |
| Monarch | 7 steps, hard paywall early, then a **"Getting Started" checklist** on the dashboard (add accounts, categories, goals). Asks if you manage money with a partner. | Accounts, Transactions, Cash Flow/Reports, Budget, Recurring, Goals, Investments |
| YNAB | Optional guided flow OR jump in; a **resumable checklist** ("complete one task, come back later"), always showing done / next. ~18 screens incl. rent-or-own and spending questions. | Home, Spending, Reflect, Accounts |

**Common pattern: link the bank FIRST, build the budget from history, then finish setup from a resumable checklist.**

## Where Forgenta stands (measured 2026-10-06)

- **Budget from history: HAVE IT** (`RulesFoundCard` in the onboarding bank step) - but only premium reached that step.
- **Bank link first: premium only.** Free accounts got the premium pitch in that slot, although the first bank link has been
  free since 2026-09-06. Verified 2026-10-06: a throwaway FREE account gets HTTP 200 + a Plaid `link_token` from
  `plaid-create-link-token` (account deleted after). The exchange half (`free_bank_link_grants`, 0 rows) is still unexercised.
- **Resumable checklist: HAVE IT** (`OnboardingChecklist` on the dashboard).
- **Funnel:** 32 real accounts; 24 never finished and none of those is active in 30 days. Recent: 1 stopped at `expenses`.

## Proposed, in order

1. **SHIPPED 0824bbb0 (2026-10-06):** every tier links a bank second; free accounts see "Your first bank
   connection is free"; the premium pitch moves to after the save, one step before the finish.
2. **Copilot's review queue on Home:** new bank charges to confirm/categorise, as a dashboard card (we have the deck in
   Transactions > BankActivity; Home has nothing). Needs a design pass.
3. **SHIPPED b3c12107:** **Monarch's partner question** in onboarding ("Do you manage money with a partner?") feeding the existing partner link.
4. **Navigation:** competitors give a bottom-bar slot to Budget/Spending; ours puts Plan under Transactions and gives a
   top slot to Garage. That is Tre's call (taste/IA), not a desk change - ask once.

Sources: [Copilot quick start](https://help.copilot.money/en/articles/11157550-quick-start-guide),
[Copilot onboarding flow](https://lazyweb.com/canvas/flows/copilot/onboarding),
[Monarch screens](https://screensdesign.com/showcase/monarch-budget-track-money),
[Monarch getting started](https://help.monarch.com/hc/en-us/articles/360048393272-Getting-Started-Guide),
[YNAB set up at your own pace](https://www.ynab.com/whats-new/set-up-ynab-at-your-own-pace),
[YNAB onboarding screens](https://screensdesign.com/showcase/ynab).
