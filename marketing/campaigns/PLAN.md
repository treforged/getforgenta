# Forgenta — six free campaigns for car enthusiasts, 18 to 26

**Written 2026-08-12. Launch week (week 1) is the week of Monday 2026-08-10.**

Constraint, taken literally: **zero spend, no ad budget, nothing that needs a card.** Every channel
below is free to use, and every success number below can be read for free from a dashboard you
already have access to. If a number could not be read for free, the campaign is not in this document.

Second constraint, self-imposed: **each campaign has to compound.** A post that dies in 48 hours is
not a campaign, it is a Tuesday. Everything here leaves an asset behind: an indexed thread, a
subscriber, a page that ranks, a video that keeps being served, a share link somebody else posts.

---

## Who this is aimed at

Car enthusiasts, 18 to 26, in the US. Concretely:

- They have their first real income and their first real car payment, often at the same time.
- **Insurance is their biggest financial shock** and nobody warned them.
- They are already tracking their build somewhere: a notes app, a spreadsheet, a Discord, or nowhere.
- They do not want a budgeting lecture. They want to know if they can afford the turbo kit.
- They are hostile to anything that reads as an ad, and generous to anyone who does real math for
  them in public.

**The wedge is not budgeting. The wedge is the build.** Forgenta already has Vehicles, Builds with
per-part costs against a budget, a maintenance log with next-due dates, a loan/debt engine and a
forecast. That is a car-money app that happens to also do the rest of your money. Every campaign
below leads with the car and lets the personal finance follow.

---

## The six, at a glance

| # | Campaign | Channel | Cadence | Success number (by when) | Read from |
|---|---|---|---|---|---|
| 1 | **Pit Crew** | Reddit, car subs, advice-only | 10 replies/wk | 5 replies/wk at +3 or better, by wk 4 | Reddit profile → Comments |
| 2 | **Project Ledger** | Reddit build thread + one forum | 1 update/wk | 2,000 views/post by wk 6 | Reddit post → Insights |
| 3 | **60-Second Teardown** | YT Shorts + TikTok + Reels | 3 videos/wk | median 500 views/short by wk 6 | YouTube Studio, TikTok Analytics |
| 4 | **The Payment Letter** | Email (Google Form → Resend) | 1 issue/wk, Thu | +10 subscribers/wk and 40% opens, by wk 4 | Form responses, Resend broadcast stats |
| 5 | **Answer Engine** | getforgenta.com/answers/ | 2 pages/wk | 500 impressions/wk by wk 6, 25 clicks/wk by wk 10 | Google Search Console |
| 6 | **Real Numbers Carousel** | Instagram + Facebook | 2 carousels/wk | 10 link taps/wk by wk 6 | Instagram Insights |
| — | **North star** | all | — | 5 signups/wk by wk 8 | GA4 `sign_up` event |

Total time: **about 4 to 5 hours a week**, most of it on Sunday. The day-by-day split is in
`week-01/README.md`.

**Everything in this folder:**

| File | What it is |
|---|---|
| `PLAN.md` | This document: the six campaigns, their targets, their sources |
| `measurement.md` | Every number, where it is read, and what it does not tell you |
| `utm.md` | Link tagging conventions and the exact links, incl. both app stores |
| `week-01/README.md` | The setup checklist and the day-by-day |
| `week-01/reddit.md` | Campaign 1: the rules, and five replies ready to adapt |
| `week-01/build-thread.md` | Campaign 2: the weekly update template |
| `week-01/shorts.md` | Campaign 3: three shot lists, second by second |
| `week-01/email.md` | Campaign 4: form + Resend setup, and issue 1 written |

**And the rest of it, one level up in `marketing/`:**

| Path | What it is |
|---|---|
| `marketing/scripts/marketing-report.mjs` | The weekly report. `--targets`, `--add`, `--post` |
| `marketing/scripts/register-marketing-report-task.ps1` | Registers the Monday 8 AM run |
| `marketing/scripts/lib/marketing-metrics.mjs` | The scoring rules, with 27 tests beside them |
| `marketing/scripts/research/` | The Reddit pull and digest behind `research/FINDINGS.md` |
| `marketing/metrics/counts.example.csv` | The counts schema; the real `counts.csv` is gitignored |
| `marketing/research/FINDINGS.md` | 271 posts counted — the evidence the wedge rests on |

⚠️ **Campaign 5 is the exception and must stay where it is.** Its pages live in
`public/answers/` with `public/sitemap.xml`, because the web server serves them and
the URL is the whole campaign. Do not move them under `marketing/`.

---

## 1. Pit Crew — being the person in the thread who did the math

**Channel.** Reddit, in car subs, as a participant. Not the finance subs the existing
`scripts/reddit-scout.mjs` watches; those are a different audience and one of them has already
banned this account.

**Suggested subs to start:** r/whatcarshouldIbuy, r/askcarsales, r/projectcar, r/Cartalk,
r/MechanicAdvice, plus one or two model subs for cars in this price band. **Read each sub's rules
before the first comment, and drop any sub that produces a warning.**

**What gets posted.** Ten comments a week, ~2 a day, on threads where somebody is deciding whether
they can afford something. The shape is fixed and it is the whole campaign:

> One or two sentences of specific, genuinely useful math for *this person's* situation. Then stop.

**No URL. No app name in the first sentence. No app name at all unless somebody asks what you use,
and then one sentence, no link.** This is not timidity, it is the lesson already paid for: this
account was banned from r/personalfinance in week one for replies that led with the product and
closed with a link. See `marketing_reddit` in memory. The link is not how this campaign works —
**the profile is.** A Reddit profile has a bio and a link field, and a person who reads three good
comments from you clicks the username. That is the conversion path, and it is allowed everywhere.

**Aimed at.** The 19-year-old asking "is $480/month too much for this?" and the 24-year-old asking
whether to pay off the car or build it.

**Success, as a number.** ≥10 replies posted per week from week 1, and **≥5 per week sitting at +3
or better by week 4**. Karma is the proxy for "the sub finds this useful", and useful is the only
thing that survives moderation.

**Read from.** `reddit.com/user/<handle>/comments` — your own comments with their scores, free, no
tooling. Count once, Sunday night, and record it.

**Why it compounds.** Comment karma buys posting rights in stricter subs, threads stay indexed and
keep being found by search for years, and the profile becomes a body of work rather than a pitch.

**Kill criteria.** Two moderator warnings in the same sub, or four consecutive weeks below +3
median. The second means the replies are not actually useful, which is a writing problem, not a
channel problem.

---

## 2. Project Ledger — one build, documented in public, with the receipts

**Channel.** A serialized weekly thread on Reddit (r/projectcar and the relevant model sub), plus
one enthusiast forum where long threads live for years.

**What gets posted.** One update a week, same structure every time, so it becomes a series people
follow rather than a set of posts:

1. What got done this week (photo).
2. **What it cost, itemised** — the parts, the tax, the freight, the consumables, the labor, and the
   line nobody expects.
3. Running total against the budget set at the start.
4. One thing learned, stated plainly, including the mistakes.

**The receipts are the entire product.** Nobody posts real build costs, which is exactly why a
thread that does gets saved. The last line of each post is an ordinary sentence, not a call to
action.

**⚠️ Whose numbers.** These are Tre's own build costs and they are his to publish or not. Nothing in
this repository contains them: the templates in `week-01/` carry `$X,XXX` placeholders on purpose.
Fill them in at post time, and think once about which numbers you are comfortable having permanently
public before the first post.

**Aimed at.** The person planning the same build and searching for what it really costs. They arrive
by search, months later, which is the point.

**Success, as a number.** ≥2,000 views and ≥25 saves per post by week 6. Saves matter more than
upvotes here: a save is somebody planning to come back.

**Read from.** Reddit post → `⋯` → Insights (visible to the OP), which shows views, shares and
saves per post. Free.

**Why it compounds.** A 20-part build thread is a search result, a portfolio and a reason for
somebody to check your profile every week. It also feeds campaigns 3, 4 and 5: every update is a
short, a newsletter section and half an answer page.

---

## 3. 60-Second Teardown — screen recordings, one number each

**Channel.** YouTube Shorts, TikTok and Instagram Reels. One vertical file, posted to all three.

**What gets posted.** Three a week. Each is a screen recording of the app in **demo mode** with one
number as the whole story: what a $2,400 parts cart really costs, what 72 months does to a payment,
what insurance does to a car budget at 21, what a build looks like when it is tracked properly.

**Format, fixed:** hook in the first 1.5 seconds, on-screen text always (most watch muted), the
number on screen by second 5, 25 to 45 seconds long, no outro, no "link in bio" spoken. Shot lists
for the first three are in `week-01/shorts.md`.

**⚠️ Record in demo mode, never in a signed-in session.** Demo data is synthetic. A signed-in
recording puts real balances on TikTok permanently. Demo is entered by clicking **Try Demo** on
`/auth`; there is no route or flag for it, so navigate by clicking once inside.

**Aimed at.** The scroll audience. This is the top of the funnel and the only channel here with
genuine reach on day one.

**Success, as a number.** 3 posted per week (a production number, in your control, from week 1) and
a **median of 500 views per short by week 6** (an outcome number). Median, not total, so one lucky
video cannot hide nine that nobody watched.

**Read from.** YouTube Studio → Content → Shorts; TikTok → Analytics → Content; Instagram Insights.
All free, all per-video.

**Why it compounds.** Shorts keep being served for months, the back catalogue is permanently
searchable, and a channel with 50 videos is a reason to subscribe rather than a video to watch.

---

## 4. The Payment Letter — the list you own

**Channel.** Email. **Capture: a Google Form. Send: Resend.** Both free, neither needs a card.

Why a Google Form rather than a signup box in the app: a form exists this afternoon, needs no
deploy, no endpoint, no spam handling, and its response count is itself a free metric. When the list
justifies it, replacing it with a real form on the site is a small job. Do not build the
sophisticated version first.

**What gets sent.** One issue a week, Thursday, five minutes to read:

- **One number** from the week — a build line, a payoff date, an insurance quote spread.
- **The math**, written out, the way the answer pages do it.
- **One thing to do** this week that takes under ten minutes.
- A link to that week's answer page or build update. One link, no banner, no images.

**Aimed at.** The slice of the audience that already trusts you — the people who clicked a profile
after a good comment. This is the highest-intent group in the whole plan.

**Success, as a number.** **+10 net new subscribers per week and a 40% open rate, by week 4.**
Absolute size is a vanity metric early; net-new and opens are not.

**Read from.** Google Form → Responses (count); Resend → Broadcasts → the issue (delivered, opens,
unsubscribes). ⚠️ Open rate is inflated by image proxies and privacy relays; treat 40% as a
directional floor, not a precise measurement, and watch clicks alongside it.

**Why it compounds.** It is the only channel here that no algorithm can take away. 200 subscribers
is worth more than 20,000 impressions, and it is the only asset that survives a platform change.

---

## 5. Answer Engine — pages for the questions this audience actually types

**Channel.** `getforgenta.com/answers/` — static HTML pages served from `public/answers/`, no
framework, no JS, crawlable on the first fetch.

**What gets published.** Two pages a week. Each answers exactly one question a real person types,
shows the arithmetic, and says where every example number came from. **Three are already written and
in this branch:**

- `/answers/how-much-should-i-spend-on-a-car.html`
- `/answers/what-a-car-build-really-costs.html`
- `/answers/is-a-72-month-car-loan-bad.html`

The backlog, in rough search-demand order: *how much is car insurance at 21*, *should I pay off my
car or invest*, *how much should I save for mods*, *is it cheaper to build or buy*, *what does a
built car cost to insure*, *how much does a tune cost*, *should I finance mods*, *how much car can I
afford on $20/hr*.

**Aimed at.** Somebody with the question already in their head at 11pm. Highest intent of any
channel, and it arrives forever.

**Success, as a number.** **500 impressions/week by week 6** and **25 clicks/week by week 10.**
Impressions first, deliberately: a new page ranks nowhere for weeks, and impressions move before
clicks do. Judging this channel on clicks in month one would kill the only campaign here with a
two-year payoff.

**Read from.** Google Search Console → Performance → filter *Page contains `/answers/`*. Free.
Setup, including the fact that Search Console needs to be verified before it records anything, is in
`measurement.md`.

**Why it compounds.** Twenty pages that each get 30 visits a month is 600 visits a month that costs
nothing and does not stop when you do.

---

## 6. Real Numbers Carousel — the existing social pipeline, pointed at cars

**Channel.** Instagram and Facebook, through the auto-post pipeline that already exists in the
private `tre-forged-marketing` repo. **No new infrastructure. This campaign is a content brief on a
machine that is already running.**

**What gets posted.** Two of the week's slots become car-money carousels: slide 1 is the number,
slides 2 to 4 are the breakdown, the last slide is where the number came from. Same numbers as the
shorts and the answer pages, in a third format. Nothing new gets written for this campaign.

**Aimed at.** The existing followers plus hashtag/explore reach, which skews younger than the
current finance-only posts do.

**Success, as a number.** **10 link taps per week by week 6.** Reach and likes on a small account
are noise; a link tap is an intention.

**Read from.** Instagram → Professional dashboard → Insights → Link taps and Profile visits. Free.

**Why it compounds.** It costs no marginal effort and gives every asset a third life.

---

## North star

**5 signups per week by week 8**, read from GA4 → Reports → Engagement → Events → `sign_up`. The
event is already wired (`src/lib/analytics.ts`) and fires for both email and OAuth signups.

⚠️ **State the caveat every time this number is quoted:** GA4 only loads after the visitor accepts
analytics cookies, so `sign_up` is a **floor, not a count**. The true figure is higher by an unknown
margin. The honest cross-check is the user count in the Supabase dashboard, read manually. Do not
reconcile the two into one number; they measure different things.

---

## Decisions taken without asking

The session that wrote this was unattended, so these were decided rather than filed. Each is
reversible and each has a reason.

1. **Reddit car subs, not the existing finance-sub scout.** The scout targets
   personalfinance/Frugal/debtfree with budgeting-app queries. This audience is elsewhere, and
   `scripts/reddit-scout.mjs` is a closed, working workstream. **It was deliberately not modified.**
   Adding car subs and car queries to it is a good week-3 job, on its own branch.
2. **Static HTML answer pages under `public/`, not a route in the SPA.** They render without the app
   bundle, cannot be broken by an app-side regression, and are crawlable on first fetch. The cost is
   `.html` in the URL: `cleanUrls` in `vercel.json` would remove it, but that is a production-wide
   config change made for cosmetics, so it was not taken.
3. **`public/sitemap.xml` was created.** `robots.txt` has pointed at it since it was written and the
   file did not exist, so every crawler asking for it got the SPA's HTML with a 200. That is a real
   bug in the way of campaign 5, so it was fixed here rather than filed.
4. **The counts file is gitignored.** This repo is PUBLIC. Weekly signup and subscriber figures are
   business numbers; the schema is committed as `counts.example.csv` with invented values, the
   values are not.
5. **Google Form for email capture, not an in-app form.** Free, exists today, no deploy. Revisit at
   ~200 subscribers.
6. **No paid tool anywhere**, including the free tiers that ask for a card. Resend's free tier and
   Google's tools do not.
7. **Targets are deliberately modest.** They are set so that hitting them is evidence and missing
   them is information. A target nobody could hit teaches nothing.

## What this plan does NOT do

- **It does not post anything.** Everything here is drafted and ready; a human presses send. An
  unattended session publishing to Tre's accounts under his name is not a thing that should happen.
- **It does not touch the app's product surface.** No component, no route, no migration.
- **It cannot verify Search Console**, which needs a Google account action (see `measurement.md`).
- **It could not reach Resend**: the Resend tools are permission-blocked in an unattended session, so
  the audience and the first broadcast are drafted in `week-01/email.md` and created by hand.

---

## Weekly rhythm

| When | What | Time |
|---|---|---|
| Sun evening | Write 2 answer pages + next week's shorts scripts | 90 min |
| Mon 8:00 AM | Report lands on the board; fill the gaps it names | 10 min |
| Mon–Fri | 2 Reddit replies a day | 10 min/day |
| Tue / Thu / Sat | Post one short (record 3 in one sitting Sunday) | 30 min total |
| Wed | Build thread update | 30 min |
| Thu | Send the Payment Letter | 30 min |
| Sun night | Read the six dashboards, `--add` the numbers | 15 min |

Every campaign has a kill criterion of **four consecutive weeks below target once the target is
due**. Before that, keep going: none of these channels pay out in month one, and the whole reason to
write the numbers down is so the decision to stop is made from a table rather than from a mood.
