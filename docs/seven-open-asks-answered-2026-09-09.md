# Seven asks Tre typed and never got an answer to — answered 2026-09-09

Found by cross-checking all 197 asks he typed since 09-04 against `claudecontext/asks.md`.
Every claim below was **measured today**, against the live site, the live database, or the
live connector — not recalled from a handoff.

**Two of the seven turned out to be already fixed.** They are recorded as verified rather
than rebuilt, which is the whole point of checking first.

---

## 1. "shouldnt getforgenta reject scrapers?" (09-05)

**No. And the premise underneath it — that the Cloudflare request spike was scrapers — is
almost certainly false.**

### The spike was his own cache configuration, not bots

The number that prompted the question was **90.89k Cloudflare requests against ~10k
pageviews at a 0.45% cache hit rate** — about **nine uncached requests per pageview**.
That is the signature of a many-small-files build being re-fetched, not of a crawler.

`index.html` eagerly loads one entry script plus 13 `modulepreload` links, and those hashed
assets were being served with `max-age=14400, must-revalidate` — four hours, then
revalidate, on files whose names carry a content hash and can never change. **Fourteen
conditional requests per returning visitor for bytes that are provably identical.**

That was fixed on 09-06 (`dc88b9f1`): hashed assets now carry
`max-age=31536000, immutable`, read back off the live site rather than off the config.

⚠️ **NOT VERIFIED: that the request count actually fell.** Confirming it needs the
Cloudflare dashboard, which this desk has no credential for and deliberately did not
reach for one scoped to something else. The mechanism is measured; the outcome is not.
**Look at Cloudflare's request graph for 09-06 onward before believing this paragraph.**

### There is nothing to scrape, measured today

```
curl -A "python-requests/2.31"  https://getforgenta.com/debt   → 200, 5,289 bytes
curl -A "Scrapy/2.11"           https://getforgenta.com/debt   → 200, 5,289 bytes
curl -A "GPTBot/1.0"            https://getforgenta.com/       → 200, 6,227 bytes
curl -A "curl/8.0"              https://getforgenta.com/demo   → 200, 5,289 bytes
```

Every one of those is **the same empty HTML shell**. This is a client-rendered app: every
real number is fetched afterwards from Supabase with the signed-in user's own token, under
Row Level Security. A scraper gets the shell and stops. There is no data behind the wall
for a crawler to take, because the crawler never has a session.

### What is actually defending the app, verified in the repo

- **Row Level Security** on every table — the real boundary, and the only one that matters.
- **Rate limiting on 17 edge functions** (`supabase/functions/_shared/rate-limit.ts`).
- **Cloudflare Turnstile** (`verify-turnstile`, `src/components/shared/TurnstileWidget.tsx`).
- `public/robots.txt` already keeps signed-in routes out of search results as hygiene, and
  says in its own header that it is advisory and stops nothing hostile.

### The one thing worth doing, and it is small

⚠️ **Four edge functions carry no rate limit**: `plaid-sync`, `plaid-sync-all`,
`financial-sync`, `push-send`, and `public-build`. `public-build` is the one to look at
first — it is a **public read surface by design** (`/builds/share/:token`), so it is the
only endpoint on the app an unauthenticated caller can hit in a loop and get real content
back from. That is a rate-limit gap, not a scraper problem, and it is a one-file change.

**Recommendation: do nothing about scrapers. Add a rate limit to `public-build`.**

### ✅ DONE AND VERIFIED LIVE, later the same day — `e63c72fe`

This section originally ended "named, not built", and the section at the bottom of this file
said so too. **It is built and deployed**, so both are corrected here rather than edited away.

`public-build` now carries a 60/minute per-IP limit, placed after the UUID check so a malformed
token costs no limiter round trip. Deployed with `supabase functions deploy public-build`.

**Pressed, not assumed** — 70 live calls against the deployed function:

```
404 × 59   then   429 × 11
```

Exactly the configured limit. The three controls are unchanged after the deploy — unknown-but-
valid UUID `404`, malformed `404`, absent `404` — so the function still works and the new import
resolved.

⚠️ **Still not an enumeration fix**, and the code comment says so at length. Enumeration was
already closed; this protects cost and abuse. **And it fails open** by design, so it is a brake
rather than a gate.

⚠️ **Measured, and it contradicts `robots.txt`:** that file claims "Cloudflare Bot Fight
Mode and its managed ruleset" are on. Bot Fight Mode challenges non-browser automation, and
**Scrapy, curl and python-requests all got a clean 200 with the full body today.** So Bot
Fight Mode is either off, or not applying to these paths. **The claim in `robots.txt` is
unverified and should not be repeated until somebody opens the Cloudflare dashboard.** It
does not change the recommendation — there is still nothing to take — but a defence written
down as on and actually off is worse than no defence, because it stops anyone looking.

---

## 2. "is there a way to hide my debt calculation code from the public? would it be
beneficial?" (09-06)

**Yes, there is a way. No, it is not worth doing — and it would buy nothing at all in the
state the project is in today.**

### There are two doors, and closing one changes nothing

| Door | State today, verified |
|---|---|
| **The GitHub repository** | `gh repo view` → **PUBLIC**. `src/lib/credit-card-engine.ts` is readable by anyone. |
| **The deployed source map** | `GET /assets/index-*.js.map` → **200, 1,189,248 bytes**, with `sourcesContent` and 91 sources including `../../src/lib/*.ts`. **The original TypeScript is downloadable from his own domain.** |

**Both are open. Closing either one alone accomplishes exactly nothing**, because the other
still serves the same code. That is the honest core of the answer, and it is the reason
this is a decision rather than a config change.

### Even with both shut, a client-side calculator cannot be hidden

The debt engine runs in the user's browser. Minified and map-less, it is harder to read —
it is not hidden. Anyone sufficiently motivated reads the minified bundle or watches the
inputs and outputs. **The only way to genuinely hide it is to move the calculation to the
server**, which costs a round trip on every re-simulation and would make the Dashboard's
live card projection noticeably worse for every honest user.

### Would it be beneficial? No — and here is the case for it anyway, so it is a real choice

The case FOR: the payoff-ordering and floor-protection logic is the most differentiated
thing in the app, and a competitor could lift it verbatim.

The case AGAINST, which wins:
1. **A public repo is an asset at this stage, not a liability.** 31 users and zero signups
   in 30 days — the binding constraint is that nobody knows the app exists. Obscurity is
   not the problem being solved.
2. **The logic is not the moat.** The moat is the bank connections, the data, and the fact
   that it is already running. Anyone who copies `credit-card-engine.ts` still has no
   users, no Plaid integration and no App Store listing.
3. **It costs live debuggability on a money app.** Linked maps are what lets LaunchDarkly
   Observability resolve a production stack trace without an upload step or a CI token.

### If he wants it anyway, this is the cheapest real option and nobody has costed it

There is a middle option the 09-06 doc did not consider: **keep the map linked but strip
`sourcesContent`** (`build.rollupOptions.output.sourcemapExcludeSources`). Stack traces
still resolve to file and line; the original TypeScript stops being served. One config
line, fully reversible, no CI token.

⚠️ **UNMEASURED — do not treat this as a recommendation yet.** Two things need testing
before it is: whether rolldown-vite 8 honours that option, and whether LaunchDarkly
Observability still renders a useful trace without the source text. **And it is pointless
while the repo is public**, which is the decision that has to come first.

**Recommendation: leave it exactly as it is. Revisit only if he makes the repo private,
and then take the `sourcesContent` option, not the "turn maps off" one.**

---

## 3. "this lesson says its in settings but its not, its in the debt tab" (09-05)

**✅ ALREADY FIXED, 2026-09-05.** Verified, not rebuilt.

`supabase/functions/_shared/learn-lessons.ts:62` carries the tombstone: *"WAS 'Open Settings
and set your cash floor' UNTIL 2026-09-05. The control is on the DEBT tab."*
`grep -i settings` over the whole catalogue returns only the two comment lines recording the
fix. No lesson body says Settings.

---

## 4. "where is the achievements section?" (09-05)

**✅ ALREADY BUILT, 2026-09-06, and it IS reachable.** Verified against the caller, because
four features this week were built, exported and never wired to anything.

- Registered: `src/lib/dashboard-widgets.ts:98`, id `achievements`.
- In the default layout: `DEFAULT_LAYOUT` maps every entry in `WIDGET_META`, so it is
  visible for every user who has not deliberately hidden it.
- **Mounted**: `src/pages/Dashboard.tsx:1509` renders `<TrophyCase />`.
- Live data: **5 badges across 4 users**, so it has something to show.

**Where it is, in words he can use: Dashboard → Overview tab → scroll to the bottom, under
Learn.** That placement is deliberate — the badges are earned in Learn, so the case sits
next to them.

⚠️ **The likely reason he could not find it: the widget stack renders on the Overview tab
ONLY.** On the Accounts tab the whole stack is absent, which looks identical to a missing
feature. That has now cost a debugging session once before.

---

## 5. "we need retentions still btw" (09-05)

**Proposal, not a build — and the measurement argues for something other than what he
asked for.**

### The live numbers, read today from `auth.users`

| | |
|---|---|
| Total users | **31** |
| Active in 7 days | **2** |
| Active in 30 days | **4** |
| Ever returned after day one | **9** |
| **New signups in 30 days** | **0** |

### ⚠️ The finding that changes the priority: push reaches ONE person, and it is him

Push infrastructure shipped — `push-send` deployed, `device_tokens` table live, **7 send
runs recorded**. It looks done.

**`device_tokens` holds 9 tokens belonging to exactly 1 user.** All of them were minted on
09-05 and 09-06, and none since.

**A push token is only minted when the user opens the app.** The 23 dormant users have not
opened it, so they have no token, and no amount of send-side work will give them one.
**Push cannot reach a dormant user by construction** — which is precisely the correction
that was made about *local* notifications on 09-05, one layer up, and it has now happened
again to the thing built to fix it.

This is not an argument that push was wasted. It is the retention lever for everyone who
comes back at least once. It is an argument that **it is not the lever for the 23**, and
nothing currently in flight is.

### What I would actually do, in order

1. **Reach the 23 by email, by hand.** 23 people is small enough to write to individually,
   and email is the only channel that reaches somebody who has not opened the app. This is
   the highest-value retention action available and it needs no code.
   ⚠️ **Outward-facing, in his name — his to send, not this desk's.** Drafting is mine.
2. **Fix acquisition before retention.** Zero signups in 30 days means the funnel is dry.
   Retaining 9 people harder cannot grow anything. Retention work compounds only on top of
   arrivals; today it compounds on nothing.
3. **Then the returning-user levers, which are cheap and already half-built:** the streak
   chip promoted out of the Learn widget, and push for people who do come back.

**I did not build any of this.** The brief said propose, and the measurement says the thing
he asked for is third in line behind two things he did not.

---

## 6. "is Robinhood, or Plaid via the connector, able to differentiate the agentic account
from the human personal one?" (09-05)

**Robinhood: yes, completely — they are two separate accounts. Plaid: not today, and not
by that name ever.**

### Robinhood — measured live through the connector

His Robinhood login holds **two brokerage accounts**, not one account with a mode:

| | Account | Type | Agent access |
|---|---|---|---|
| Personal | ••••6715 (default) | margin, options level 2 | **read-only to an agent** |
| "Agentic" | ••••3158 | cash, $503.96 unsettled | **the one an agent may trade** |

The separation is **structural**, not a permission flag on a shared pot: different account
numbers, different account types, separate balances. Exactly one account is reachable by an
agent, and the connector marks which. An agent cannot place an order against the personal
margin account at all.

**So the answer to what he was really asking — can an agent touch my personal money — is
no. It is a different account.**

### Plaid — no, and the reason is one line of config

`supabase/functions/plaid-create-link-token/index.ts:194` requests **`transactions`**, with
`liabilities` optional and `balance`. It does **not** request the `investments` product.

**So Forgenta cannot see either Robinhood account today.** The question never arises,
because no brokerage account reaches the app by that route.

And if `investments` were added: Plaid would return **two accounts with different masks,
names and subtypes**, so Tre could tell them apart by identity — but Plaid has **no concept
of an agentic account** and would never label one. He would be distinguishing them by
nickname and mask, the same way he does in the Robinhood app.

---

## 7. Lump-sum transfers — the design fork

**This one genuinely needs his answer.** It is in `handoff.md` under "Actions for Tre",
worded so that one line settles it.

---

## What was NOT done, and why

- **Nothing outward-facing.** The 23-user email is drafted nowhere and sent nowhere.
- **No Cloudflare change**, and no reach for a Cloudflare credential this desk does not own.
- **No source-map change.** It is a fork with a real cost on a money app, and the repo
  being public is the decision that comes first.
- ~~**The `public-build` rate limit is named, not built.**~~ **CORRECTED — it was built,
  deployed and verified live the same day (`e63c72fe`).** See the section above. The four
  other unlimited functions (`plaid-sync`, `plaid-sync-all`, `financial-sync`, `push-send`)
  are all authenticated, so they stay named rather than built.
