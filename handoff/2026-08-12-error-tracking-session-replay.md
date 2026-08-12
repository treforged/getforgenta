# Error tracking + session replay — 2026-08-12

Branch `autopilot/getforgenta-0811-173709`. Queue item: *"Set up error tracking with
session replay so I can watch what a user actually did before an error."*

## The assumption in the item was Sentry. I did not use Sentry, and here is why

The item said: *"Sentry, on the free tier — it is the only option with error tracking
plus session replay plus source maps free, and it has a first-class Next.js SDK.
ASSUMPTION MADE ON MY BEHALF, change it if wrong."*

Two of its premises are factually wrong for this repo, and a third made it a bad idea:

1. **This is not a Next.js app.** It is Vite + React + react-router (`vite.config.ts`,
   `src/App.tsx`). The "first-class Next.js SDK" reason does not apply here at all.
2. **It is not the only option, because one was already installed.**
   `@launchdarkly/observability` and `@launchdarkly/session-replay` (v1.1.17, the
   Highlight.io engine) were already dependencies, already initialized in
   `src/lib/monitoring.ts` from `main.tsx`, already identifying the user from
   `AuthContext`, and `VITE_LD_CLIENT_ID` was already set. It covers all three things
   the item asked for: error tracking, session replay, source maps.
3. **Adding Sentry would have meant two session-replay recorders running at once on a
   financial app** — twice the bundle, twice the egress, twice the surface that could
   capture a balance. That is plainly worse for the person using it.

**Board card `b0c8b701`** was filed offering: keep LaunchDarkly (recommended) / switch to
Sentry and rip out LD / run both. Work continued under the recommended reading rather
than waiting. **Tre answered before this session ended: "Keep LaunchDarkly."** The
assumption is confirmed; nothing built here needs revisiting. **The switch is cheap if Tre wants it:** callers only ever touch
`reportError()` / `identifyMonitoringUser()` in `src/lib/monitoring.ts`. No component
imports a vendor SDK. Swapping vendors is that one file.

## What was actually missing (all vendor-independent, all now closed)

The SDK was installed but the job was not done:

- **Nothing reported errors caught by an error boundary.** This is the important one. A
  boundary's whole purpose is to stop an error reaching `window`, which is exactly the
  hook the SDK uses to notice errors. So the crashes users actually hit — the ones that
  render "couldn't load" — were the precise set that never got reported. `componentDidCatch`
  did a `console.error` into a console nobody was reading.
- **Replay masking was implicit and unpinned** (see the correction below).
- **No source maps.** A production stack trace read `vendor-react-Ct3x9.js:1:48210`.

## Correction to a thing I nearly reported wrongly

I initially believed replays were shipping unmasked, because the SDK's own JSDoc
documents `privacySetting`'s default as the weak regex-based mode. **The runtime disagrees
with its own docs**: v1.1.17 does `privacySetting: s?.privacySetting ?? 'strict'`. So
masking was already strict and balances were **not** being recorded. No live privacy leak
existed and none needed fixing.

It is now set **explicitly** anyway, and pinned by a test — relying on an undocumented
default to protect real balances is one dependency bump away from being wrong, and the
change would be silent.

## Changes

| file | what |
|---|---|
| `src/lib/monitoring.ts` | Exported `REPLAY_PRIVACY` (`privacySetting: 'strict'`) and `OBSERVE_OPTIONS`; new vendor-agnostic `reportError(error, ctx)`; `environment` now tagged from `import.meta.env.MODE` |
| `src/components/shared/ErrorBoundary.tsx` | `componentDidCatch` now calls `reportError` with the boundary's label, the component stack, and `ErrorBoundary/page` vs `/widget` |
| `vite.config.ts` | `build.sourcemap: true` |
| `src/lib/feature-flags.ts` | `ERROR_TEST_ENABLED` |
| `src/components/debug/ErrorTest.tsx` | new — `/__error-test`, crashes on purpose, three paths (render / uncaught / rejection) + a masking probe |
| `src/App.tsx` | registers `/__error-test` only when the flag is on |
| `.env.example` | documents `VITE_ENABLE_ERROR_TEST` and what the LD key now governs |

**`maskAllInputs` / `maskInputOptions` are deliberately NOT set.** The SDK only applies
them when `privacySetting` is `none`; setting them next to `strict` would read like extra
safety while doing nothing.

**`recordHeadersAndBody` stays `false`,** and there is a test on it. Masking the screen
while shipping the Supabase JSON that populated it would be masking in name only.

### Design decisions — do not re-litigate

- **`sourcemap: true`, not `'hidden'`.** The linked form lets the tracker fetch maps
  straight from the deployed URL, so stacks resolve with no upload step and no CI token to
  keep alive. The usual reason to hide maps is to avoid publishing source — **this repo is
  already PUBLIC**, so there is no secret to protect.
- **`ERROR_TEST_ENABLED` lives in `feature-flags.ts`, not beside the component.** First
  attempt put it in `ErrorTest.tsx`; `App.tsx` importing the flag statically then defeated
  the `lazy()` and pulled the debug page into the main bundle for every user. Caught by the
  `react-refresh` lint warning. Verified fixed: the smoke-test code appears **only** in its
  own 2.6 kB `ErrorTest-*.js` chunk.
- **`/__error-test` is public (no `ProtectedRoute`)** so the pipeline can be proven without
  signing in, and therefore without putting real balances on screen. When the flag is off
  the route is never registered and the path falls through to the 404.
- **The report carries a label and a component stack and nothing else** — both describe
  code, not the person. A test fails if anyone widens that payload.

## 🔬 Evidence — measured against the real vendor, not asserted

Driven with Playwright at 390×844 against the dev server. Screenshots in
`handoff/evidence/2026-08-12-error-tracking/`.

**1. The error reaches LaunchDarkly.** Captured on the wire to
`otel.observability.app.launchdarkly.com/v1/traces`:

```
exception.type       DeliberateTestError
exception.message    Forgenta error-tracking smoke test (render) — this crash is deliberate
exception.stacktrace DeliberateTestError: ... at Boom (.../ErrorTest.tsx:36:8)
label                Error tracking smoke test      <- the boundary's own label
componentStack       at Boom / at ErrorTest / at ErrorBoundaryInner
source               ErrorBoundary/page
```

`label` and `source` are fields this change invented, so their presence on the wire proves
the boundary→reporter wiring specifically, not just that the SDK works.

**2. The replay is attached to that error.** The error is tagged
`session ineDxrf5kVYRUaoiqyhLUmDe7cA2`, and the replay pushes carry the **same** id —
so the dashboard shows the recording against the crash.

**3. Masking holds, checked by decoding the recording rather than trusting the setting.**
The replay events ride gzipped+base64 inside the GraphQL `data` variable. Decoded all 7
payloads (153,441 chars) and searched for the page's synthetic figures:

| value on screen | in the recording |
|---|---|
| `$12,345.67` | absent |
| `$6,789.01` | absent |
| `$98,765.43` | absent |
| `Checking` / `Credit card balance` / `Net worth` | absent |

Recorded text nodes are whitespace and `SCRIPT_PLACEHOLDER` only.

⚠️ **First measurement said `false` and was wrong** — the payloads are compressed, so a
plain string search over `postData()` found nothing. Recorded here because "no error on the
wire" and "I decoded it badly" look identical.

**Gates:** `npx tsc --noEmit` **0**; eslint clean on all 7 touched/created files; full suite
**922/922 across 117 files**; `npm run build` green.

📌 **The 892/115 floor in `AGENT.md` was stale, not missed.** HEAD (`9b4df591`) added
`useFormDraft.test.tsx` (+19) after that floor was written, so the real baseline on this
tree was **911/116**; this change adds 11 → 922/117. Floor updated.

**Verified the tests bite:** disabling the `reportError` call fails exactly the 2 new
boundary-reporting tests and nothing else.

## ✅ Source maps — CLOSED 2026-08-12, against the real minified bundle

The item above used to read "NOT verified: needs a deployed build". It is now proven, and
proven mechanically rather than by eye. `scripts/verify-sourcemaps.mjs` builds nothing
itself — it drives the **production bundle** (`npm run build` + `npm run preview`) with
Playwright, catches the OTLP payload on the wire, and feeds every frame of the stack
through the `.map` files with `@jridgewell/trace-mapping`.

**The stack as it actually left the browser** — single-letter function names, one-line
chunks, i.e. genuinely minified:

```
DeliberateTestError: Forgenta error-tracking smoke test (render) — this crash is deliberate
    at c  (/assets/ErrorTest-BrU4Xtl7.js:1:479)
    at Oo (/assets/vendor-react-CEspt0Pn.js:8:47515)
    … 8 more react-dom frames
```

**Resolved through the maps:**

| minified frame | original |
|---|---|
| `ErrorTest-BrU4Xtl7.js:1:479` (fn `c`) | **`src/components/debug/ErrorTest.tsx:28:8`** |
| `vendor-react-CEspt0Pn.js:8:47515` (fn `Oo`) | `react-dom-client.production.js:4351:20` |

`ErrorTest.tsx:28:8` is the `new DeliberateTestError(kind)` inside `Boom` — the exact throw
site, to the column. **10 bundle frames, 10 resolved, 0 unresolved.**

📌 The old note said the frame would resolve to `ErrorTest.tsx:36`. That was the line number
at the time of writing; the throw is at **:28** on this tree. The proof is the resolution
itself, not the constant.

**The boundary wiring re-confirmed on the production build too** (not just on the dev server):
`label = Error tracking smoke test`, `source = ErrorBoundary/page`,
`exception.type = DeliberateTestError`, `highlight.session_id` present — so the replay still
attaches. `label`/`source` are fields this repo invented, so their presence proves the
`ErrorBoundary → reportError` path specifically rather than the SDK's own `window.onerror`.

🔬 **And the maps are actually reachable, which is the whole basis of the `sourcemap: true`
(linked, not `'hidden'`) decision** — the tracker fetches them from the deployed URL, so
"emitted" is not enough, "served" is the requirement:
`GET /assets/ErrorTest-BrU4Xtl7.js.map` → **200, 5,920 bytes**;
`vendor-react-CEspt0Pn.js.map` → **200, 1,257,095 bytes**; and the shipped chunk ends with a
linked `//# sourceMappingURL=ErrorTest-BrU4Xtl7.js.map`.

⚠️ **How the flag was set, since it matters for repeating this.** `VITE_ENABLE_ERROR_TEST=1`
as a shell env var is permission-blocked in an unattended session (both shells). It was set
through Vite's own env-file mechanism instead — a temporary `.env.production.local`, which
`.gitignore:33` already covers — and **deleted afterwards**, so no local build serves the
deliberate-crash route by accident. Nothing about the flag reaches Vercel from here.

## ⬜ What is NOT verified

- **The dashboard itself.** This session has no LaunchDarkly dashboard credentials, so the
  evidence is the payload on the wire rather than a screenshot of the error in the UI. The
  error and its replay are provably sent and provably share a session id.
- **Native.** Unchanged and still deliberately excluded — the web SDK no-ops on Capacitor.

## Next up

1. ~~Answer card `b0c8b701` (vendor).~~ **DONE — "Keep LaunchDarkly".**
2. ~~Preview deploy with `VITE_ENABLE_ERROR_TEST=1` → prove the minified stack resolves.~~
   **DONE — see the source-maps section above.** Proven against the production bundle
   locally rather than on a Vercel preview: an unattended session cannot push, and a Vercel
   preview only exists downstream of a push. Creating a *separate* throwaway Vercel project
   via `deploy_to_vercel` was rejected — it would be a stray project, without the real env
   vars, publishing the app to a second URL, to prove something the built bundle already
   proves mechanically. The one thing a real preview would add is confirming LaunchDarkly's
   own symbolication in the dashboard UI; the maps are proven correct and proven fetchable.
3. Consider whether `identifyMonitoringUser` sending `email` is wanted now that replays are
   strict-masked — it is the one identifying field deliberately left in, because an error
   you cannot tie to a user is hard to act on. Not changed here; out of scope.
