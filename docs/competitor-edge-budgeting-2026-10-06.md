# Competitor edge: budgeting apps - 2026-10-06 (Ada, getforgenta)

Why this ran: Sam's e1b0fffc slice. The onboarding funnel had no measurable drop. Only 2 of 28 real
users carry `onboarding_furthest_step` (26 signed up 03-22..08-07, before the column existed), and
there has been 1 real signup since 08-07. Acquisition is the bottleneck, so this reads what rival
users complain about.

## Method (re-runnable)

- `~/.claude/skills/competitor-edge/scripts/appstore_reviews.py reviews <id> --pages 10`, newest reviews, US store.
- Rows read: YNAB 500, Monarch 500, Copilot 250 (feed ran out), Rocket Money 500, EveryDollar 500.
- Complaints = 1-3 stars: **1,079 rows**. Control = 5-star rows (989).
- Themes proposed by the free tier (ollama qwen3:14b, 75 s), keywords set and counted by Ada over ALL rows.
- Keywords that also hit happy reviews were dropped ("pending", "learning curve", "premium feature").

## Counts after the 5-star control

| theme | Copilot | EveryDollar | Monarch | Rocket | YNAB | total | 5-star hits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| price / subscription | 15/106 | 24/218 | 34/180 | 65/349 | 36/226 | **174/1079** | 22 |
| bugs / crashes / slow | 19/106 | 22/218 | 22/180 | 9/349 | 13/226 | **85/1079** | 11 |
| customer support | 11/106 | 9/218 | 24/180 | 20/349 | 12/226 | **76/1079** | 23 |
| confusing / complicated | 5 | 10 | 6 | 13 | 37 | 71 | 26 |
| ads / upsell / nagging | 4 | 10 | 5 | 40 | 9 | 68 | 10 |
| bank sync / linking breaks | 8 | 15 | 20 | 11 | 5 | 59 | 5 |

Inside the 174 price complaints: **92 are about being charged after a trial or a cancel, or a refused
refund**. 15 are about a free tier that went away. 11 are about a price rise.

## The edge

| what users keep asking for | count | Forgenta today | fix or claim |
| --- | --- | --- | --- |
| Do not charge me by surprise | 174 (92 trial/cancel) | **has**: a free plan with no time limit, the first bank link free, no auto-charging free trial (grep: no trial in the paywall code) | Ad angle for Ruby, below. Product gap: a reminder before the $9.99 intro year renews at $89.99. |
| An app that does not break | 85 | partial | No claim. Our gates are internal evidence, not an ad. |
| A human who answers | 76 | partial (contact@treforged.com, one founder) | Possible claim "email the founder", only if Tre wants it. |

**First winnable complaint: surprise charges.** We already do the thing the users ask for.

### Ad angle for Ruby (our claim, their evidence)

"No free trial that turns into a charge. Forgenta has a free plan, and your first bank link is free."
Do not quote rival prices or reviews in the ad. Each rival's price is unverified here.

### Product ask for Ada

Remind the user before the intro year renews ($9.99 -> $89.99). In a year, our own intro offer
creates exactly the 92-review complaint. Unknown: whether Stripe's upcoming-renewal email is on in
the dashboard; no desk can read that setting.

## Limits

- App Store only, US, newest 500 per app. A recent release can inflate one theme.
- Keyword counts miss paraphrase. They undercount; they do not invent.
- Rocket Money is partly a bill-cancel service, so its price complaints include its fee model.
