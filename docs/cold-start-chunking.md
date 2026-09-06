# Cold start: 31 KB of code costing 18 seconds

Written 2026-09-06, after Tre asked *"why is the loading time so slow"*.
**Nothing is fixed by this document.** It records what was measured, four levers that do not
work and why, and what the remaining options actually are — so the next person does not repeat
four builds to learn the same thing.

## The measurement

Production cold start of `getforgenta.com`, read from the Navigation and Resource Timing APIs:

| | |
|---|---|
| TTFB | 116 ms |
| HTML complete | 243 ms |
| DOM interactive | 322 ms |
| load event | 572 ms |
| **Last resource finished** | **2311 ms** |
| JS requests | 46 |
| **Under 5 KB** | **36 of them — 31 KB of content between them** |
| **Their cumulative wait** | **18 seconds, median 554 ms EACH** |
| The three LARGEST files | 213 KB together, costing 133 / 96 / 175 ms |

**The app is not downloading too much. It is downloading too many times.** Per-request latency
dominates completely: 31 KB spread across 36 files costs far more wall clock than 213 KB in three.

⚠️ **Caching cannot fix this, and it is already on.** Every one of those 36 was a Cloudflare
`cf-cache-status: HIT`. The cost is the round trip, not the byte.

### The single most persuasive number

From the built output:

```
28 bytes   useSubscription-bVyWyjMo.js
139 bytes  utils-C17IDV1l.js
142 bytes  use-reduced-motion-CTVNRQzB.js
143 bytes  esm-BWMl4OCS.js
166 bytes  form-dismiss-YiGBMnje.js
```

**A 28-byte file costs a full network round trip — a measured median of 554 ms.** 25 chunks are
under 2 KB. Build totals: **98 chunks, 50 of them under 5 KB.**

## Where they come from — NOT lazy routes

There are only **9 dynamic `import()` / `lazy()` call sites** in the whole of `src/`. The tiny
chunks are **shared modules** that rolldown split out because two or more chunks import them. That
matters, because it rules out the obvious fix: reducing lazy boundaries would barely touch this.

## ⛔ FOUR LEVERS TRIED. NONE WORKS IN THIS VERSION. Do not retry them.

Vite **8.2.2**, bundling with rolldown. Baseline before each attempt: **98 chunks / 50 under 5 KB.**

| Lever | Result | How it failed |
|---|---|---|
| `codeSplitting.minSize` | **98 / 50 — unchanged** | Accepted and **silently ignored**. No warning. Verified by counting output, not by reading config |
| `advancedChunks.minSize` (as a sibling) | **98 / 50 — unchanged** | Build says: *"advancedChunks option is ignored because the codeSplitting option is specified"* — the two are mutually exclusive |
| Migrating the seven groups to `advancedChunks.groups` | **98 / 50 — unchanged** | Build says: *"advancedChunks option is deprecated, please use codeSplitting instead."* ⚠️ **The opposite of what was assumed** — `codeSplitting` is the current API here, not the legacy one |
| `output.experimentalMinChunkSize` | **98 / 50 — unchanged** | Build says: *"Invalid key: Expected never but received experimentalMinChunkSize"*. That is a rollup option; rolldown does not have it |

⚠️ **Every one of these was verified by COUNTING BUILD OUTPUT.** This config file already carries a
comment about `manualChunks` being silently ignored under rolldown, so "the option is set" was
never going to be evidence here. Two of the four produced no message at all.

## What is still open

1. **A newer Vite/rolldown that exposes a shared-chunk minimum.** This is a version problem, not a
   configuration mistake — the knob does not exist to be turned. Worth re-checking on upgrade,
   with the same count as the gate.
2. **HTTP/2 or /3 multiplexing** already applies on Cloudflare, and 46 requests still cost this
   much — so "the protocol handles it" is not an answer here; it was measured with it on.
3. **Reducing the number of SHARED modules** — a source change, not a config one, and the only
   lever currently available. A 28-byte shared chunk exists because exactly one small export is
   imported from two places; inlining a handful of those would remove whole round trips.

## ⚠️ The hazard any future attempt must clear

The last time this chunking config was wrong, **React was physically placed inside `vendor-charts`,
so the entry statically imported it and pulled ~412 KB of recharts into first paint on Landing and
Auth** — pages with no charts at all.

**The gate is not a chunk count. It is this:**

```
grep -c "vendor-charts" dist/index.html      # MUST be 0
```

Measured on the current build: **0**, and 14 chunks in the entry HTML. Every attempt above was
checked against it and none regressed it.

## Acceptance for a future fix

Three numbers, all from `dist/` and none of them "looks faster":
- total chunk count **below 98**
- chunks under 5 KB **below 50**
- `vendor-charts` in `dist/index.html` still **0**

Then re-measure the cold start on production and compare the sub-5 KB cumulative wait against the
**18 seconds** recorded here.
