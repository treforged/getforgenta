# Why the app is "sometimes" slow — what was MEASURED, 2026-09-11

Tre: *"figure out how to make everything in the app load faster. the pages have
long loading times sometimes."*

**This document is a measurement, not a fix.** The word that shaped it is
**SOMETIMES**: an intermittent slow path is a different defect from a slow one,
and a mean hides it. Nothing here was optimised yet, on purpose — the first
thing to establish is which of the plausible causes is real, because three of
them are not.

---

## THE ANSWER, in one line

**No query is slow and the bundle is not large. The instance itself
intermittently stalls, and the Dashboard withholds all real content until three
round trips against it have landed — so when the stall lands, the person looks
at a skeleton for seconds.**

---

## 1. The decisive measurement: a 0-row table takes 1.4 seconds

`reddit_scout_pending_runs` is polled every five minutes. Over 24 hours of edge
logs:

| path | calls | avg | max | 504s |
|---|---|---|---|---|
| `/rest/v1/reddit_scout_pending_runs` | 72 | **1404 ms** | 5022 ms | **6** |
| `/rest/v1/marketing_slots` | 6 | 2166 ms | 5027 ms | 1 |
| `/rest/v1/profiles` | 4 | 1714 ms | 5104 ms | 1 |
| `/rest/v1/expenses` | 75 | 75 ms | 976 ms | 0 |

And that table, from `pg_stat_user_tables`:

```
reddit_scout_pending_runs   0 live rows   24 kB   idx_scan 3063   seq_scan 5
```

**Zero rows, 24 kilobytes, served by an index — averaging 1.4 s and timing out
at 5 s.** An indexed lookup on an empty table is microseconds. So the latency is
NOT query execution. Whatever is costing 1.4 s happens before or around the
query, at the instance.

This is the single most useful number in the investigation, because it is a
control: it holds the query cost at essentially zero and still shows the delay.

## 2. It is not the queries

Every table in this database is tiny. Largest relevant:

```
synced_transaction_reviews   785 rows   592 kB
synced_transactions          831 rows   536 kB
recurring_rules              436 rows   216 kB
profiles                      49 rows   272 kB
```

`recurring_rules` has 9,897 sequential scans, which looks alarming and is not —
a seq scan over 436 rows in 216 kB is cheaper than using an index.

What the app's own queries DO show, over 173 days of `pg_stat_statements`, is a
heavy tail rather than a high mean:

| query | calls | mean | **stddev** | max |
|---|---|---|---|---|
| `synced_transaction_reviews` select | 2817 | 78 ms | **142 ms** | 1798 ms |
| `recurring_rules` select | 6118 | 39 ms | **70 ms** | 1150 ms |
| `synced_transactions` select | 1479 | 62 ms | **101 ms** | 1301 ms |

**Standard deviation roughly double the mean on all three.** That is the
statistical signature of "sometimes", and it is the same shape as the 0-row
table above — consistent with an instance that stalls, not with queries that
are expensive.

## 3. It is not connection-pool exhaustion

```
max_connections 60   total 13   active 1   idle 4   waiting on IO 0
```

Ruled out by measurement rather than assumed.

## 4. It is NOT the bundle — and this is the important negative result

Measured from a real `npm run build`, then from the files on disk rather than
from the build's own summary:

```
initial payload: 15 files, 1065 kB raw, 301 kB gzipped
30 chunks total, route-code-split
```

The two largest chunks in the build (`dist-BMoC7y7U.js` 421 kB and
`dist-tigp_CrM.js` 365 kB) are **not referenced by `index.html`** — they are not
on the initial path.

301 kB gzipped is an ordinary SPA payload. **But the stronger argument is
logical, not numerical: a bundle cannot explain "sometimes".** A fixed set of
files downloads at the same size every time, and gets faster once cached. It can
make an app uniformly slow. It cannot make it intermittently slow.

**So do not spend a day on bundle splitting.** That was the obvious-looking fix
and the measurement says it would buy nothing for the symptom Tre reported.

## 5. What turns an instance stall into a blank page

`src/pages/Dashboard.tsx` calls **14 data hooks** plus six writer/checker hooks
(`useNotificationCheck`, `useNetWorthSnapshotRecorder`, `useLeaderboardPublisher`,
`useWidgetSync`, `useValueMoments`, `useRetirementAutoUpdate`) — roughly twenty
round trips on open.

And at `Dashboard.tsx:1553`:

```ts
const essentialLoading = txnLoading || acctLoading || profileLoading;  // :314
...
if (essentialLoading) { /* the whole page is replaced by a loading state */ }
```

**No real content appears until transactions, accounts AND profile have all
landed.** Three round trips, in series with the render, against an instance
whose per-request latency is sometimes 1.4 s and sometimes 5 s.

⚠️ **CORRECTED BEFORE THIS DOCUMENT WAS COMMITTED, and the correction matters
for what to build.** The first draft of this section said the page "renders
nothing" and called it a blank page. **It does not.** `Dashboard.tsx:1554-1569`
returns a complete skeleton — header bars, `ScheduleSkeleton`, eight
`MetricSkeleton` tiles and a `ChartSkeleton`. So the graceful-degradation work
somebody would reach for first **already exists**, and a recommendation to "stop
the page blanking" would have been a rebuild of shipped code.

What is actually true is narrower and less dramatic: the skeleton is shown for
as long as the slowest of three requests takes, and **every widget waits on the
same gate even though most of them do not need all three.** The remaining win is
progressive — letting tiles whose own data has arrived render while the others
are still in flight — not the difference between blank and content.

That is the mechanism, stated as condition and effect:

> **The slow path is the Dashboard's `essentialLoading` gate, and it happens
> when the Supabase instance is in a stalled/throttled period — which the 0-row
> table proves is a property of the instance, not of the data.**

## 6. The condition behind the stall — STRONGLY INDICATED, NOT PROVEN

The project is on the **free plan** (`get_organization` → `"plan": "free"`),
and `max_connections = 60` confirms the smallest instance class. Free-tier
compute is shared and burstable, so latency degrades when burst credit is
exhausted and recovers afterwards — which matches an intermittent multi-second
stall on trivial queries.

⚠️ **This is the one claim in this document that is inferred rather than
measured.** What is measured is that the stall is real, is not the query, is not
the pool, and is not the bundle. That it is *specifically* burst-credit
throttling is the best-supported explanation, and Supabase does not expose a CPU
credit metric through the MCP tools available here, so it has not been confirmed
directly. Do not repeat it as established.

## 7. What this document does NOT cover

- **There is almost no Forgenta traffic in the 24-hour edge-log window.** The
  volume there is the expense tracker (`expenses`, `capital_contributions`) and
  other desks' pollers (`reddit_scout_*`, `marketing_slots`). So there is **no
  real page-load p95 for Forgenta itself** — the instrument gap is named here
  rather than papered over with another project's numbers.
- **No client-side trace was taken.** Time-to-interactive, render cost and the
  request waterfall as a browser actually experiences them are unmeasured. The
  server-side finding above is solid; the client-side share of the delay is not
  quantified.
- **Nothing was optimised.** No fix is claimed.

## 8. What to do next, in order of evidence behind it

1. **Let widgets resolve individually instead of behind one shared gate.** The
   skeleton already exists (§5), so this is not about blank-versus-content — it
   is about a tile whose data arrived in 80 ms waiting on one that took 5 s.
   This helps under every explanation of the stall, which is why it is first: it
   does not depend on §6 being right.
   ⚠️ It is a real slice, not a constant change — each widget has to handle its
   own absent data honestly, and `?? 0` on a money tile is the defect this repo
   has caught four times. Scope it properly rather than loosening the gate.
2. **Take a real client trace** on a signed-in session and get the waterfall.
   That closes the gap named in §7.
3. **Only then consider the plan.** Upgrading compute would address §6 if §6 is
   right, and it costs money, so it should not be recommended on an inferred
   cause. Confirm the throttling first.

Explicitly NOT recommended: bundle splitting (§4), query optimisation or new
indexes (§2), connection pooling changes (§3). All three were measured and all
three are dead ends for this symptom.

---

# ADDENDUM, 2026-09-12 — the p95 §7 said did not exist, and the shape of the tail

§7 named an instrument gap: *"there is no real page-load p95 for Forgenta itself"*.
That gap is now closed. The first attempt returned an empty result and the field
names were wrong, not the data — `edge_logs` holds 554 rows and the keys are
`request.path` and `response.origin_time`, not `path`/`origin_time`. An empty result
and a wrong query look identical, which is why the schema was probed before the
emptiness was believed.

## Per-path latency for Forgenta's own tables (edge_logs, 24 h)

| path | calls | avg | **p50** | **p95** | max | 504s |
|---|---|---|---|---|---|---|
| `/rest/v1/profiles` | 33 | 1016 ms | **347 ms** | **5082 ms** | 6008 ms | **2** |
| `/rest/v1/user_subscriptions` | 10 | 1665 ms | **348 ms** | **5133 ms** | 5161 ms | **2** |
| `/rest/v1/transactions` | 3 | 1098 ms | 896 ms | 2216 ms | 2363 ms | 0 |
| `/rest/v1/accounts` | 39 | 111 ms | **18 ms** | 227 ms | 2389 ms | 0 |
| `/rest/v1/synced_transactions` | 10 | 688 ms | 98 ms | 2388 ms | 2427 ms | 0 |

**`profiles` is 347 ms at the median and 5082 ms at p95 — a 14.6× spread.** The mean
of 1016 ms describes neither. This is precisely the number the word "sometimes"
was asking for, and precisely what an average was hiding.

## The tail is BIMODAL, not long — which changes the diagnosis

Across the four tables above (85 requests with a timing):

```
        <250ms   59   (69%)
   250ms – 1s    12   (14%)
      1 – 2.5s    8    (9%)
    2.5 – 4.5s    1    (1%)   <- the middle is EMPTY
       >= 4.5s    5    (6%)   <- pinned at the gateway ceiling, 2 of them 504
```

**One request in the entire 2.5–4.5 s band.** A degraded-but-working instance
produces a smooth tail; this produces *fast, or stuck against a ~5 s ceiling*. So the
better statement of the condition is not "the instance is sometimes slow" but
**"a small fraction of requests stall until the gateway gives up, while the rest are
fast"** — which is a different thing to fix and a different thing to measure.

§6's burst-credit explanation remains the best-supported cause and remains
**inferred**. This addendum sharpens the SHAPE of the symptom; it does not confirm
the cause.

## Why the Dashboard feels it more than any single number suggests

`essentialLoading` waits on the slowest of THREE requests (transactions, accounts,
profile). If roughly 6% of requests stall to the ceiling, the chance that at least one
of three does is:

* **~17%** if the stalls are independent
* **~6%** if they are correlated — i.e. the instance stalls and all three hit it together

⚠️ **Independence is assumed for the upper figure and is probably wrong**, since a
shared-instance stall would bunch. So the honest range is **6–17% of Dashboard opens
showing the skeleton for ~5 seconds**, and the truth is likely nearer the bottom.
Stated as a range because the sample cannot separate the two cases.

## What this does and does not license

* It **raises the confidence** in recommendation §8.1 (let widgets resolve
  individually): `accounts` has an 18 ms median and is gated behind `profiles`, whose
  p95 is 5082 ms. A tile that could paint in 18 ms waits up to 5 s for a neighbour.
* It does **not** license a fix aimed at latency in general. The median is already
  fine; making fast requests faster addresses nothing Tre reported.
* ⚠️ **The sample is small — 85 timed requests over 24 h, and `transactions` has only
  3.** The percentages are indicative, not a rate. Do not quote 6% as a measured
  failure rate; quote it as what 5 of 85 looked like in one day.

---

# ADDENDUM 2, 2026-09-12 — §8.1 is TOO BROAD, and the safe slice is much smaller

§8.1 said "let widgets resolve individually instead of behind one shared gate". Scoped
against the code, **that recommendation is wrong for most of the Dashboard**, and
implementing it as written would ship money computed from a half-loaded profile.

## Why most tiles genuinely need the slow input

`essentialLoading = txnLoading || acctLoading || profileLoading` (`Dashboard.tsx:307`),
and `profiles` is the path with the 5082 ms p95. But `profile` is not decoration — it
is load-bearing for the money itself:

| line | use | what breaks if it renders early |
|---|---|---|
| 309 | `buildPayConfig(profile)` | every paycheck-derived figure |
| 570 | `resolveCashFloor(profile)` | the floor every warning compares against |
| 990, 1042 | `isManualCashFloor(profile)` | which floor components apply |
| 330 | `profile.default_deposit_account` | which account the forecast funds from |

Rendering those tiles before `profile` lands does not show a partial answer. It shows
a **confident wrong one**, computed from an absent pay schedule and an absent cash
floor — the exact defect class this repo has caught four times with `?? 0`. So
"progressive widgets" is NOT a free win on the Overview panel, and anyone who reads
§8.1 alone will build it that way.

## The slice that IS safe, and it is one condition

The Dashboard's tab state is **persisted** (`usePersistedState('tre:dashboard:activeTab')`),
so whoever last used the Accounts tab lands there on every open. And that panel is:

```tsx
{activeTab === 'accounts' && (
  <Suspense fallback={<div className="h-64" />}><Accounts embedded /></Suspense>
)}
```

`Accounts embedded` is lazy-loaded and **owns its own nine queries** — the comment
above it says so, and it reads neither `profile` nor `transactions` from Dashboard
scope. Yet the early return at `Dashboard.tsx:1485` replaces the WHOLE page with a
skeleton, so that panel waits on a `profiles` fetch whose p95 is 5 s and a
`transactions` fetch it never reads.

**So the honest scope is: do not gate a panel on inputs it does not consume** — not
"resolve every widget individually". Concretely, the skeleton branch needs to be
conditional on the Overview panel being the one in view, with the tab bar rendered
above it either way.

## Why it is NOT shipped in this commit

It changes the first paint of the busiest money page, and this desk has no browser —
the Chrome extension is not connected here. A change of that shape is exactly what
"look at a rendered frame" exists for: a string comparison cannot see a header that
now paints without its greeting, a panel that shifts, or a skeleton that flashes.
Sam's session has a working extension and has offered to drive.

**Ready to build the moment a browser is available.** What the pass must assert is a
CHANGE, not the absence of an error: with `profileLoading` still true and the tab set
to Accounts, the Accounts panel is IN THE DOCUMENT — and with the tab set to Overview
it is still the skeleton, because that half must not regress.

---

# ADDENDUM 2, 2026-09-13 00:58 UTC — the re-measure after the dedupe, and it says my fix was aimed wrong

The coalescer (`c0b1a18b`) deployed to production at **00:38:20 UTC**. This is the
re-measure it was supposed to be judged by, reported the way it fell rather than the
way it was hoped.

## 1. The headline: p95 did NOT improve, and it CANNOT yet be attributed

| window | `/rest/v1/profiles` p50 | p95 | calls |
|---|---|---|---|
| 2026-09-11 baseline (§ addendum 1) | 347 ms | **5082 ms** | 33 |
| 2026-09-12 17:00 – 2026-09-13 01:00 | 214 ms | **6549 ms** | 206 |

**Worse, not better — but the post-deploy sample is 4 requests at 00:41 and ~16 at
00:58.** That is nowhere near enough for a p95, so the honest statement is *not
attributable yet*, not *no improvement*.

⚠️ **I nearly reported "zero post-deploy traffic".** A `having calls >= 5` in my own
query filtered the post-deploy rows out, and an empty result looked exactly like an
idle app — the same trap § addendum 1 recorded about `edge_logs` field names, walked
into from the other direction. A direct `countIf` showed **30 rows since the deploy, 4
of them `profiles`**. Check the filter before believing the emptiness.

## 2. THE FIX IS AIMED AT THE WRONG PATTERN — measured, from the request strings

Post-deploy, one page load issues these **within 6 milliseconds of each other**:

```
00:41:19.410  ?select=trusted_devices&user_id=eq.<uid>      1004 ms
00:41:19.411  ?select=*&user_id=eq.<uid>                     996 ms
00:41:19.412  ?select=timezone&user_id=eq.<uid>             1002 ms
00:41:19.416  ?select=onboarding_completed&user_id=eq.<uid>  992 ms
```

`coalesce()` keys on **column + user id**, so those are FOUR DIFFERENT KEYS and it
collapses **none** of them. The primitive is correct and its tests are honest; it is
simply pointed at duplication that does not occur. Duplicate *identical* reads are not
what this app does — **four different single-column reads of one row** are.

**And three of the four are redundant outright:** `?select=*` already returns every
column the other three ask for. The fix is not deduplication, it is making those
helpers read the profile the app has ALREADY fetched (`['profile', userId]`) instead
of issuing their own request.

## 3. A genuine identical-duplicate, which the coalescer WOULD collapse

```
00:58:25  ?select=id&referred_by=eq.<id>   x6 in one burst
```
Six byte-identical requests. That is the referral count on Settings, and it does not
go through `coalesce()`. Cheap, unambiguous next fix.

## 4. My own noisy-neighbour hypothesis is DISPROVED, and it was attractive

`/rest/v1/reddit_scout_pending_runs` — an unrelated workload on this instance — ran
**72 calls, p50 5194 ms, 49 of them 504s**. It looks exactly like the cause. It is not:
that traffic **stopped at 06:00 UTC** and the stalls continue all evening without it.
Recorded because the next person will find it and reach the same wrong conclusion.

## 5. What IS solid, and it is bigger than `profiles`

Over 17:00 – 01:00 UTC, with no reddit_scout traffic:

| path | calls | p50 | **p95** | ≥ 4.5 s |
|---|---|---|---|---|
| `/rest/v1/profiles` | 206 | 214 ms | **6549 ms** | 28 (13.6 %) |
| `/rest/v1/accounts` | 32 | 550 ms | **6713 ms** | 7 |
| `/rest/v1/debts` | 23 | 932 ms | **6742 ms** | 6 |
| `/rest/v1/savings_goals` | 23 | 1375 ms | **6746 ms** | 5 |
| `/rest/v1/user_subscriptions` | 16 | 508 ms | **6833 ms** | 4 |

**Five tables of wildly different size and shape share a p95 within 284 ms of each
other.** That is a shared ceiling, not per-table cost — and `accounts`, which was
**p50 18 ms / p95 227 ms** on 09-11, is now 550 ms / 6713 ms. Whatever this is, it is
instance-wide and it got worse; no change to `profiles` can fix it.

**`profiles` is no longer the worst offender** — it now has the lowest p50 and the
lowest stall rate of the five, on six times the volume. The framing that made it the
target no longer holds. (The other four have 16–32 calls each, so their *rates* are
noisy; the p95 agreement is the robust part.)

## 6. What this means for the upgrade decision

The free-plan shared-compute story remains **a hypothesis that fits, not a
measurement** — nobody has measured contention, and the project reports
`ACTIVE_HEALTHY` on Postgres 17.6. What is now stronger is that the effect is
instance-wide rather than query- or table-specific, which is more consistent with
shared compute than it was before. It is still not proof.

**Do not pay yet.** The attributable client-side work — §2 and §3 above — has not been
done, and paying first buys an improvement nobody can attribute.
