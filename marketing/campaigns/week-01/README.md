# Week 1, day by day

Launch week is the week of **Monday 2026-08-10**. Everything "by week N" in `PLAN.md` counts from
here. Total time this week is about 5 hours, and roughly half of it is the one-time setup that never
has to happen again.

Nothing in this folder has been posted. Every file is a draft that a human sends.

## Before anything else: three accounts, 35 minutes, all free

These gate the numbers, and two of them record nothing retroactively. Doing them in week 3 costs
three weeks of data that cannot be recovered.

| # | Task | Time | Blocks |
|---|---|---|---|
| 1 | **Verify Search Console** on `getforgenta.com`, submit `sitemap.xml`, request indexing on the three answer pages. Steps in `../measurement.md` §1. | 10 min | Campaign 5, entirely |
| 2 | **Confirm GA4 is actually recording in production.** Open the live site in a clean browser, accept analytics, look for yourself in GA4 Realtime. If you are not there, `VITE_GA_MEASUREMENT_ID` is missing from Vercel and the north star is measuring nothing. | 5 min | The north star |
| 3 | **Google Form + Resend audience.** Form: one question, email address, required. Resend: an audience, then a broadcast. Draft and field list in `email.md`. | 15 min | Campaign 4 |
| 4 | **Instagram set to Professional** (Creator is fine, free). Insights and link taps do not exist on a personal account. | 2 min | Campaign 6 |
| 5 | **Reddit profile bio + link field**, using the tagged profile link in `../utm.md`. This is campaign 1's entire conversion path. | 3 min | Campaign 1 |

Optional, one command, and it is a change to the PC rather than the repo, so it was deliberately
left for you:

```
powershell -ExecutionPolicy Bypass -File scripts\register-marketing-report-task.ps1
```

## Monday

- Setup tasks 1 to 5 above.
- Two Reddit replies (`reddit.md`). Read the sub's rules first, every time, including subs you have
  posted in before.

## Tuesday

- Record all three shorts in one sitting (`shorts.md`). Batching is the only reason three a week is
  sustainable.
- Post short 1 to all three platforms.
- Two Reddit replies.

## Wednesday

- Build thread update 1 (`build-thread.md`). Fill in the real numbers at post time.
- Two Reddit replies.

## Thursday

- Post short 2.
- Send Payment Letter issue 1 (`email.md`).
- Two Reddit replies.

## Friday

- Two Reddit replies.
- Write next week's two answer pages, or at least their outlines. Copy the structure of an existing
  page in `public/answers/`: one question, the arithmetic shown, every example number sourced.

## Saturday

- Post short 3.
- Two carousels through the existing pipeline, using the same numbers as the shorts (campaign 6 is a
  content brief, not new work).

## Sunday, 15 minutes, the part that makes this a campaign rather than a habit

Read the six dashboards and record what you actually saw:

```
node scripts/marketing-report.mjs --add "2026-08-10,pit-crew,replies_posted,10,reddit profile"
node scripts/marketing-report.mjs --add "2026-08-10,teardown,shorts_posted,3,upload log"
node scripts/marketing-report.mjs --add "2026-08-10,answer-engine,pages_live,3,ls public/answers"
node scripts/marketing-report.mjs --add "2026-08-10,north-star,signups,0,GA4 sign_up"
```

**A number you did not read gets no row.** It prints as *no reading*, which is a different fact from
zero, and the report will tell you where to go and get it. Writing a 0 you did not verify is the one
way to corrupt this dataset.

Then print the week:

```
node scripts/marketing-report.mjs --this-week
```

## What week 1 is allowed to look like

Almost nothing. Every outcome target in the plan is due at week 4 or later, and the report knows
this: an unmet target before its due week prints as 🟡 tracking rather than 🔴 below. The only
targets due in week 1 are the three that are entirely within your control, because they are counts
of things you did: 10 replies, 3 shorts, 3 answer pages live.

If those three are green on Sunday, week 1 worked, whatever the reach numbers say.
