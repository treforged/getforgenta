# Which card for this purchase? - PLAN ONLY (ask 1f3217bb)

Tre, 2026-10-01: *"a feature that helps people decide what card to use for what purchase. Placement
inside the app would need some work, probably some redesign and reorganization."* Sam reviews this
before any build.

## The answer it gives

The user enters an **amount** and a **category** (groceries, gas, dining, travel, other). The app
ranks their OPEN cards and names one card in one sentence, with the reason:

> **Use Venture X.** You earn about $6, and its balance is $0, so paid in full this costs nothing. Prime
> Visa earns $3 more but carries $8,893 at 27.74%: this purchase would cost about $2.30 a month there.

**The ranking rule is the house tie-breaker: save the user the most money.**
`net value = rewards earned - interest this purchase will cost - fees triggered`
- **Interest is decided by one fact: does the card carry a balance today?** A card with a carried
  balance has no grace period, so a new charge accrues interest from day one. At a $0 balance it costs
  nothing if the statement is paid in full. This term outweighs any rewards rate for anyone carrying
  debt. That is most of our users, and it is Tre.
- **Utilization:** penalize a charge that would push a card over 30% (or the user's own target). The
  existing utilization engine already computes this.
- **Statement timing (tie-break only):** between two zero-balance cards, prefer the one whose statement
  just closed, because the purchase gets the longest float. This needs the statement close day, which
  we do NOT store today; `payment_due_day` minus ~21 days is an estimate and must be labelled as one.
- **Planned cards (future `card_start_date`) are never suggested.** This is the same rule as cc0d4a65.
- **Welcome-offer spend** (Tre's own reason for movers on Venture X): an optional "spend $X by date"
  field on the card. While it is open, it adds the bonus value to that card's score.

## What is missing, and the honest default

**We have NO rewards data.** `accounts` has APR, limit, balance, due day and annual fee, and nothing about
rewards. Plaid does not supply rewards rates. Options:
1. **User-entered rates per card** (a "Rewards" row in the card editor: base %, plus up to 3 category
   multipliers). Honest and cheap. **Recommended.**
2. A built-in catalogue of popular cards. It goes stale, carries legal risk if wrong, and adds upkeep.
   Not now.

**With no rates entered, the advisor still works on the money that matters:** it ranks by interest cost
and utilization alone, and says "add rewards rates to compare earnings". It never invents a rate.

## Where it lives - and the reorganization it implies

Today the card information is split three ways: balances on Home > Accounts, payoff and APR on Debt,
and limits and utilization inside Debt > Utilization. A "which card" tool fits none of them alone.

**Proposal: Debt becomes "Cards"** (nav label and route kept `/debt` for links), with three panels:
- **Pay down** - today's payoff plan (unchanged content).
- **Use** - NEW: the which-card tool at the top, then each card's rewards rates and its open offer.
- **Health** - utilization and APR lines, moved from inside the payoff page.

Entry points: a "Which card?" button on the Home quick-add sheet (the moment someone is about to buy),
and a deep link `/debt?panel=use` that follows the `accounts-tab.ts` param pattern.

## Build order (each slice ships alone)

1. Pure helper `rankCardsForPurchase(cards, amount, category, today)` with number tests (interest term,
   future-card exclusion, utilization penalty). It uses no new data, so it is useful immediately.
2. The Use panel with amount + category, the one-sentence answer, and an empty state.
3. Rewards rates in the card editor (migration: `card_rewards` jsonb on `accounts`, RLS same-owner).
4. Welcome-offer field and statement close day, both optional and both labelled when estimated.
5. Debt -> Cards relabel and the panel split. This is the reorganization, last because it carries
   the most layout risk.

## Gates

Number tests on the helper (red-proven). A walk that presses Use, types an amount and asserts the named
card CHANGES when a balance changes. walk:empty must show the empty state and no "$" figure.

## Questions for Tre (one, via Sam)

**Rename Debt to "Cards"?** Recommended yes: once a tool for spending sits there, "Debt" is the wrong
word. If no, the Use panel still ships under Debt.
