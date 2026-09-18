# CLAUDE.md

## ROUTING TABLE — start here, do not grep first

Verified against a real directory listing on 2026-09-03. **If a path here is
wrong, fix it in the same commit as whatever moved it** — a routing table with one
bad row is worse than none, because it sends the next session confidently to the
wrong place.

Scale, so you know when a listing is worth reading: 74 migrations, 33 edge
functions, 234 test files under `src/lib/__tests__` alone. Reading a directory is
rarely the cheap move here.

| If the ask is about | Start in |
| --- | --- |
| Forecast numbers, month-0 cash, payoff dates | `src/lib/forecast-engine.ts`, then `src/lib/forecast-convergence.ts` |
| The credit-card simulation the Dashboard reads | `src/hooks/useCardProjection.ts` (+ `src/hooks/cardProjectionResim.ts`) |
| "Why is this month short?", save-up months, reserves | `src/lib/floor-protection.ts` |
| Card interest, statements, cycling, payoff order | `src/lib/credit-card-engine.ts`, `src/lib/debt-payoff-order.ts` |
| Paychecks, pay frequency, bills before payday | `src/lib/pay-schedule.ts` |
| Recurring rules, dates, occurrences | `src/lib/scheduling.ts` — `toLocalDateStr` lives here, USE IT |
| "Already paid?", sync cutoffs, settlement | `src/lib/sync-cutoff.ts`, `src/lib/transaction-matching.ts` |
| The shape the engine consumes | `src/lib/debt-model-types.ts`, `src/hooks/useForecastEngineInputs.ts` |
| Wiring the sim and engine together for a page | `src/contexts/CardProjectionContext.tsx` |
| The money pages themselves | `src/pages/Dashboard.tsx`, `src/pages/Forecast.tsx`, `src/pages/DebtPayoff.tsx` + `src/components/debt/CreditCardEngine.tsx` |
| Bank sync, account matching, duplicate accounts | `supabase/functions/_shared/sync-handler.ts`, `supabase/functions/_shared/account-claim.ts` |
| Providers (Plaid, Akoya) | `supabase/functions/_shared/providers/` |
| Subscriptions, premium, OG cohort | `supabase/functions/stripe-webhook/`, `revenuecat-webhook/`, `_shared/og-*.ts`, `docs/og-cohort.md` |
| Database shape or a new column | `supabase/migrations/` (74 files — grep, never list) |
| What is in flight right now | `handoff.md` — read it before anything else |

### Table 2 — WHAT TO PASTE INTO A FREE LOCAL MODEL

A local model cannot explore. It gets exactly the files you paste, so this table
exists to stop you grepping to work out what to send — which is the cost table 1
was meant to remove, just moved one step later.

| Slice shape | Paste exactly these |
| --- | --- |
| A pure money helper + its tests | `src/lib/cash-floor-warning.ts` and `src/lib/__tests__/cash-floor-warning.test.ts` as the style pair, plus the one file being changed |
| A date bug anywhere | `src/lib/scheduling.ts` (holds `toLocalDateStr`) and `src/lib/sync-cutoff.ts`, plus the offending file |
| A money-page UI change | `src/contexts/CardProjectionContext.tsx` (what the page can see) and `src/lib/debt-model-types.ts` (the shapes), plus the one page file |
| An edge function | `supabase/functions/<name>/index.ts` and only the `supabase/functions/_shared/` files it imports — check its import block first |
| A migration | `supabase/migrations/20260903_og_consent_tokens.sql` as the house style, plus the table's current shape from the DB |
| A failing test | the test file and the single source file under it. Never the engine |

⛔ **Never paste `src/lib/forecast-engine.ts` (≈2,900 lines) or
`src/hooks/useCardProjection.ts` (≈2,300).** Paste the function and its callers.

### What the free tier CANNOT do here — and what is simply UNMEASURED

**Be honest about which is which.** As of 2026-09-03 there are NO scored
free-executor runs for this repo — `~/.claude/ollama/playbook.md` has no
getforgenta entries, because every slice this session was done directly. So this
section states reasoning, not measurement, and says so.

- **UNMEASURED, no data either way:** pure helper + tests, a mechanical date
  sweep, a migration written to a template. These look like reasonable first
  experiments. Score them into the playbook rather than assuming.
- **REASONED, not measured — poor fit:** anything spanning the engine, the sim and
  floor-protection at once. Today's bugs needed all three read together plus a live
  database check, and a model that cannot open a file cannot do that. Delegate the
  helper, not the diagnosis.
- **NEVER delegate:** the decision to write to production data, anything reading a
  secret, and the final read of a money diff. Those are the manager's regardless
  of how good the executor is.

### Gates — run these by name

- `npm run test:tz` — the suite under UTC, America/New_York and Asia/Tokyo. **This
  is the real gate.** A single-timezone run has missed a live money bug before.
- `npx tsc --noEmit` and `npm run lint`.
- `npm run build` — needed when the change touches build config or `browserslist`.
- `npm run walk:routes` — opens EVERY route the router declares, SIGNED IN, in a real
  browser and asserts each renders (not 404, not an ErrorBoundary, not blank, not bounced
  to /auth); then requires every in-app `<a href="/…">` target it met to be a declared
  route. Needs the dev server up and `.env.deck-walk.local`. The route list is DERIVED
  from `src/App.tsx`, which is why the link half exists: a RENAME moves the app and the
  check together, and only the links disagree. Proven red both ways (a renamed route, a
  failing lazy chunk) and restored byte-exact.
- `npm run check:rail` — measures the desktop sidebar at 1440 and 1024, in BOTH states,
  and asserts nothing in the narrow rail is clipped past its edge and no label sits on
  more than one line — wrapping is read from each element's OWN line-height, never a pixel
  constant. Its positive control HOVERS the rail and requires the labels to come back in
  full: every other assertion is an absence, and deleting a label satisfies all of them.
  Proven red by the real shipped defect ("FORGENTA" ending at 139px in a 72px rail;
  "Sign Out" on 2 lines) at both widths.
- `npm run check:desktop-rail` — at 1440x900, signed in: the desktop rail's POP-OUT paints OVER
  the page, and every panel pill on the screen shares one centre. ⚠️ **A z-INDEX READ CANNOT
  ANSWER THE FIRST HALF**, which is why it measures a painted pixel with `elementFromPoint`: the
  rail already carried `z-40` and still lost, because `position: sticky` creates a stacking
  context at `z-index: auto`, so that z-40 only ranked it INSIDE its `<aside>` — and in the root
  context the aside sat at level 0 against `.card-forged`, itself level-0 via `backdrop-filter`,
  where DOM order decides. Its positive control HOVERS and requires the rail to widen: without
  that, "the rail is on top" is a claim about a 72px strip nothing overlaps. The centring half
  exists because a phone fix (`shrink-0` on the button sharing the pill's row) shifted the group
  344px right on desktop — **a fix measured at one breakpoint is not a fix.** Proven red both
  ways with the real shipped defects. Does NOT cover colour, spacing, phone widths, other routes,
  or whether a modal still covers the rail.
- `npm run check:text-scale` — Dynamic Type's measurable half: with the root at 150%, every
  sampled text element must scale and nothing may overflow its box. ⚠️ **IT DOES NOT AND CANNOT
  PROVE THE DEVICE HALF** — whether `font: -apple-system-body` follows the iOS slider needs an
  iPhone, and this machine has none. What it protects is the half that rots silently: one
  `font-size: 14px` added anywhere makes that text the only thing on screen that ignores the
  user's choice, and nothing else would go red. **Four instrument faults were fixed before it
  reported anything, and each is worth knowing:** "at least one element scaled" was not a
  control (it passed with 2 of 174 pairs compared); matching samples BY INDEX made a re-render
  look like instability, so the red run exited **2 UNSTABLE on a real defect** — the one
  diagnosis nobody chases; a text→element map paired one `"$0"` with a different `"$0"`, so only
  text unique in BOTH reads is compared and the dropped count is printed; and its first six
  findings were all deliberate truncation or a 1px measuring node. Proven red by pinning
  `text-[10px]` back to px (324 call sites), exit 1. Does NOT cover the device, vertical
  clipping, other routes, or whether the larger size still looks right.
- `npm run check:dark-contrast` — the COLOUR-BLIND contrast sweep, dark mode, 390x844, signed in.
  **This is the only contrast instrument here that finds candidates WITHOUT already knowing their
  colour**, so it is the only one that can catch a low-contrast string nobody thought to look for
  — `check:destructive-contrast` matches on a fixed colour and is blind by construction.
  ⚠️ **IT WALKED `/budget` ALONE UNTIL 2026-09-18** — 62 elements, one route, while five of the six
  screens a user opens had never been measured by anything. Widened to six routes: **487 elements,
  0 below AA**. It found two strings on the first widened run that one route could never have seen:
  a chart legend label at **3.6:1** (a real defect, fixed) and a decorative `|` at **1.35:1** (not
  one — marked `aria-hidden`, which the gate now exempts, DERIVED from the app rather than from a
  maintained list).
  ⚠️ **READ EACH ROUTE UNTIL TWO CONSECUTIVE READS AGREE, and dismiss dialogs BY ROLE.** A fixed
  sleep lets an unmounted page report a zero that is indistinguishable from a clean one — and here
  it shrinks `examined`, the very number the zero-control depends on. `/forecast` auto-opens a real
  "Forecast Assumptions" dialog that survives six Escapes; its examined count is **90 with the
  dialog up and 65 without**, because those 25 were the DIALOG's text rather than the page's.
  Proven RED with the real legend defect. Does NOT cover: light mode, desktop widths, error states,
  anything behind an interaction, or whether disabled/placeholder text is legitimately exempt — it
  says so and asks you to check each finding by hand.
- `npm run check:destructive-contrast` — the RENDERED half of the destructive-red split, dark mode,
  390x844, signed in. Composites the WHOLE background stack rather than one `backgroundColor`, so red
  text on a `bg-destructive/10` tint is measured rather than compared against the page by accident.
  Measured 0 of 26 below AA at 5.94:1; proven RED with the REAL pre-fix token (`0 73% 35%`) at
  **26 of 26 below AA, 2.25:1** — same population both ways, which is what makes the green mean
  anything.
  ⚠️ **IT READS EACH ROUTE UNTIL TWO CONSECUTIVE READS AGREE, and that is load-bearing.** A fixed
  6s wait read `/dashboard` as **0 elements on one run and 16 on the next**, minutes apart, no code
  change — the widgets had not mounted. **A zero from an unsettled page is indistinguishable from a
  clean one.** A route that never settles prints UNSTABLE and exits 2 rather than contributing a
  number nobody measured. Do not "simplify" that back to a sleep.
  ⚠️ **IT FINDS CANDIDATES BY THE FIXED COLOUR, so it is STRUCTURALLY BLIND to red text that was
  never repointed** — that text is a different colour and it cannot see it. It proves the repointed
  sites are legible; it can NEVER prove the sweep was complete. Does NOT cover: error states and
  delete confirmations (they need interaction, so the most important destructive surface in the app
  is unmeasured), light mode, desktop widths, or whether it LOOKS right.
- `npm run check:glass` — proves the app's glass chrome is REALLY translucent, by
  screenshotting a pinned bar's own box before and after scrolling content underneath it
  and requiring the pixels to change. A painted fill and real `backdrop-filter` are
  identical in a class list, a computed style and a single screenshot; only this tells
  them apart. Its still-frame control proves the comparator can say "no change", and the
  scroller is FOUND and asserts its own movement — the app scrolls an inner container,
  so `window.scrollTo` moved nothing and the first run accused a working feature.
- `npm run check:account` — presses every segment of the Account tab's section bar on a
  phone and asserts the section actually CHANGED: a different body, each section carrying
  its own marker and not the other's, and `aria-selected` moving. Segments are found BY
  ROLE, never by a hand-written label list. Proven red twice — both handlers setting the
  same state, and both branches resolving to the same view with aria still correct, which
  is the forged-glass dead-tab shape that throws nothing and passes every smoke test.
- `npm run check:topright` — an INVENTORY, not a pass/fail gate, of how much of each tab's top-right
  is empty, at 390x844 and 1440x900, signed in. Answers the "big blank spaces" class of complaint by
  measurement instead of by opening whichever screen was reported.
  ⚠️ **READ `onRow` BEFORE `rightGap`, OR EVERY OUTLIER LOOKS LIKE A TO-DO.** A large gap beside
  an EMPTY title row (`onRow 0`) is usually deliberate: the Command Center stacks its four buttons
  BELOW the title on a phone because **Tre asked for that on 2026-08-19**, after a `flex-row` at
  390px drew them on top of the title. Acting on that 270px would have restored the bug he reported.
  `colPx` exposes the other artefact — a `max-w-2xl mx-auto` page reports the CENTRING MARGIN, which
  is how desktop `/account` and `/settings` read a confident 306px of waste they do not have.
  ⚠️ **AND THE LESSON THAT GENERALISES PAST THIS FILE: A RED CONTROL PROVES DISCRIMINATION, NOT
  STABILITY.** This gate was proven red both ways and was still lying — `/dashboard` read 14px on one
  run and 270px on the next with no code change. A red-proof says the instrument CAN see the defect;
  it says nothing about whether the page had finished settling when it looked. Every route is now
  read TWICE and a disagreement prints **UNSTABLE** rather than being averaged, because averaging two
  readings of a flaky instrument manufactures a number nobody measured. It took TEN instrument faults
  and nine refused runs before any number from it was evidence; the faults are logged in `handoff.md`
  because each is a way a rendered-geometry probe can lie while looking healthy.
  **It does not cover:** colour, spacing, the look of the pill (that is `check:panel-rows`), whether
  a header's buttons are the RIGHT buttons, anything below the header, and it corrects for neither
  the centring artefact nor the 2-3 desktop routes that still drop out of a run — **a missing row
  means "not measured", never "clean".**
- `npm run check:accounts-groups` - the Accounts tab's grouping, at 390x844, signed in, at 2x.
  A group of ONE must render NO heading and carry its institution ON its row; a group of TWO OR
  MORE must render a heading and NOT repeat it on its rows. **Either half alone is a defect** -
  dropping the heading without moving the institution DELETES the bank name, which is the failure
  the whole change had to avoid, and that is the mutation it is proven red against.
  ⚠️ **GROUPS ARE READ OFF THE DOM WRAPPER, NEVER BY MATCHING HEADING TEXT AGAINST ROW TEXT.** The
  first version did the latter and classified "a row mentioning no heading" as solo - which is
  ALSO exactly what a correctly grouped row looks like, so it reported 9 solo groups where there
  are 5 and printed an invented 171px saving. Same family as selecting on a correctness marker.
  Measured: 9 rows in 7 groups, 110px of chrome saved, every meta line 242px with zero overflow.
  Does NOT cover colour, theme, desktop widths, or whether the institution string is correct
  (`Accounts.soloGroupHeading.test.tsx` owns that).
- `npm run check:nav` — walks the nav IA at 390x844 and 1440x900, SIGNED IN. Asserts the
  hamburger is absent on the four tab routes and present on Account; that it is **TAPPABLE**
  (`elementFromPoint` at its own centre, because `viewport-fit=cover` once put it under the
  notch and took the ONLY phone route to Settings with it — visible-and-covered passes every
  visibility assertion ever written); that pressing it lands on `/settings`; that the identity
  badge goes to `/account`; that Settings has one rendered ordinary Sign Out distinct from
  Security's all-devices control; that the bottom bar is a FLOATING PILL inset from all three
  edges; that **content clears it** (the bar's footprint and `DashboardLayout`'s bottom reserve
  live in different files and nothing makes them agree); and that the desktop Settings button
  renders, since the rail has no Settings row.
  ⚠️ **EVERY ABSENCE IS PRECEDED BY A POSITIVE CONTROL**, because a zero from a broken selector
  and a zero from a correct app are the same zero — three separate control failures in this
  gate's first runs were all the instrument, not the app (a selector demanding an `<svg>` from a
  badge that renders INITIALS; a sign-out count including a 0x0 box from the desktop rail's `lg:`
  wrapper; a matcher reading the wrong one of Settings' four panels).
  ⚠️ **AND IT FINDS THE BAR BY SHAPE, NEVER BY `rounded-full`.** Discovering candidates by the
  correctness marker meant its red run printed "CONTROL FAILED" and exited 2 — an exit-2 tooling
  fault gets re-run then ignored, where an exit-1 finding gets fixed. Do not "simplify" that
  selector back.
- ⚠️ **CLAUDE-IN-CHROME CANNOT SET A PHONE VIEWPORT HERE — measured 2026-09-16.**
  `resize_window` returns *"Successfully resized … to 390x844"* while `window.innerWidth` stays
  **1154** (and `outerWidth` reads 0). **The call succeeds and nothing happens**, which is the
  `Start-ScheduledTask` family one domain over. So any ask to "walk it with Claude in Chrome" at a
  phone width must be served by **Playwright** (`.env.deck-walk.local`, the pattern every
  `check:*` script here uses). The extension remains fine for a desktop-width look.
- 🚨 **A PUSH DOES NOT REACH TESTFLIGHT. YOU MUST DISPATCH THE iOS WORKFLOW BY HAND.**
  Tre, 2026-09-16: *"you need to push so i can see in test flight. remember that permanelty. this
  is the second or 3rd time over the past few weeks uve forgotten this."* **HE IS RIGHT, AND IT
  HAS NOW COST HIM THREE ROUND TRIPS.** Treat this as standing law in this repo.

      gh workflow run "iOS Build & Upload to App Store" --ref main

  **THE MECHANISM, so nobody re-derives it wrongly a fourth time.** `ios-build.yml` triggers its
  BUILD on every push to main touching `src/**`, `ios/**`, `capacitor.config.ts` or
  `package.json` - but its upload step carries
  `if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/v')`.
  So **a push builds and does NOT upload.** That gate is deliberate and correct: Apple caps
  uploads per app per day and this repo once burned the cap by sending ELEVEN builds to
  TestFlight in one day. **Do not "fix" it by removing the condition** - dispatch instead.

  ⚠️ **THE TRAP THAT CAUGHT ME, AND IT IS THE REASON THIS IS WORDED SO HARD.** On 2026-09-16 I
  reported "Android is green at build 839" as though the day's work had reached his phone.
  **839 IS ANDROID. TestFlight is iOS, and they are different workflows with different upload
  rules** - Android's deploy step runs on a push, iOS's does not. A green Android run therefore
  says NOTHING about TestFlight, and reporting one while he is waiting on the other reads as
  delivery. **When he says TestFlight, he means iOS, and the only thing that satisfies it is a
  dispatched iOS run that reached its upload step.**

  **SO, WHENEVER WORK NEEDS TO REACH HIS PHONE:** push, then dispatch the iOS workflow, then
  report the run and say plainly that an upload is not an install - he still has to update. The
  three facts stay separate: on origin, on a build, on his device.

  🚨 **AND THE RUN READS `success` WHILE THE UPLOAD IS `skipped`. THIS IS THE HALF THAT ACTUALLY
  BITES, AND IT CAUGHT A SECOND DESK THE SAME HOUR.** A skipped step does not fail a workflow, so
  a push run ends GREEN, carries a real VERSION_CODE in its log, and has sent nothing anywhere.
  Every signal says shipped. On 2026-09-16 Sam read iOS **848** out of run `35109958012` - green,
  real number - and was about to tell Tre to install it. Step 20 `Upload to App Store Connect`
  reads **skipped**, because the event was `push`. There was nothing in TestFlight to open.
  **This is `Start-ScheduledTask` succeeding while nothing runs, one domain over.**

      gh run view <id> --json jobs   # then read the UPLOAD step's own conclusion

  **NEVER report a build number from a run's conclusion. Read the UPLOAD STEP'S conclusion and
  require `success`, never `skipped`.** A build number is evidence that a binary was COMPILED; only
  that step says it left the machine.

- **SWIFT COMPILES ON A RUNNER, SO "NO LOCAL XCODE" NEVER MEANT "NO GATE."** Measured
  2026-09-15. `.github/workflows/ios-build.yml` runs `xcodebuild archive` + `-exportArchive` on
  `macos-latest` **on every push to main touching `src/**` or `ios/**`**, and
  `.github/workflows/codeql-ios.yml` runs a second, unsigned simulator build. Either one is a
  red/green gate for Swift.
  ⚠️ **AND THE UPLOAD STEP IS `skipped` BY DESIGN, so a push does NOT spend a TestFlight build** -
  the workflow's own comment says it: build on every push, ship on purpose via `workflow_dispatch`
  or a `v*` tag. So the compile gate is free and needs no branch dance.
  **What it does NOT buy, and say so rather than letting it be assumed:** no simulator and no
  interactive loop - each compile is a CI round-trip of minutes, so batch changes - and **no
  device**, so SEEING anything still needs a build on Tre's phone (`VERSION_CODE = run_number + 100`).
  ⚠️ **DO NOT GREP THAT LOG FOR A FILENAME TO PROVE A FILE COMPILED.** It carries no per-file Swift
  lines for the App target: `GlassEffectPlugin.swift` scores 0 and **so do `AppDelegate.swift` and
  `ViewController.swift`**, which indisputably compiled. The honest evidence is the `Build IPA` step
  succeeding plus the file being in the Sources build phase - which
  `native-glass-bridge.gate.test.ts` asserts, because a Swift file outside that phase compiles
  nowhere and fails on a device as "not implemented on ios".
- `npx vitest run src/lib/__tests__/native-glass-bridge.gate.test.ts` — the three strings that join
  a Capacitor bridge (`jsName` <-> `registerPlugin('…')`, each `CAPPluginMethod` <-> the TS
  interface, and target membership in project.pbxproj), all DERIVED from the files. Four positive
  controls run first: two empty sides agree perfectly, so a broken regex would report a healthy
  bridge. It does NOT prove the bridge round-trips; only a device does.
- ⚠️ **BROWSERSLIST IS NOT THIS APP'S SUPPORT FLOOR.** There is no `browserslist` field, so the
  default query resolves to `ios_saf 18.5+`, while `IPHONEOS_DEPLOYMENT_TARGET` is **15.0**. A
  Capacitor app runs in the system WKWebView, so the installed base is three major iOS versions
  older than anything browserslist names, and no local gate looks at that gap. It cost PDF import:
  pdfjs-dist calls `Promise.try` (V8 12.9 / Safari 18.2), which threw on every iOS below 18.2 —
  fixed by `src/lib/promise-try-polyfill.ts`. **Before using a newish built-in, check it against
  the deployment target, not against browserslist.**
- `npm run check:release-note <msg-file>` - refuses a WRAPPED `Release-Note:` trailer, and
  `npm run install:hooks` puts it in `.git/hooks/commit-msg` so it fires before a commit exists.
  ⚠️ **IT HAS TO RUN BEFORE THE COMMIT, because a pushed message cannot be rewritten.** git reads
  a trailer as ONE line, so an unindented continuation is simply dropped - `d0bf7c6` published
  *"Fixed a credit card projection that charged one month of"* to the stores and dropped the rest
  of the sentence, and `e874995` did the same an hour later.
  ⚠️ **THE DETECTION ALREADY EXISTED AND ALREADY FIRED.** `parseTrailers` has printed that warning
  on every `npm run test:tz` run for months, inside an output where 4,773 tests pass around it -
  a report with no route to an exit code, which nobody reads. The gate reuses `parseTrailers`
  rather than re-implementing "wrapped", so the gate and the publisher cannot drift.
  ⚠️ **THE HOOK IS NOT TRACKED AND A FRESH CLONE HAS NO PROTECTION** until `npm run install:hooks`
  is run; `--no-verify` skips it, and the installer deliberately REFUSES to overwrite a
  commit-msg hook it did not write. It stops the accident, which is what happened here, not the
  determined. `core.hooksPath` was deliberately NOT re-pointed: this repo's `pre-commit` and
  `pre-push` hooks are hand-written and live there, and moving it would silently disable both.
- CI is `.github/workflows/tests.yml`. It asserts a test-count FLOOR, so a
  collapsed suite fails instead of passing quietly.
- ⚠️ **CI RUNS NODE 22 AND YOUR MACHINE PROBABLY DOES NOT, SO A LOCAL GREEN IS WEAKER
  THAN IT LOOKS.** All nine workflows pin `node-version: 22`; this desk was on 24.14.0
  on 2026-09-13. There was no `.nvmrc` and no `engines` field, so **no local gate had
  ever run on the engine CI uses** — `.nvmrc` now says `22`, and it only helps if you
  actually `nvm use`.
  **The worked example, because it cost a red main:** `formatYAxisTick` used
  `Intl.NumberFormat` with `notation: 'compact'` and only a MAXIMUM fraction digit.
  ECMA-402 then leaves rounding on the compact default, and ICU builds disagree — Node
  24 / ICU 78.2 printed `$3k`, CI's Node 22 printed `$3.0k`. Four tests passed here and
  failed there. **The user-facing half is the real one: the tick a customer saw depended
  on their browser's ICU.** Name BOTH `minimumFractionDigits` and `maximumFractionDigits`
  on any `Intl` format whose exact string you assert or ship.
  **And note what `test:tz` does NOT cover:** it varies the TIME ZONE three ways and the
  ICU never. Anything locale- or currency-formatted is unguarded against this class
  locally — only CI sees it.
- ⚠️ **The real-data fixtures are gitignored, so the golden/convergence tests SKIP
  in CI.** A green badge says nothing about the money engine. Run `test:tz`
  locally.
- Live UI verification needs the `dev-signin` skill. A green suite is not a
  pressed button. `/demo` needs NO credentials and is the fastest route in.
- ⚠️ **A JSDOM GREEN ON ANYTHING GEOMETRIC IS NOT EVIDENCE.** jsdom reports
  `scrollHeight` and `clientHeight` as **0** and does **not clamp** `scrollTop`, so a
  test can pass against a feature that is completely inert in a browser. Measured
  2026-09-05 on scroll restoration: eight green tests, three failures to work in
  Chrome, and four real constraints the harness could not observe at all — the wrong
  scroll target, a silent `scrollTop` clamp against a page whose data has not loaded,
  and a programmatic `scrollTop` assignment firing **no scroll event** (0 events for
  an assignment read back as 400).
  **Any test depending on scroll position, element size or layout must MODEL the
  geometry** — define `scrollHeight`/`clientHeight` and a clamping `scrollTop` setter
  on the element — **or be verified in a browser.** This is not a scroll-restoration
  problem; it applies to every size- or layout-dependent test in this repo.
- ⚠️ **GREP FOR THE CALLER, NOT THE DEFINITION** before scoping anything as "not
  built". Four times on 2026-09-05 a feature was found already written, exported and
  documented — and never called: the OG seat test's `is_comp`, the review prompt,
  `setMoneyDisplay`, and `useLumpSumTransfers`. In three of them the surrounding
  comment described the behaviour as if it were happening.
  `grep -rn "theFunction" src/ | grep -v export` is the whole check.
  ⚠️ **AND THE RECORD LIES IN BOTH DIRECTIONS — grep before you BUILD, not only before you
  scope.** On 2026-09-05 two sections of `handoff.md` said "Not built yet" and "NEXT SLICE,
  SCOPED AND READY" about work that was already shipped, called and tested — the null-APR
  ranking (`0d91028b`, down to the `AvalancheOrderList` row mounted at
  `CreditCardEngine.tsx:1608`) and the cash-floor warning (`d97f00d4`, down to the exact
  `saveUpReason` gap that section was written to close). A session trusting the record rebuilds
  a feature on top of itself, and the rebuild passes its own tests. **One `grep -rn` for the
  symbol, before the first edit, is the whole check** — a command rather than a slice. A file
  saying a thing is missing is a claim, and claims here get verified.
  ⚠️ **AND CLOSE IT IN THE RESUME QUEUE, not only in the section above it.** The i18n item went
  stale within the hour of shipping because the top of `handoff.md` was updated and queue item 5
  was not. The queue is what a cold session reads first, so it is the copy that has to be right.
- ⚠️ **NEVER PIPE A MULTI-PATTERN GREP THROUGH `head` AND READ THE GAPS AS ABSENCE.**
  On 2026-09-05 a single `grep -rn "a\|b\|c" src/ | head -20` was used to decide which of three
  columns had writers. Pattern `a` (`onboarding_completed`) has **30 hits** and filled the window;
  `b` and `c` have **9 and 10** and never appeared. The conclusion drawn — "written by nothing" —
  was **published in a doc and relayed to Tre**, and was false: `recordFurthestStep`
  (`Onboarding.tsx:98`) writes both, shipped the day before in `821dc985`. The columns were empty
  for want of TRAFFIC, not for want of a writer.
  **Truncated output is not evidence of absence.** When the question is "does anything reference
  X", count per pattern and never truncate:
  `for p in a b c; do echo -n "$p: "; grep -rn "$p" src/ | wc -l; done`
  This is the caller-grep rule's blind spot: that rule fixes the SYMBOL you search for, this one
  fixes the OUTPUT you read. Both have now produced a confidently wrong claim in this repo.
- ⚠️ **A WIDGET THAT WILL NOT RENDER: CHECK WHICH DASHBOARD TAB YOU ARE ON, FIRST.**
  The dashboard's customisable widget stack lives under the **Overview** tab only. On 2026-09-06
  the new Trophy Case looked absent and was chased through three wrong layers in order — the data
  (`achievements` rows), then the merge (`mergeSavedLayout`), then the query (`useAchievements`).
  **All three were correct.** The dashboard was simply on the **Accounts** tab, which does not
  render the stack at all. Registration is provable without a browser
  (`grep -n "<id>" src/lib/dashboard-widgets.ts src/pages/Dashboard.tsx`), so when that grep is
  green the next thing to doubt is the SURFACE, not the code. This is the same rule as grepping
  for the caller — aim the check at the right object — pointed at a UI tab.


## SYSTEM EXECUTION OVERRIDE

Default to `/multi-plan` for any non-trivial task.

Use multi-agent execution only when:
- the task spans multiple files, systems, or concerns
- work can be parallelized safely
- specialist review is likely to improve outcome

For focused work, prefer:
- one plan
- one executing agent
- one reviewer if needed

Never jump straight to implementation on complex work.
If unsure, plan first.

This rule overrides all other heuristics.

You are ALWAYS running with the Everything Claude Code framework.

- Use structured thinking (audit → plan → implement → verify)
- Use multi-agent reasoning where applicable
- Default to production-grade decisions, not quick patches
- Always check for system-wide impact before making changes
- Never solve issues in isolation if they affect other systems

## Purpose

This is a real Git repository connected to GitHub. Treat it as a
production-adjacent project. Make changes carefully, preserve existing
working behavior unless explicitly asked to refactor, and prioritize
safety, clarity, reviewability, secure defaults, and reliable local
backups.

Do not make any changes until you have high confidence in the solution.

If confidence is below threshold:
- first run a focused audit to gather missing information
- ask follow-up questions only if the missing detail cannot be resolved from the codebase

## VERIFY-FIRST RULE (Tre is the LAST resort)

Before asking Tre anything, try to establish it yourself with the tools
available. He is a solo operator; a question you could have answered with
one tool call spends his attention for nothing and stalls an authorized
session.

Reach for, in rough order:
- **Supabase MCP** — SQL for any DB fact (row counts, schema, RLS, grants,
  `cron.job_run_details`), `list_edge_functions` for what is actually
  DEPLOYED and its `verify_jwt`, `get_organization` for the plan tier,
  plus `get_logs` / `get_advisors`.
- **Claude in Chrome** — DOM/live-app verification instead of asking "does
  this render correctly?"
- **Vercel MCP** for deploys/runtime errors; git, `gh`, and the filesystem
  for anything in the repo's own history.

A checklist item inherited from a runbook or handoff that says "confirm
with Tre" means **confirm the fact** — if a tool can establish that fact,
use the tool. It is not a licence to stop.

If a prerequisite genuinely cannot be verified, check whether you can
**create** the missing condition rather than block on it. (2026-08-07: the
§1 runbook required a PITR checkpoint before a table rename; the org plan
turned out to be `free`, where no PITR or automated backup exists at all,
so the session snapshotted the irreplaceable rows into a locked-down
`backup` schema inside the DB and proceeded.) Never write secrets to disk
as part of such a safety net — keep them in the database, in a schema
revoked from `anon`/`authenticated`.

Escalate to Tre only when proceeding under any assumption would be unsafe
AND you cannot construct the safety net yourself. Then ask once,
specifically, and lead with a recommendation — **and do not wait for the
answer**. See the AMBIGUITY RULE below.

## AMBIGUITY RULE — ask, and keep working

**Rewritten 2026-08-09.** It used to end "state the ambiguity, list the
options, and wait for an answer." The instinct was right and the cost was
wrong: a stopped session spends Tre's attention *and* the session, and a
question sitting in a terminal he is not looking at has not been asked.

If an ambiguity is hit — unclear requirements, conflicting instructions,
multiple valid interpretations, or a decision that changes scope or
behaviour — **ask it in the chat reply and carry on**.

The question goes in the closing **"Actions for me"** list; he answers in
chat. Do NOT use `AskUserQuestion`; it halts the session on the keyboard,
which is the thing being removed.

⚠️ **DO NOT WRITE TO THE CONDUCTOR.** Tre, 2026-08-31: *"nothing should be
filling ot conductor anymore for now."* (STANDING; recorded in
`claudecontext/asks-completed.md`.) The old instruction here was
`conductor ask "<question>" --options a,b,c`. A session that still runs it
files into a switched-off board and then carries on believing it asked —
the failure is silent, which is why this says so instead of just dropping
the line. The mechanism is kept collapsed in `AGENT.md` in case the hold
is lifted; the RULE it served — never stop and wait — is unchanged.

Then, in this order:

1. Everything that does not depend on the answer.
2. What does depend on it, under an assumption you **state out loud** and
   mark in the code or the handoff — so the answer either confirms the
   work or redirects one clearly-labelled piece.
3. Something else: the queue, `handoff.md`'s next steps, a known bug.

He replies in chat, so there is nothing to poll and no boundary to collect
at. Fold his answer in when it arrives, and if it contradicts an assumption
you already built on, fix that piece and say so rather than leaving both.

Still true: do not guess silently, and do not implement multiple variants.
Pick the more conservative reading, say which one you picked, and make it
easy to switch.

This rule governs genuine ambiguity — questions of intent, scope, or
preference. It does NOT cover facts that a tool can check; those go
through the VERIFY-FIRST RULE above, and most "ambiguities" turn out to be
those.

Unattended sessions have a harder boundary still: see `AGENT.md`.

## USAGE CAP — RE-VERIFY, NEVER QUOTE THE STALE NUMBER

Tre, 2026-09-02: *"set rules to always check cap reset when i ask. not use the
stale number."*

The usage line arrives on a prompt as a SNAPSHOT. By the time he asks, the
five-hour window may already have reset — that is exactly when he asks. Answering
"you are at 91%, I am paused" from a number that was true an hour ago tells him
his own machine is blocked when it is not, and costs a whole round trip to
correct.

So when the cap is relevant — he asks about it, he says it reset, or a turn is
about to stop because of it — **read the CURRENT figure from the usage line on
THIS prompt** and say the number and its reset time out loud. If this prompt
carries no usage line, say that instead of reaching for the last one seen.
Never carry a cap reading across turns, and never let a stale one be the reason
work stops.

This happened on 2026-09-02: the cap had reset to 24% and the session reported
91% and refused to work.

## CONTEXT GATE (handoff loop)

After every completed step (TDD gate, plan item, commit), check context
usage. A PostToolUse hook (`.claude/hooks/context-gate.mjs`) injects a
`CONTEXT GATE` reminder when context reaches 150k tokens — treat that
reminder as mandatory, not advisory.

When context is between 150k and 200k tokens:
1. Stop starting new work, even mid-phase. Finish only the atomic action
   in flight.
2. Run the `context-handoff` skill: write/refresh `handoff.md` at the
   repo root with goals, current state, active files, changes made,
   failed attempts, and next steps. Commit it locally.
3. **Dispatch your successor BEFORE saying anything to Tre.** A session
   cannot clear itself, so a turn that ends on "run /clear" parks the
   work on his key press — which is exactly what happened on
   2026-09-01 ("Ada got to the clear part but they didnt auto clear and
   continue"). Run `dispatch getforgenta "<the resume brief>" --handoff`
   (`~/.claude/bin/dispatch.py`, on PATH). It opens a fresh tab at this
   desk — same name, empty context — which reads the brief plus
   `handoff.md` and carries on down the resume queue. `--dry-run`
   prints the tab and brief path without opening anything.
   `--handoff` is what arms THIS tab's own exit, and it is opt-in for
   a reason: a bare `dispatch` is also how one desk routes an ask to
   another, and a router that closed itself mid-task would be useless.
   It arms only after the successor's tab has actually launched, so a
   dispatch that fails to open leaves this session alive. Checked in
   dispatch.py directly rather than taken on report.
4. Do not touch the working tree after dispatching; the successor owns
   it.
5. Only then tell the user, and let it be the single action in the
   message: `/exit` this tab — its successor is already running. The
   next agent resumes from `handoff.md` (a SessionStart hook surfaces
   it automatically).

When resuming a session where `handoff.md` exists, read it in full
before doing anything else.

---

## Orchestration layer

Use the following priority order for every task:

1. **ECC multi-agent** — for complex, multi-file, or multi-concern tasks,
   use ECC commands: `/multi-plan` → `/multi-execute`. Let Opus decompose
   the task into a dependency graph before any agent touches files.
2. **ECC single agent** — for focused tasks (one file, one concern),
   delegate to the appropriate ECC specialist agent (e.g. `code-reviewer`,
   `tdd-guide`, `architect`, `security-reviewer`).
3. **Simple edit** — only when the change is clearly a single, low-risk
   line or config tweak with no downstream effects.

Never skip straight to implementation on complex or multi-file tasks.
Always plan first.

---

## DECIDED — DO NOT RE-OPEN ON A DATE

Decisions Tre has already made in this repo. Re-opening one costs him a round trip to say the
same thing twice, and a decision recorded in only one place reads as an open item for ever —
which is exactly what happened to the one below.

### SAVE THE USER THE MOST MONEY — THE TIE-BREAKER FOR EVERY MONEY CALCULATION
Tre, 2026-09-17: *"we should **always** go in favor of what saves the user the most money so
that's how it should be calculated/coded. the label should state this as well. and the logic
should be explained in the guide."*

**He said ALWAYS, and he said it governs how things are CALCULATED AND CODED.** So this is not a
preference about one screen — **wherever two defensible answers exist in a money calculation,
take the one that leaves the user with more money.** Payoff ordering, rounding, which balance a
payment is applied against, how a surplus is split, which of two dates a charge lands on: where
the rules genuinely permit either, the cheaper-for-him answer wins.

**IT DOES NOT LICENSE A FALSE NUMBER.** "Saves the most money" breaks TIES between correct
answers; it never justifies an optimistic one. Where the right answer is simply the right answer —
a lender's stated minimum, a statutory cap, an interest accrual — this principle has nothing to
say, and reaching for it there would be the app flattering itself with the user's money.

**THREE DELIVERABLES, IN HIS OWN WORDS, AND ONLY THE FIRST IS DONE:**
1. the calculation follows it — **this entry**;
2. **the label states it**, so the user can see WHY the app chose what it chose;
3. **the guide explains the logic.**

⚠️ **THE SPECIFIC CHANGE HE WAS APPROVING IS NOT RECOVERABLE, AND MUST NOT BE GUESSED.** His
message opens *"yes do that"*, and the preceding capture is his own *"what do you recommend what
makes the most sense?"* — so the recommendation he said yes to lives in a session transcript, not
in any message. **This portfolio has already attached one of his approvals to the opposite
decision** (2026-09-14, measured by timestamp). The PRINCIPLE stands on its own wording; the
specific change does not. Ask him rather than inferring it.

### STAY ON FREE SUPABASE COMPUTE (`d9e5961c`, approved 2026-09-15)
Cost-first is his explicit goal. **Do not re-open this on a date or because latency looks bad in
a measurement.** Re-open it when ONE of two things happens, and say WHICH:
  1. a PAYING user complains, or
  2. the latency tail blocks a sale.
Background on what was actually measured, including the honest caveat that the free-plan
shared-compute story is *"a hypothesis that fits, not a"* proven cause:
`docs/load-times-measurement-2026-09-11.md`.

### NATIVE iOS MATERIAL IS A FORK, NOT A BACKLOG ITEM (`f22f17b1`, blocked 2026-09-15)
The CSS panel identity is SHIPPED (`cdede2f0`). The NATIVE half is blocked on his call, on new
information rather than the cost he already overruled: a `UIVisualEffectView` is a SIBLING of the
WKWebView, so below it blurs the native background and sees no app content, and above it samples
the web content correctly but covers that surface's own web-rendered icons, labels and figures.
The architecture that works needs a SECOND transparent WKWebView for chrome content. **Analysis,
not measurement** — this machine has no Xcode, so the instrument that would settle it is a
simulator or device build. Do not start Swift here on the assumption it can be verified.

## SYSTEM CONTEXT (ALWAYS CONSIDER)

This application depends on tightly coupled systems:

- Supabase (auth, RLS, database)
- Stripe (subscriptions, checkout, webhooks)
- Plaid (account connections, transaction syncing)
- Mobile app (Capacitor / native behavior)
- Web app (browser-based behavior)

When making changes:
- Always evaluate impact across ALL relevant systems
- Never assume a change is isolated to one layer
- Validate data flow end-to-end (client → API → DB → external service → back)

---

## ROOT-CAUSE ENFORCEMENT

Before implementing any fix:

1. Identify the symptom
2. Trace upstream and downstream dependencies
3. Identify the true root cause
4. Verify whether other systems share the same issue

Do NOT:
- Patch symptoms
- Add UI fixes for data problems
- Add client logic for server issues

Fix at the correct layer.

---

## PLATFORM SEPARATION RULE

Mobile and Web must be treated as separate environments.

- Do NOT mix mobile-only features into web flows
  (biometrics, native storage, device auth)

- Do NOT assume web behavior applies to mobile
  (routing, auth persistence, viewport)

- Always verify:
  - mobile-specific UX
  - web-specific UX
  - shared logic boundaries

---

## EXECUTION STYLE

- Prefer structured outputs over long explanations
- Use concise, actionable steps
- Minimize unnecessary verbosity
- Optimize for fast iteration cycles with user review

---

## Default workflow

For every request, follow this sequence unless explicitly told otherwise:

1. Identify task complexity — multi-agent or single agent (see above).
2. If multi-agent: run `/multi-plan` first, confirm the plan, then
   `/multi-execute`.
3. Make the requested changes. Keep the diff scoped to the request only.
4. **Before modifying any file**, save a timestamped backup of the
   original to `./backups/` (see Backup policy below).
5. Commit locally after all changes are complete.
6. Do not push to GitHub, open a PR, merge branches, or rewrite history
   unless explicitly asked.
7. After finishing, summarize only:
    - files changed
    - what changed and why
    - backup path
    - commit message
    - manual follow-up steps

---

## Backup policy

Backups exist so any file can be restored to a previous version at any
time. Follow these rules strictly:

- **Back up all files for multi-file or high-risk changes. For trivial edits, backup is optional.** Copy
  the current version to `./backups/`.
- **Folder structure:** `./backups/YYYY-MM-DD_HHMMSS/<original-path>/`
  Preserve the original relative path inside the timestamped folder so
  restoring is unambiguous.
- **Never overwrite a previous backup.** Each backup session gets its
  own timestamped folder.
- **Scope backups to the change.** Only back up files that will actually
  be modified in this session — not the whole repo.
- **Backups are NEVER committed.** `./backups/` is gitignored and must
  stay that way. Durability comes from the Google Drive sync
  (`scripts/backup_drive_sync.py`), not from git.

> **Why this rule reversed on 2026-07-18.** Backups used to be tracked and
> committed. That put ~18 MB of archives in history and, more seriously,
> carried `forecast-inputs.real.PRE-P0.json` — the real financial fixture
> that is gitignored everywhere else — into this **public** repo, where it
> sat from 2026-07-07. A backup of a gitignored file routed straight around
> the ignore rule that was protecting it. Tracking backups is what made that
> possible, so backups no longer go into git at all. Do not re-track them.

### Restoring a file

To restore any file to a previous version:
```
cp ./backups/YYYY-MM-DD_HHMMSS/path/to/file ./path/to/file
```
Then commit the restore as a new commit. Never amend or rewrite history
to undo a change.

---

## Local commit policy

- Always commit locally after every session's changes.
- Use clear, descriptive commit messages:
  `[scope]: what changed and why`
  Example: `[auth]: fix token expiry check in middleware`
- If the commit changes something a **customer** would notice, add a one-line
  `Release-Note:` trailer to the body. It is published verbatim to the Play and
  App Store listings; without one, the generator falls back to a themed sentence
  and never publishes the subject. One line only, and see
  `docs/release-notes-template.md` for how to word it.
- Never push unless explicitly asked.
- Never force push, amend history, or rebase unless explicitly asked.

---

## Agent cost discipline (token efficiency)

- The `lean-fix` workflow applies AUTOMATICALLY to any fix/debug request —
  no manual `/lean-fix` needed. A UserPromptSubmit hook
  (`.claude/hooks/lean-fix-router.mjs`) flags fix-shaped prompts; treat its
  reminder as mandatory routing, and apply the same workflow even without
  the reminder when the task is clearly a code fix.
- For bug fixes and scoped changes, use the `lean-fix` skill: triage size
  first (small fixes stay inline — agents cost more than they save);
  otherwise Explore agent for search, strongest model for diagnosis+plan,
  Sonnet agent for implementation, cheap reviewer for the diff. The strong
  model always owns root-cause diagnosis — never a cheaper one.
- Keep searches and file dumps out of the main thread: multi-file hunts go
  to an Explore subagent whose tool output never lands in main context.
- Use `/multi-plan` before spawning agents — decomposing upfront saves
  redundant agent calls downstream.
- Independent subtasks → parallel agents via `/multi-execute`.
- Sequential or same-file work → single agent or subagent, not a team.
- Avoid spawning agent teams for tasks that don't require inter-agent
  coordination — the overhead is not worth it.
- If context window is approaching 80%, stop, summarize state to a
  handoff note, and continue in a fresh session.

---

## Security rules

- Never expose API keys, tokens, passwords, or `.env` contents in any
  file, commit message, log, or summary.
- Always use placeholders: `YOUR_API_KEY_HERE`
- If a secret is accidentally staged, STOP — do not commit. Alert
  immediately.
- If a security issue is found during any task: STOP → delegate to
  `security-reviewer` agent → fix CRITICAL issues → rotate any exposed
  secrets → scan codebase for similar patterns.

---

## DATA INTEGRITY RULE

This is a financial application.

- Never assume data is up-to-date without verifying sync logic
- Always check:
  - last updated timestamps
  - sync triggers (cron, webhook, manual)
  - source of truth (Plaid vs database)

If data appears stale:
- investigate sync pipeline BEFORE touching UI

---

## Immutability rule

Prefer creating new objects/files when ambiguity exists. Use in-place edits when clearly safe and intended. Return new copies with changes applied.

---

## Final execution order

```
Plan (ECC /multi-plan if complex)
→ Backup originals to ./backups/YYYY-MM-DD_HHMMSS/
→ Make changes
→ Review diff (scope check)
→ Commit locally
→ Summarize
→ STOP (no push)
```

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `python -m graphify update .` to keep the graph current (AST-only, no API cost).
