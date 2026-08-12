# Project Ledger: the weekly update template

Campaign 2. One post a week, same structure every time, so it becomes a series people follow rather
than a set of unrelated posts. Reddit (r/projectcar and the model sub) plus one enthusiast forum
where long threads live for years.

⚠️ **The numbers below are placeholders and they are yours to fill in or not.** Nothing in this
repository contains Tre's real build costs, on purpose. Decide once, before post 1, which figures you
are comfortable having permanently public, because a build thread is not something you can quietly
edit two years later. If itemised costs are too personal, the campaign still works with percentages
and running totals instead of dollar amounts, and it is worth deciding that now rather than halfway
through post six.

## The template

> **[Car] build log, week N: [what got done]**
>
> [One photo. Phone camera is fine. The photo is what stops the scroll, not the writing.]
>
> **What got done**
>
> [Two or three sentences. What went on the car, what it took, what fought back.]
>
> **What it cost**
>
> | Line | Amount |
> |---|---|
> | Parts | $X,XXX |
> | Tax | $XXX |
> | Shipping / freight | $XXX |
> | Consumables (gaskets, hardware, fluids) | $XX |
> | Labor | $XXX |
> | The thing I found once it was apart | $XXX |
> | **This week** | **$X,XXX** |
>
> **Running total:** $X,XXX of a $X,XXX budget. [N] weeks in.
>
> **What I learned**
>
> [One thing, stated plainly, including the mistakes. The mistakes are the part people remember and
> the part that makes the thread trustworthy.]

Last line is an ordinary sentence. No call to action, no link in the Reddit version. The forum
version can carry a signature link, which is what signatures are for.

## Why the receipts are the whole product

Nobody posts real build costs. Everybody wants them. A thread that itemises what a build actually
cost gets saved, and it gets found by search for years by the next person planning the same thing.
That is the compounding part: the post is worth more in month eight than in week one, which is also
why the success number is views and saves rather than upvotes. A save is somebody planning to come
back.

## What gets recorded on Sunday

```
node marketing/scripts/marketing-report.mjs --add "2026-08-10,project-ledger,thread_views,0,post insights"
node marketing/scripts/marketing-report.mjs --add "2026-08-10,project-ledger,thread_saves,0,post insights"
```

Read from the Reddit post, the `⋯` menu, then **Insights**, a panel only the OP can see. Views,
shares and saves per post, free. Targets are 2,000 views and 25 saves per post by week 6.

Forum threads mostly do not expose view counts per post the way Reddit does. If the forum you pick
shows a thread view count, record it in the source field rather than inventing a per-post split.

## It feeds three other campaigns

Every update is also a short (campaign 3), a newsletter section (campaign 4), and half an answer page
(campaign 5). Write it once, and the week's work is already done everywhere else. That is the reason
this campaign sits at one post a week and not one a month.
