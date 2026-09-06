# The original TypeScript is downloadable from getforgenta.com

Measured 2026-09-06 against the LIVE site, not against a local build.

## The finding

```
GET https://getforgenta.com/assets/index-B3KJm5MQ.js       200   292,659 b
GET https://getforgenta.com/assets/index-B3KJm5MQ.js.map   200 1,132,772 b
```

That map has **`sourcesContent: true`** and **91 sources**, including `../../src/lib/*.ts`. So it
does not merely map line numbers — **it carries the original TypeScript, and anyone can download
it.**

**This is the real answer to Tre's question "is there a way to hide my debt calculation code".**
The public repo is the lesser half. Making the repo private would change nothing at all while
this is true, because the source is served from his own domain either way.

Across the whole build: **97 `.map` files, 14,252,363 bytes** — versus 3,708,778 bytes of actual
shipped JS and CSS. **The maps are roughly FOUR TIMES the size of the app**, and every deployment
stores all of them, which feeds directly into the 10 GB Deployment Storage cap that emailed him
tonight.

## ⚠️ IT IS NOT A FREE WIN, AND MY FIRST READ OF IT WAS WRONG

I nearly set `sourcemap: false` on the grounds that nothing consumes the maps. **That was wrong,
and it was wrong because I grepped for the wrong vendors** — `sentry`, `bugsnag`, `rollbar`,
`datadog`. The `rollbar` hits that came back were **the word "scrollbar"**, and the Sentry hits
were a comment explaining why Sentry was NOT adopted.

There IS an active error tracker: **LaunchDarkly Observability (the Highlight.io engine)**,
initialised in `src/lib/monitoring.ts`, doing error tracking AND session replay on a financial app.
The existing comment in `vite.config.ts` is accurate: the LINKED map form is what lets that tracker
resolve stack traces straight from the deployed URL, with no upload step and no CI token.

So turning maps off trades **IP exposure** against **production debuggability on a money app**.
That is a genuine fork, not a tidy-up, and it is not being decided from this desk.

## The options, with what each costs

| | Source public? | Stack traces resolve? | Storage saved |
|---|---|---|---|
| **A. Keep `sourcemap: true`** (today) | **Yes — full TypeScript** | Yes, automatically | none |
| **B. `sourcemap: false`** | No | **No — minified stacks only** | ~14.25 MB per deploy |
| **C. `'hidden'` + upload maps to LaunchDarkly at build** | No | Yes | ~14.25 MB per deploy |

**C is the one that actually serves both**, and it is the recommendation. It costs a build step and
a CI token to keep alive — which is precisely the cost the current comment was written to avoid, so
this is a reversal of a deliberate earlier decision and should be made knowingly.

## ⚠️ This is NOT a page-load fix — do not sell it as one

Browsers fetch a `.map` only when devtools is open. **A normal visitor never downloads those
14 MB**, so none of the above makes the app load faster for anyone. It is a code-exposure fix and a
deployment-storage fix. Saying otherwise would be exactly the kind of confident wrong number this
repo keeps catching.

## What the page-load numbers actually say

Measured from `npm run build` and the live `index.html`:

- **99 JS files + 1 CSS** in `dist/assets`. Cloudflare reports **90.89k requests against ~10k
  pageviews at a 0.45% cache hit rate** — about nine uncached requests per pageview, which is the
  same many-small-files shape seen from the CDN side.
- `index.html` eagerly loads **one entry script (292 kB, 86 kB gzipped)** plus **13
  `modulepreload` links**.
- The heaviest chunks are `vendor-charts` (409 kB / 115 kB gz), `vendor-react` (229 kB / 73 kB gz)
  and `vendor-supabase` (208 kB / 54 kB gz).
- ⚠️ The build also warns: `@capacitor/browser` is dynamically imported by `src/lib/purchases.ts`
  **but statically imported by `App.tsx`, `PlaidLinkButton.tsx`, `Auth.tsx` and `Builds.tsx`**, so
  the dynamic import does nothing and the module cannot be split out.

**The cache hit rate is the biggest lever and it is a SERVER/CDN setting, not a code change** —
hashed asset filenames are immutable and should be cached hard. That is the next thing to measure,
and it is where the answer to "is it a coding thing or a server thing?" currently points: **server.**

---

## ✅ SHIPPED AND VERIFIED — hashed assets are now `immutable`

`dc88b9f1`, deployment `getforgenta-gb0bp7lyy` (READY, 11s).

**Before**, measured on the live site:

```
GET /assets/index-B3KJm5MQ.js
Cache-Control: public, max-age=14400, must-revalidate
```

Four hours, then revalidate — on files whose names carry a content hash and can never change. With
one entry chunk plus 13 `modulepreload` links, that is **14 conditional requests per returning
visitor for bytes that are provably identical**.

**After**, read back off the live site rather than off the config:

```
GET https://getforgenta.com/assets/index-B3KJm5MQ.js?cb=<random>   (Cache-Control: no-cache)
Cache-Control: public, max-age=31536000, immutable
cf-cache-status: MISS
```

### ⚠️ The first verification LOOKED LIKE A FAILURE and was not

The plain request after deploying still said `max-age=14400` — with `cf-cache-status: HIT` and
`Age: 785`. That was **Cloudflare replaying a copy it had cached before the deploy**, not the new
header failing to apply. Two things separated it:

1. The **origin** `*.vercel.app` URL returns `302` (deployment protection), so it cannot be used as
   the control here.
2. A **cache-busted** request through Cloudflare returned the new header immediately.

**A stale CDN copy and a change that did not take look identical from the outside.** Bust the cache
before concluding a header did not apply — the same family as reading truncated output as absence.

**No Cloudflare dashboard change is needed.** The commit hedged that Browser Cache TTL might be
overriding at a fixed 4 hours; the cache-busted read disproves it — Cloudflare is respecting the
origin's headers. That hedge is withdrawn.

`index.html` keeps `max-age=0, must-revalidate`, which is what makes the long asset TTL safe: the
HTML is always fresh and it is what names the new hashes.

**Honest scope:** this helps RETURNING visitors and the request count Cloudflare is reporting. It
does nothing for a first-time visitor, whose cost is the bytes themselves — `vendor-charts`
(115 kB gz), `vendor-react` (73 kB gz) and `vendor-supabase` (54 kB gz). That is the next lever, and
it is a code change rather than a header.
