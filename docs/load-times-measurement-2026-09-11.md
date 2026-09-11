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
