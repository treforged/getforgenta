# Cloudflare move plan: web hosting, private math, CI off GitHub minutes (ask 8a5268d9, decision f54c3e7a)

Ada, cloud session, 2026-10-08. **Planning and prep only.** Nothing in this document has changed
repo visibility, DNS, Vercel, Cloudflare, production or pricing. Branch `claude/cloudflare-8a5268d9`.

Tre, 2026-10-08: *"I want to keep the code for my app, especially with all the calculations, more
private, so I want to move that to Cloudfare. same for other items that I plan on selling ... some
actions can be ran on my PC if my PC is on, that way it doesn't use the minutes."*

## 0. Read first: what each step actually buys

| Step | Hides the source on GitHub | Hides the math from a user's browser | Costs Actions minutes |
| --- | --- | --- | --- |
| Make the repo private | yes | **no** | **yes**: see 0.2 |
| Serve from Cloudflare instead of Vercel | no | **no** (same bundle, different host) | no |
| Stop publishing source maps (0.1, **done**) | n/a | **most of it**: names, comments and file layout | no |
| Move engines into server functions (section 2) | n/a | **yes, for what moves** | no |

**Moving the host to Cloudflare does not make anything private on its own.** It is worth doing for
the free Git build (no Actions minutes) and because DNS is already there. Privacy comes from 0.1
and section 2.

Also found: the Vercel project builds on **Node 24.x** while `package.json` `engines` requires
`>=22 <23` and CI pins 22. Set Workers Builds to Node 22 at cutover.

### 0.1 The source maps: DONE (Tre: "yes", 2026-10-08; commit cb2d25d on main)
Until 2026-10-08, `vite.config.ts` had `build.sourcemap: true`, which emitted **and linked** `.map`
files on the live site, publishing every original `.ts` file to anyone with devtools, comments
included (some quote Tre's own balances). `cb2d25d` sets `sourcemap: false`; its production Vercel
deployment is READY. `'hidden'` would not have been enough, because Vite still writes the files and
Vercel serves them.
Verified here on 2026-10-09 from a clean `origin/main` build: **0 `.map` files, 0 `sourceMappingURL`
annotations** (the single text hit is a string inside a bundled library's map parser).
Old Vercel deployment URLs (`*.vercel.app`) still hold the old maps, but the project's
`ssoProtection` is `all_except_custom_domains`, so those URLs need a Vercel login.
Not verified from this container (Cloudflare's bot challenge answers every request to
getforgenta.com): whether Cloudflare's edge still caches an old `/assets/*.map`. Those were served
with a one-year `immutable` header. **⚑ Tre: Cloudflare → Caching → Purge Cache → Custom Purge, prefix
`getforgenta.com/assets/`** (safe: the asset names are content-hashed, so the next request refills
from Vercel). Cost of the change: production stack traces name minified chunks again
(`scripts/verify-sourcemaps.mjs` can no longer pass until maps are uploaded to the tracker privately).
Already-copied maps (archives, scrapers) cannot be recalled, and while the repo is public the same
source is on GitHub anyway. The change starts paying off at the private flip.

### 0.2 Making the repo private moves its CI onto metered minutes
Checked 2026-10-08: `treforged/getforgenta` is **public** and owned by a **user account**, not an
org. Public repos run on GitHub-hosted runners for free. That is why `ios-build.yml` ran 1,312
times while the account's minutes were "exhausted until 11-01" (38534b2e). That exhaustion has to
come from other, private repos. **The day this repo goes private, every workflow here starts
drawing from that same exhausted pool.** Third-party sources (not GitHub's own page; verify)
describe a 2,000-minute monthly pool on Free with macOS billed at 10x. That would be about 200 macOS
minutes, or roughly 35 iOS builds at the measured 4.5-6 min each.
GitHub's 2026 self-hosted runner fee ($0.002/min) was announced and then **postponed**; reports
through mid-2026 say it is not charged. Re-check before relying on the PC runner being free.

**So the ordering is non-negotiable: move CI off GitHub-hosted runners (section 3) BEFORE flipping
the repo private.**

Also on that flip:
- **GitHub Pages turns off.** The repo has `has_pages: true` with homepage
  `treforged.github.io/getforgenta`. Pages on a private repo needs a paid plan. Nothing in `src/`
  links to it (grep: 0 hits). Check whether anything outside the repo does before the flip.
- **CodeQL code scanning stops being free.** It needs GitHub Advanced Security on a private repo.

## 1. Web hosting on Cloudflare

### 1a. What runs on Vercel today (measured)
- **A static SPA, nothing else.** No `api/` directory, no serverless or edge functions, no Vercel
  middleware. `vercel.json` holds only: an SPA rewrite (excluding `/assets/`), one host redirect,
  headers (security set + CSP, `/assets` immutable, `/index.html` no-store, AASA content type), and
  an `ignoreCommand` that skips docs-only commits.
- **Every webhook and API is already a Supabase edge function** (`supabase/functions/`):
  `stripe-webhook`, `revenuecat-webhook`, `plaid-webhook`, `create-checkout`, `money-glance` and
  the rest. **None of them move, and no webhook URL changes**, because they live on
  `*.supabase.co`, not on the web domain.
- Vercel project `getforgenta` serves domains `getforgenta.com` (production),
  `app.treforged.com` (308 to getforgenta.com) and `webappredesign.vercel.app` (307 to
  getforgenta.com).
- Vercel-specific code: `@vercel/analytics` + `@vercel/speed-insights`
  (`src/components/shared/VercelAnalytics.tsx`, consent-gated), the Vercel status feed in
  `src/lib/backend-health.ts`, the CSP's `www.vercel-status.com`, and the privacy policy's Vercel
  paragraph (`src/pages/Legal.tsx`). On Cloudflare the analytics components send nothing useful.
  Remove them (or switch to Cloudflare Web Analytics) **after** cutover. That is a privacy-policy
  change, so it is Tre's.

### 1b. Target: Workers static assets + Workers Builds (Cloudflare's own Git build)
Cloudflare now points new React + Vite apps at **Workers with static assets** (docs, "React + Vite",
updated 2026-09-05). Pages still works, but Workers is where new features land. Prepared here:

| File | What it does | Changes current behaviour? |
| --- | --- | --- |
| `wrangler.jsonc` | `assets.directory ./dist`, `not_found_handling: single-page-application`, `main: cloudflare/worker.js` | No: Vercel ignores it |
| `cloudflare/worker.js` | Returns **404** for a non-navigation request that matches no file | No: only Cloudflare runs it |
| `scripts/cloudflare-prepare.mjs` + `scripts/lib/cloudflare-assets.mjs` | Writes `dist/_headers` **derived from `vercel.json`** after `vite build` | No: only `build:cloudflare` calls it |
| `npm run build:cloudflare` | `vite build && node scripts/cloudflare-prepare.mjs` | No: `npm run build` is untouched |
| `npm run check:cloudflare-serve` | 6-arm probe of any host (below) | No |

Not added on purpose: the `@cloudflare/vite-plugin` and a `wrangler` devDependency. Both would
change `vite.config.ts` or the lockfile that Vercel builds from. Wrangler is pinned at the command
instead (`npx wrangler@4.136.3`, released 2026-09-22).

**⚠️ Found while verifying (the reason `cloudflare/worker.js` exists).** With SPA mode and *no*
Worker, a module request for a missing chunk (`/assets/nope-c2.js`) answered **200 text/html**
under `wrangler dev`. That is the exact shape of the **2026-09-24 blank-screen incident** (the `-c2`
suffix comment in `vite.config.ts`), and Vercel's `(?!assets/)` rewrite exists to prevent it. Per
Cloudflare's docs, a navigation request that misses is served `index.html` **without invoking the
Worker**, and only non-navigation misses reach it. So the Worker is invoked only for real misses and
costs essentially no requests. Proven both ways with `check:cloudflare-serve`:
- with `main`: **PASS 6/6**;
- with `main` deleted: **FAIL**, `missing chunk -> 200 text/html` (exit 1), every other arm still green.

**`check:cloudflare-serve` arms** (expected headers are read from `vercel.json`, never restated):
1. `/` is the app shell and carries every global header, CSP byte for byte. No shell = exit 2.
2. `/dashboard` as a navigation returns the shell.
3. A missing chunk as a module request is not HTML.
4. A real chunk (name read from the shell) is JS with `immutable`.
5. The AASA is `application/json` (universal links).
6. `/best-budget-app/` is its own static page, not the shell.

⚠️ It uses `node:http`, not `fetch`. Undici's `fetch` silently rewrites `Sec-Fetch-Mode: navigate`
to `cors` (measured), so a fetch-based probe can never send a navigation request.

**Known differences from Vercel (measured under `wrangler dev`, accepted or handled):**
- `/` gets Cloudflare's default `Cache-Control: public, max-age=0, must-revalidate` + ETag, not
  `no-store`. That still revalidates on every load, and Vercel's `/index.html` rule never matched
  `/` either.
- `/index.html` 307-redirects to `/` (`html_handling: auto-trailing-slash`). Nothing links to
  `/index.html`.
- `app.treforged.com` cannot be redirected by `_redirects` (it cannot match on host). It becomes a
  **Cloudflare Redirect Rule** (Single Redirect, 308, path and query preserved), which needs that
  hostname proxied (orange cloud).

**Limits checked against Cloudflare's docs on 2026-10-08:** static asset requests are free and
unlimited. Workers Free allows 20,000 files per version (this build: **321 files, 29 MB**, largest
under the 25 MiB per-file cap), 100 `_headers` rules (we use 4) and 2,000 chars per line (the CSP
line is ~1,020). Worker invocations on Free: 100,000/day (only missing-file requests count here).
`wrangler deploy --dry-run` in this container read 334 files with "No bindings found".
**Not verified:** Workers Builds' monthly build-minute quota. Cloudflare's limits page was not
reachable from this container and the doc search did not return the number. Read it at
developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing before relying on it. With Build
Watch Paths set to skip `docs/**`, `*.md` and `claudecontext/**` (what `ignoreCommand` does today),
the build count stays roughly at today's Vercel deploy count.

### 1c. Build settings in the Cloudflare dashboard (Tre's clicks, at cutover)
- Build command: `npm ci && npm run build:cloudflare`. Deploy command: `npx wrangler@4.136.3 deploy`.
- Non-production branch deploy command: `npx wrangler@4.136.3 versions upload` (preview URLs, no
  promotion).
- **Build variables** (build-time, not runtime: Vite inlines `VITE_*` at build). Copy each from
  Vercel → Settings → Environment Variables, **production values**: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_LD_CLIENT_ID`,
  `VITE_GA_MEASUREMENT_ID`, `VITE_PLAID_OAUTH_REDIRECT_URI`, `VITE_REVENUECAT_IOS_API_KEY`,
  `VITE_REVENUECAT_ANDROID_API_KEY`, plus any others Vercel holds (the Vercel API refused this
  session a list of names: 403). Set Node to 22 (`.nvmrc` says 22; `engines` requires `>=22 <23`).
  `VITE_ENABLE_DEBUG_CONSOLE` / `VITE_ENABLE_ERROR_TEST` stay **unset** in production.
- Build watch paths: exclude `docs/**`, `**/*.md`, `claudecontext/**`.
- The build calls Apple's iTunes lookup for the store rating (`scripts/app-store-rating.ts`). If
  that fails it omits the rating, so it is not a build failure.

### 1d. What does NOT change
Supabase auth redirect allow-list, Stripe success/cancel URLs, the Plaid OAuth redirect, the AASA
and assetlinks, RevenueCat and all webhooks: **the domain stays `getforgenta.com`**, so every
URL that names it keeps working. The native apps load their bundle from the IPA/AAB, not from the
web host, so they are unaffected by the hosting move.

## 2. The calculations: what ships to the client, and what could move

Audit (read-only, 2026-10-08): `src/lib` + `src/hooks` is 59,211 non-test lines, about 25k of them
money math. **All of it runs in the browser and inside the native bundles.** No edge function
imports `src/lib`. The only server read of a computed figure (`money-glance`) returns a number the
**client** wrote (`safe_to_spend_snapshot`). `/demo` runs every engine on fixtures
(`src/lib/demo-data.ts`) with no backend. There is no service worker. Native keeps last-known query
**data** (`query-cache-persistence.ts`), not computed results, so the engines must run on the device
today.

### 2a. Ranked by how much they reveal

| Tier | Modules (lines) | What a reader learns | Proposal |
| --- | --- | --- | --- |
| **A: the product** | `credit-card-engine.ts` (3,456), `forecast-engine.ts` (3,271), `useCardProjection.ts` (2,798), `surplus-ranking.ts` (1,109), `ranked-extra-payment-targets.ts` (950), `ranked-surplus-allocation.ts` (426), `balance-tranches.ts` (438), `floor-protection.ts` (355), `forecast-convergence.ts` (275), `cardProjectionResim.ts` (216), `debt-payoff-order.ts` (116) | The payoff simulation, the 60-month cash walk, the surplus waterfall and the floor-protection rule: what makes Forgenta's numbers Forgenta's | **Move server-side, as one unit** |
| **B: distinctive, interactive** | `consolidation*.ts` (683+183+152), `safe-to-spend*.ts` (395+297+127+69), `card-for-purchase.ts` (167), `pay-more-payoff.ts` (55), `breach-levers.ts` (207), `paced-goal-contribution.ts`/`savings-growth.ts`/`back-loaded-pace.ts` | Distinctive rules, but each sits on Tier A's output and several recompute **per keystroke** | Move with Tier A, behind a debounced call, or keep and accept the exposure |
| **C: generic** | `scheduling.ts`, `pay-schedule.ts` (1,826), `transaction-matching.ts`, `rule-drift.ts`/`rules-from-history.ts`, `sync-cutoff.ts`, `net-worth.ts`, `budget-spent.ts`, `vehicle-loan-engine.ts` (standard amortization), `calculations.ts`, `cash-floor-warning.ts`, `leaderboard-metrics.ts` | Date maths, amortization, matching: textbook | **Keep client-side.** Moving these costs latency and offline for nothing. `pay-schedule.ts` is large but is calendar logic every competitor has |

### 2b. What moving Tier A costs (stated, not measured)
- **Where it can run.** A **Supabase edge function** fits: same database, same RLS identity, no new
  vendor. Supabase limits (docs, 2026-10-08): **2 s CPU per request**, 256 MB, 150 s wall on Free.
  ⚠️ The convergence suites take ~2.4 s of test time for one 60-month projection
  (`vite.config.ts` comment). That is test time on a loaded runner, not a CPU measurement, but it is
  close enough to the 2 s cap that **the first step is to measure the engine's CPU on the real-data
  fixture** before choosing. **A Cloudflare Worker on the Free plan cannot run it** (10 ms CPU). On
  Workers Paid ($5/month minimum, docs 2026-10-02) CPU goes to 5 minutes. That is a cost for Tre,
  and only worth it if the Supabase cap is hit.
- **Shape.** One `projection` function: it reads the user's inputs server-side (the same tables
  `useForecastEngineInputs` reads), runs the engines and returns the result. Cache that result in a
  row keyed by an input hash, so a Dashboard load is a read, not a re-run. That also lets
  `money-glance` serve a **server-computed** Safe to Spend, closing the "server trusts the client's
  number" gap.
- **Latency.** Every money screen gains a network round trip plus cold starts on free compute. The
  free-compute tail is already known to be poor (`docs/load-times-measurement-2026-09-11.md`). Under
  decision d9e5961c (stay on free compute) this cost is accepted, not engineered away. The cached
  row is what keeps it tolerable.
- **Interactivity.** Sliders and inputs (consolidation APR, pay-more amounts, surplus drag) become
  debounced requests (~300 ms + round trip) instead of instant. Some screens will feel slower. This
  is the real UX cost.
- **Offline / native.** Today a cold native launch shows numbers from cached data. After the move
  it shows the last **cached result**, and recompute needs the network. Changes made offline show
  no updated forecast until the network is back.
- **`/demo`.** It needs a server-side demo endpoint (fixtures move server-side too). Otherwise the
  demo bundle re-ships the engine and undoes the move.
- **Tests.** Engines stay plain TS modules. Only the call site moves, so the 234 test files and
  `test:tz` keep running against the same code. The function imports them through a `_shared` path
  or a build step. **Decide that before any code moves.**
- **Honest ceiling.** Minification without maps (0.1) is a speed bump, not a lock. A determined
  reader can still follow minified JS. Obfuscators exist but slow the app and only deter. **Only
  server execution actually hides the math.**

**Proposal:** 0.1 now (cheap, big). Tier A + B server-side as a **separate, later project** after a
CPU measurement. Tier C stays client-side. Nothing has been moved.

## 3. CI: every workflow and where it goes

Runner constraints: the PC is Windows, labels `self-hosted, windows`, **private repos only** (Sam
sets it up), on only when Tre's PC is on. Workers Builds builds the web app.

| Workflow | Today | Goes to | Notes / cost |
| --- | --- | --- | --- |
| `tests.yml` (push main, PRs; test-count floor) | ubuntu | **PC runner** | `test:tz` sets `TZ`; prove one run on Windows before trusting it. When the PC is off, the gate is the pre-push hook (already `tsc`) plus `npm run test:tz` locally. Optionally put `npm test` in the Cloudflare build command so a red suite cannot deploy (spends Cloudflare build minutes; quota unverified). |
| `codeql.yml`, `codeql-android.yml`, `codeql-ios.yml` | ubuntu / **macOS** | **Nowhere** | Code scanning on a private repo needs GitHub Advanced Security (paid). The pre-commit Semgrep hook (`.semgrep/` + pinned OWASP set) is the free replacement and already runs on every commit. |
| `dependency-audit.yml` (weekly + lockfile PRs) | ubuntu | **PC runner** (or `npm audit` in the weekly desk routine) | Small. |
| `android-build.yml` (push builds; daily 10:00Z ship; dispatch) | ubuntu | **PC runner** | Needs JDK 17 + Android SDK on the PC; the Play WIF secrets move to the runner. The daily ship only fires while the PC is on: a missed day ships the next day. Steps written for bash run under `shell: bash` (Git Bash). Most effort of any move. |
| `ios-build.yml` (push builds; dispatch / `v*` tag uploads to TestFlight) | **macOS** | **Xcode Cloud** (Codemagic fallback), 3a | Push builds stop. Build only when shipping. |
| `ios-sim-screenshots.yml` (dispatch) | **macOS** | **Xcode Cloud test action** on demand, or nowhere | Spends the same 25 h. |
| `aso-metadata.yml`, `revenue-report.yml` (dispatch) | ubuntu | **PC runner** | App Store Connect secrets move to the runner. |
| `live-bundle-scan.yml` (dispatch) | ubuntu | **PC runner** | Point it at the Cloudflare URL after cutover. |
| `version-bump.yml` (dispatch; pushes to main) | ubuntu | **PC runner** | Needs push rights on the runner's token. |
| `schedule-canary.yml` (**every 5 min**) | ubuntu | **Delete before the flip** | Marked TEMPORARY (6dce46c4). On a private repo it is ~8,640 runs a month: on its own it would burn any free pool. |
| Vercel deploy (not a workflow) | Vercel | **Workers Builds** | Section 1. |

### 3a. The store pipeline, job by job (Tre: "my apps build in github. and they auto upload to apple and googleplay")
This is a hard requirement. Measured from the workflow files 2026-10-08; secret NAMES only.

**iOS: `ios-build.yml`** (macos-latest; push = build only, dispatch or `v*` tag = upload)
1. Checkout, Xcode 26, Node 22, `npm ci`, `vite build`, the debug-console and leaked-key bundle checks, `cap sync`.
2. Compute version and build number, staleness notice, customer release note (from commits since the last SHIPPED run,
   `scripts/last-shipped-run.mjs`, which reads THIS workflow's GitHub run history).
3. Signing: import the distribution cert and app + widget provisioning profiles into a temporary keychain. Assert push
   and App Group entitlements.
4. `xcodebuild archive` + export the IPA, assert `aps-environment`.
5. **Upload to App Store Connect** (`xcrun altool`, API key). A 90382 daily cap reads as a warning, not a failure.
- Secrets: `APPLE_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`,
  `APP_STORE_CONNECT_API_KEY_CONTENT`, `BUILD_CERTIFICATE_BASE64`, `BUILD_CERTIFICATE_PASSWORD`,
  `BUILD_PROVISION_PROFILE_BASE64`, `BUILD_PROVISION_PROFILE_WIDGET_BASE64`, `KEYCHAIN_PASSWORD`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_LD_CLIENT_ID`.

**Android: `android-build.yml`** (ubuntu-latest; push = build only; schedule 10:00Z daily and dispatch = ship)
1. Checkout. "Decide whether this run ships": ships only if main holds a commit Play has not had (also read from this
   workflow's run history via `last-shipped-run.mjs` + `GH_TOKEN`).
2. Google Cloud auth by **Workload Identity Federation** (GitHub OIDC; no JSON key stored).
3. Node 22, Java, `npm ci`, `vite build`, bundle checks, `cap sync`, Android unit tests.
4. Decode the keystore, compute version, build the signed release AAB, keep the AAB + mapping as artifacts.
5. Release notes from commits, then **Deploy to Google Play** (`r0adkll/upload-google-play`, package
   `com.treforged.forged`, track `production`, status `completed`).
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`,
  `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**Replacements that keep automatic upload with GitHub-hosted minutes at zero:**

| Pipeline | Replacement | Why it works | Changes needed | Cost to Tre |
| --- | --- | --- | --- | --- |
| Android build + Play upload | **Same workflow on the PC runner** (`runs-on: [self-hosted, windows]`) | Self-hosted jobs use no hosted minutes; GitHub OIDC (WIF) works on self-hosted runners, so the Play auth needs no new key | PC needs JDK 17 + Android SDK + Node 22 + Git Bash; bash steps get `shell: bash`; `gradlew` via Git Bash. The 10:00Z schedule ships only if the PC is on at that hour. If it is off, the next scheduled run ships (the "has Play had this commit" check makes a late ship safe), or dispatch by hand | $0 (self-hosted fee postponed; re-check, 0.2) |
| iOS build + TestFlight upload (recommended) | **Xcode Cloud** | 25 compute hours/month are **included in the Apple Developer Program membership Tre already pays for** (Apple, since Jan 2024) = ~250 builds at 6 min. Apple manages signing, so the cert/profile secrets go away. Uploads to TestFlight natively | `ios/App/ci_scripts/ci_post_clone.sh` (install Node 22, `npm ci`, `vite build`, `cap sync`); a workflow (start condition: manual or tag, never every push) with "TestFlight (internal)" post-action. Apple's docs describe workflow setup from Xcode; **this desk has no Mac and whether App Store Connect alone can create it is unverified**. The bundle checks and release-note step have to be ported into `ci_scripts` | $0 within 25 h. More hours are a paid add-on ($49.99/mo for 100 h); **never subscribe**, so the cap is a hard stop |
| iOS (fallback) | **Codemagic, personal account** | 500 free macOS M2 min/month (docs.codemagic.io/billing/pricing, 2026), ~80 builds. Personal accounts only, no team | `codemagic.yaml` mirroring the steps above; ASC API key + cert/profiles as Codemagic secrets | $0 with billing **off**. With billing on, overage is $0.095/min |

⚠️ **`last-shipped-run.mjs` reads GitHub Actions run history.** Android keeps working on the PC runner (the runs are still
GitHub runs). iOS on Xcode Cloud or Codemagic has no GitHub run to read, so the iOS "since last shipped" release note needs
a new anchor: a git tag pushed on each successful upload (`ios-shipped/<build>`). Build that in the same change, or the
first Xcode Cloud release note is wrong.
⚠️ **CLAUDE.md's TestFlight law moves with it:** "a push does not reach TestFlight; read the UPLOAD step's own result".
On Xcode Cloud that is the TestFlight post-action's status, not the build's.

### 3b. What happens to store uploads if the repo goes private FIRST (do not do this)
The account's hosted minutes are exhausted until 11-01 (38534b2e). On a private repo, every `ubuntu-latest` and
`macos-latest` job then has no minutes to run on: **no Play ship and no TestFlight upload until 11-01.** A hotfix written
in that window has no path to either store. After 11-01 they would run again, but iOS bills macOS minutes at a multiplier
(third-party sources: 10x), so roughly 35 iOS builds would empty the month's pool. **A release is stranded the moment the
flip happens before both replacements have each delivered one real upload.**

**Things in this section that could cost Tre money:** Xcode Cloud extra hours (avoided by never
subscribing), Codemagic overage (avoided by leaving billing off), GitHub Actions on the private repo (avoided by moving every workflow off GitHub-hosted
runners before the flip), Workers Paid ($5/mo) only if the engine is moved to a Worker, GHAS for
private CodeQL (not proposed).

## 4. Cutover, in order (⚑ = Tre's click; nothing here is done yet)

1. **Merge this branch** (no behaviour change; Vercel keeps serving).
2. ⚑ **Cloudflare → Workers & Pages → Create → Import a repository** → `treforged/getforgenta`,
   settings from 1c. It deploys to `forgenta-web.<subdomain>.workers.dev` only. **Do not add a
   custom domain yet.**
3. Verify the preview: `BASE_URL=https://forgenta-web.<sub>.workers.dev npm run check:cloudflare-serve`
   must PASS 6/6. Then `walk:routes`, `check:boot-failure` and `check:landing-proof` against that
   URL. Sign-in will fail on the workers.dev host until it is on the Supabase redirect allow-list,
   so either add it temporarily (⚑ Supabase → Auth → URL Configuration) or verify signed-in pages
   only after step 6.
4. **CI off GitHub-hosted runners** (section 3), WHILE THE REPO IS STILL PUBLIC (hosted runs stay free as a fallback
   the whole time): PC runner registered and one green `tests.yml` run on it; **one real Play ship from the PC
   runner** (Play Console shows the new version) and **one real TestFlight upload from Xcode Cloud** (or
   Codemagic), each read from the upload step, not the run; `schedule-canary.yml` deleted, every
   `runs-on: ubuntu-latest|macos-latest` switched or removed. Verify with a push: **zero**
   GitHub-hosted jobs start.
5. Source maps: **done** (cb2d25d). ⚑ Purge `getforgenta.com/assets/` in Cloudflare if not yet done (0.1).
6. ⚑ **Move the domain.** Cloudflare → the Worker → Settings → Domains & Routes → add
   `getforgenta.com` as a Custom Domain (and `www` if it is used). Cloudflare manages the DNS records
   for a custom domain, and the old Vercel records for that hostname must be removed. **This is the
   switch:** traffic moves the moment it is saved. Re-run `check:cloudflare-serve` against
   `https://getforgenta.com` (this container's egress blocks that host, so run it from the PC).
   Then ⚑ add the **Redirect Rule** `app.treforged.com/*` → `https://getforgenta.com/${path}` (308,
   keep query), and prove it with one curl.
7. ⚑ **Make the repo private** (GitHub → Settings → Danger Zone). Only after 4 and 5. Confirm
   Workers Builds, Xcode Cloud (or Codemagic) and the PC runner still see the repo: each GitHub app or runner
   needs access to private repos, so trigger one build of each right after the flip.
8. **Watch for 7 days**, with Vercel still able to serve (deployments kept, domain removed).
9. ⚑ **Shut Vercel down**: remove the remaining domains, disconnect Git, then delete the project.
   After that: remove `@vercel/*` + `VercelAnalytics.tsx`, the Vercel row in `backend-health.ts`,
   `www.vercel-status.com` in the CSP, and the Legal paragraph (⚑ a privacy-policy change). Move the
   headers' source of truth from `vercel.json` into a hand-kept `public/_headers`, deleting
   `cloudflare-prepare.mjs` in the same commit.

## 5. Rollback

| If it breaks at | Do |
| --- | --- |
| Step 2-3 (preview only) | Nothing: production never moved. Delete the Worker. |
| Step 6 (domain on Cloudflare) | ⚑ Remove the Custom Domain from the Worker, then re-add `getforgenta.com` to the Vercel project (still connected, still deploying). Vercel re-verifies against the DNS records it shows. Minutes to tens of minutes, during which the site may be down; that is why step 8 keeps Vercel alive. |
| Step 7 (repo private) | ⚑ Flip back to public. Actions on GitHub-hosted runners are free again immediately. |
| Source maps (0.1) | `git revert cb2d25d` (only if stack traces become unworkable). |
| After step 9 | No fast rollback: a new Vercel project from scratch. **That is why step 9 waits 7 days.** |

## 6. Decisions only Tre can make
1. ~~Source maps~~ **decided yes, shipped in cb2d25d.** Remaining click: the Cloudflare cache purge (0.1).
2. **Move Tier A + B math server-side** as a later project, accepting slower sliders, a network round
   trip on money screens and no offline recompute. Recommended: yes in principle, but only after a CPU
   measurement on the real-data fixture shows it fits Supabase's 2 s cap. Otherwise it needs Workers
   Paid at $5/mo.
3. **iOS on Xcode Cloud** (included 25 h/month, never buy more hours), with Codemagic personal (billing off) as
   fallback. Push builds stop, so the per-push Swift compile gate is lost. Recommended: yes. Needs someone with a
   Mac or App Store Connect access to create the workflow once.
4. **Drop CodeQL** after the flip (Semgrep pre-commit stays). Recommended: yes; GHAS is not worth paying for here.
5. **Replace Vercel Analytics** with Cloudflare Web Analytics or nothing (a privacy-policy edit). No
   recommendation: it depends on whether he reads those numbers.
