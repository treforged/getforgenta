# Pit Crew: how to reply, and five that are ready

Campaign 1. Ten comments a week, about two a day, in car subs. This is the cheapest campaign here
and the easiest one to get banned for, so the rules come before the drafts.

## Rules, and they are not stylistic

The account has already been banned once, from r/personalfinance, in week one. The cause was
structural rather than tonal: a five-part template that led with the app name, listed features, and
closed with a link. That reads as spam to a moderator however casual the prose is.

- **No URL. Ever.** Not the site, not the app stores, not a screenshot of the app.
- **One paragraph, 60 to 110 words.** Prose. No bullets, no headings, no bolded labels.
- **No em dashes.** They read as machine-written to this audience.
- **No app name unless someone asks what you use**, and then one sentence, no link.
- **At most one product detail**, only when it genuinely fits the post.
- **End on an ordinary sentence.** No call to action of any kind.
- **Read each sub's self-promotion rules before your first comment there**, and drop any sub that
  gives you a warning rather than arguing with a moderator.

The conversion path is the profile, not the comment. Somebody who reads three good comments clicks
the username, and the profile bio carries the only link in this campaign. That is allowed everywhere
and it is why the bio setup in `README.md` is a week-1 task.

## Where

r/whatcarshouldIbuy, r/askcarsales, r/projectcar, r/Cartalk, r/MechanicAdvice, plus one or two model
subs for cars in this price band. Deliberately **not** the finance subs the existing
`scripts/reddit-scout.mjs` watches: different audience, and one of them has already banned this
account.

Sort by New. A four-hour-old thread with six comments is worth ten times a front-page thread with
four hundred, because the person asking will actually read you.

## Five replies, ready to adapt

Adapt the numbers to the actual post. A reply with numbers that do not match the OP's situation is
worse than no reply.

**1. "Is $480 a month too much for this?"**

> Depends what the other lines look like, and the payment is usually the smallest of them. Add the
> insurance quote on that exact car, fuel at your real weekly miles, and something like a hundred a
> month set aside for tires and brakes, because those arrive whether or not you budgeted for them. If
> that total is over about ten percent of your take-home you will feel it every month, not just on
> the first. At your age the insurance number is usually the one that decides it, and most people
> find it out after they sign.

**2. "Should I pay off the car or build it?"**

> Run the interest first. If the loan is under about five percent, the money is cheap and building
> while you pay it down is a defensible choice. Above nine and the loan is quietly eating the build
> budget every month. The other half is whether you are underwater right now, because being upside
> down turns any decision into a bad one if the car gets totaled. Work out what you owe versus what
> it is worth today, then decide, rather than deciding and finding out afterwards.

**3. "How much should I budget for this build?"**

> Take your parts cart and add about seventy percent. Tax, freight on anything oversize, gaskets and
> hardware, fluids, labor, and the bolt that snaps once it is apart. A twenty four hundred dollar
> cart lands closer to four grand by the time the car is back together, and that is the normal case,
> not the unlucky one. Budget five to ten percent for the while you are in there discovery
> specifically. Everyone who has done this has that line, and everyone leaves it out of the plan.

**4. "First car, what am I not thinking about?"**

> Insurance, and get real quotes before you shop rather than after. Same money, two different cars,
> and the spread between a sedan and a two door can be over a hundred a month at your age, which is
> more than you will ever save haggling at the dealer. The other one is the loan term. A payment can
> always be made affordable by making the loan longer, and the loan getting longer is exactly what
> makes the car expensive. Shop by the total monthly cost of keeping it on the road.

**5. "What do you use to keep track of all this?"** (only when asked)

> I keep the build and the money in the same place, which sounds obvious and almost nothing does it.
> Parts against a budget, the loan, and what the monthly actually is once insurance and fuel are in
> there. I use Forgenta for it. Before that it was a spreadsheet I stopped updating around part four,
> which I think is where most people end up.

## What gets recorded on Sunday

```
node marketing/scripts/marketing-report.mjs --add "2026-08-10,pit-crew,replies_posted,10,reddit profile comments"
node marketing/scripts/marketing-report.mjs --add "2026-08-10,pit-crew,replies_positive,3,same page, +3 or better"
```

Both are counted off `reddit.com/user/<handle>/comments`, where your own comment scores are visible.
`replies_posted` is due at week 1 because it is entirely in your control. `replies_positive` is due
at week 4, because it measures whether the subs find you useful, and that takes a month to read.

**Kill criteria:** two moderator warnings in the same sub, or four consecutive weeks with fewer than
five replies at +3 or better once week 4 has passed. The second one is a writing problem, not a
channel problem, and the fix is better math in the reply rather than a different subreddit.
