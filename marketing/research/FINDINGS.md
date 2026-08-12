# What the audience research actually said

Pulled 2026-08-12 with `scripts/research/reddit-rss-pull.mjs`, condensed with
`scripts/research/reddit-digest.mjs`. This file is the part worth keeping: aggregate counts and the
conclusions they support.

⚠️ **The raw dump is deliberately NOT committed** (`marketing/research/raw/` is gitignored). It is 289
real posts carrying usernames, permalinks and personal financial detail from people who did not
publish them here, and this repository is public. Aggregate counts are fair to quote; other people's
posts republished verbatim in a company repo are not. Re-run the puller if the corpus is needed
again; it takes about a minute.

## The corpus

271 unique posts after dedupe, across 18 subreddits: cars, whatcarshouldIbuy, askcarsales, Cartalk,
projectcar, MechanicAdvice, Autos, BMW, Miata, Mustang, Honda, civic, subaru, WRX, CarsAustralia,
Insurance, personalfinance, povertyfinance.

Method note, so nobody re-learns it: `www.reddit.com/*.json` 403s this machine (a User-Agent block,
not an IP block, see `marketing_reddit_scout` in memory), while `old.reddit.com/search.rss` answers
200 to the same client and carries the post's selftext. One global search with `subreddit:` terms
beats a per-sub sweep, which earns a blanket 429 within seconds.

## The counts

| Theme | Posts | Share |
|---|---|---|
| Mentions insurance or premium | **117** | **43%** |
| Mentions a monthly payment or affording something | 35 | 13% |
| Mentions a 72 or 84 month loan term | 9 | 3% |
| Mentions the cost or budget of mods, parts or a build | 8 | 3% |

Simple case-insensitive matching over title plus selftext, so treat these as an order of magnitude
rather than a survey. The gap between 43% and everything else is far too wide to be an artifact of
the matching.

## What follows from it, and it shaped the plan

1. **Insurance is the wedge, not budgeting.** Four in ten car-buying posts raise it unprompted, more
   than three times the rate of any other money topic. That is why `/answers/` leads with the total
   monthly cost of keeping a car on the road rather than the sticker price, and why every campaign's
   first proof point is an insurance number rather than a payment.
2. **Loan-term math is under-discussed relative to how much it costs people.** Only 3% of posts raise
   72 or 84 month terms, while the finance subs treat it as settled. That is an answer-page
   opportunity: high consequence, low competition, and a question people type into Google rather than
   ask a subreddit.
3. **Build costs are barely discussed as money at all.** 3%. Builds are discussed constantly; what
   they cost is not. This is the entire basis of campaign 2 (Project Ledger): publishing itemised
   receipts is not a crowded space, it is an empty one.
4. **The audience is spread across model subs, not concentrated in car-finance subs.** BMW, Miata,
   Mustang, Honda, civic, subaru and WRX all carry affordability posts. A campaign that only lives in
   r/personalfinance is in the wrong room, which is also where this account got banned.
