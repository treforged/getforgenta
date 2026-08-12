# Measurement — everything free, and how to read each number

Written 2026-08-12, alongside `PLAN.md`.

The rule this file exists to enforce: **if it cannot be measured for free, it is not a campaign.**
Below is every number in the plan, where it is read, what it costs (nothing), and what it does not
tell you. Where a number is known to be wrong in a specific direction, that is written down next to
it rather than discovered later.

---

## Status at a glance

| Piece | State | Who finishes it |
|---|---|---|
| GA4 `sign_up` event, in the app | ✅ already wired, `src/lib/analytics.ts` | — |
| `public/sitemap.xml` | ✅ created in this branch (it did not exist) | ships on merge |
| `/answers/` pages | ✅ 3 written in this branch | ships on merge |
| Counts table + weekly report script | ✅ written and run | — |
| Monday 8 AM board post | ⚠️ script written, **task not registered** | Tre, one command |
| Google Search Console | ⛔ needs a Google account action | Tre, 10 min |
| GA4 measurement ID actually set in production | ⚠️ unverified from here | Tre, 2 min |
| Resend audience + first broadcast | ⛔ Resend tools blocked in unattended sessions | Tre, 15 min |
| Google Form for email capture | ⛔ needs his Google account | Tre, 10 min |

---

## 1. Google Search Console — campaign 5's only scoreboard

**Cost: free. Time: ~10 minutes, then nothing.**

⚠️ **Search Console records nothing before it is verified.** Data starts the day you verify, and
there is no backfill, so this is the single highest-value ten minutes in the plan and it should
happen before the answer pages are pushed.

1. <https://search.google.com/search-console> → **Add property** → **Domain** → `getforgenta.com`.
2. It gives a TXT record. Add it in **Cloudflare** → DNS → Add record → TXT, name `@`, the value it
   gave you. (Domain property is the right choice over URL-prefix: it covers www, apex and any
   subdomain in one, and DNS is where this domain already lives.)
3. Back in Search Console, **Verify**.
4. **Sitemaps** → submit `sitemap.xml`.
5. **URL Inspection** on each answer page → *Request indexing*. This does not guarantee ranking; it
   removes the "Google has not looked yet" excuse from week 2.

**Weekly read:** Performance → date range *Last 7 days* → **+ New → Page → contains `/answers/`**.
Record `gsc_impressions` and `gsc_clicks`.

**What it does not tell you:** it is Google only, it lags by 2 to 3 days, and impressions on a brand
new page are dominated by junk positions (50+). Position and CTR only become meaningful once a page
is in the top 20 for something.

---

## 2. GA4 — the north star, with a known bias

The app already loads GA4 and fires `sign_up` for both email and OAuth signups. Two things need
checking, both free:

1. **Is a measurement ID actually configured in production?** `initGA()` is a silent no-op when
   `VITE_GA_MEASUREMENT_ID` is unset. Verify from the outside, not from the code: open
   `getforgenta.com` in a clean browser, accept analytics in the cookie banner, then look at
   **GA4 → Reports → Realtime** for your own visit. If you are not there, the ID is missing from the
   Vercel environment and nothing in this plan is being counted.
2. **The consent gate.** GA4 only loads after the visitor accepts analytics cookies, and it is also
   suppressed for anyone sending Global Privacy Control or Do Not Track (deliberate, and correct).
   So **every GA4 number in this plan is a floor**, not a count. Never present it as the true figure,
   and never reconcile it against Supabase's user count into a single number — they measure
   different populations.

**Weekly read:** Reports → Engagement → Events → `sign_up` (last 7 days) → record as
`north-star/signups`.

**Also useful, same place:** Reports → Acquisition → Traffic acquisition shows session source and
medium, which is where UTM-tagged links from video descriptions and the newsletter land. And
Engagement → Pages and screens shows whether `/answers/` pages are being read at all, independent of
Search Console.

---

## 3. UTM links

Conventions and the exact links are in `utm.md`. Two rules that matter more than the conventions:

- **Never put UTMs on a link from getforgenta.com to itself.** A self-referral starts a new session
  and destroys the original attribution. Internal links between answer pages stay clean.
- **Reddit advice comments carry no links at all** (campaign 1), so they have no UTMs by design.
  Their attribution is the profile click, which shows up as a `reddit.com` referral in GA4.

---

## 4. Per-platform, all native and free

| Number | Where | Notes |
|---|---|---|
| `pit-crew/replies_posted`, `replies_positive` | `reddit.com/user/<handle>/comments` | Count your own week. Scores are visible on your own comments. |
| `project-ledger/thread_views`, `thread_saves` | Reddit post → `⋯` → **Insights** | OP-only panel. Views, shares, saves per post. |
| `teardown/median_views` | YouTube Studio → Content → Shorts; TikTok → Analytics → Content; IG Insights | Take the **median** of the week's videos, not the total. |
| `carousel/ig_link_taps` | Instagram → Professional dashboard → Insights | Needs a Professional (Creator or Business) account, which is free. |
| `payment-letter/subscribers_net_new` | Google Form → Responses, minus Resend unsubscribes | |
| `payment-letter/open_rate_pct` | Resend → Broadcasts → the issue | Inflated by image proxies. Directional only. |
| App installs | Play Console → Acquisition reports; App Store Connect → Analytics | Free, and the only true install numbers. Play reads the `referrer` parameter (see `utm.md`). |

---

## 5. The counts table

`marketing/metrics/counts.csv` — one row per week, per campaign, per metric.

```
week_start,campaign,metric,value,source
```

- `week_start` is always a **Monday**. `--add` snaps a mid-week date for you; a hand-typed non-Monday
  is rejected with the Monday it should have been.
- **Append only.** A later row for the same key wins, so a correction is one more line.
- **A metric you did not read gets no row.** It then prints as *no reading*, which is a different
  fact from zero, and the report tells you where to go and get it. A dashboard that renders both as
  `0` is a dashboard that cannot tell "nothing happened" from "nobody looked", and that is precisely
  the failure this whole file exists to avoid.
- **It is gitignored.** The repo is public; these are business figures. The committed
  `counts.example.csv` carries the schema and entirely invented values.

Record a number:

```
node scripts/marketing-report.mjs --add "2026-08-16,pit-crew,replies_posted,11,reddit profile"
```

See every metric and its source:

```
node scripts/marketing-report.mjs --targets
```

---

## 6. The weekly report on the board

```
node scripts/marketing-report.mjs              # last completed week, printed
node scripts/marketing-report.mjs --this-week
node scripts/marketing-report.mjs --post       # also files it on the Conductor board
```

To have it arrive on its own every Monday at 8 AM:

```
powershell -ExecutionPolicy Bypass -File scripts\register-marketing-report-task.ps1
```

⚠️ **The task was written but not registered** — registering a scheduled task on Tre's PC is a
change to his machine, not to this repo, and an unattended session should not make it silently. One
command, once.

The report is designed to be useful on a week where nothing was recorded: it names every unread
number and where to read it, so an empty Monday produces a ten-minute checklist rather than a wall
of zeroes.
