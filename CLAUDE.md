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
- `npm run walk:press` — PRESSES every top-layer control on every declared route at 390x844, signed in,
  each in a fresh context, and requires each press to CHANGE something (url, dialog count, text, or its own
  aria state). Three positive controls gate the run: a planted dead button must read no-change, a planted
  live one changed, and a planted WRITE write-blocked.
  ⚠️ **IT CANNOT WRITE TO THE DATABASE, AND THAT IS ENFORCED BY THE NETWORK, NOT BY LABELS.** Every
  non-read request to the Supabase data plane is ABORTED in its browser; rpc calls go through only when the
  function is STABLE or IMMUTABLE, DERIVED from `supabase/migrations` and checked against two functions
  whose volatility was read from `pg_proc`. Label skips alone let a ToggleSwitch, "Activate", "Full
  Balance" and "One row each" write to the walk account on 2026-09-23 (reverted; snapshots in
  `backup.walk_crawl_writes_20260923`). A press whose write was aborted reads `write-blocked`.
  ⚠️ **COMPARE `enumerated` AND `pressed` TO THE LAST RUN.** Blocking POST reads starved the pages once:
  315 -> 249 enumerated and PASS all the same. Last two good runs, identical code: 348 and 370 enumerated,
  135 and 145 changed, 11 and 15 write-blocked, 0 no-change. **`enumerated` is now STABLE: 370 and 370 on two runs (2026-09-24).** The old ~6% swing (348 vs 370) came from counting
  a page while its Supabase reads were still in flight: after an idle gap they stall 4-6 s, so /dashboard read 7 twice
  and 25 later. Enumeration now also waits for the network to go quiet (`quietNetwork`). A drop in `enumerated` is
  the alarm now. The press lookup waits the same way, so `not-found` went 8/17 -> 0/0 and two runs read
  **370 enumerated, 148 pressed, 148 changed, 0 not-found** identically. Any not-found or any change in those is a finding.
  **STUB PHASE (2026-09-24, Sam's two conditions):** every write-blocked REST control is pressed twice more
  with the write ANSWERED in-browser (`route.fulfill`, never sent): a 200 must show a change (a toast counts)
  and a 500 must show a failure. Planted controls gate it: honest 200 changed, honest 500 shown, a LIAR that
  always says saved must read silent on 500. Two runs: 13 of 13 show success, 12 of 12 show failure, plus 1
  background tab write (Achievements' milestone claim) printed, not failed. Functions/storage stay aborted.
  It does NOT cover controls behind a dialog or menu, param routes, desktop widths, or whether a change
  is the RIGHT change.
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
  ways with the real shipped defects. Since 2026-10-06 it also asserts that at rest ONLY the current page's rail row
  carries a fill (Debt's old `bg-primary/8` read as a second selected row); red on the old Sidebar. Does NOT cover colour, spacing, phone widths, other routes,
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
- `--more` on any check:*-contrast walks 8 MORE signed-in screens (/transactions /goals /vehicles /builds /net-worth
  /premium /ai /subscriptions) that no contrast probe had read before 2026-10-07. First run: 2 Garage buttons at 3.13:1 in light
  (hardcoded black on gold), fixed; now 0 of 478 in both themes. e.g. `node scripts/check-dark-contrast.mjs --more --theme light`.
- `npm run check:landing-contrast` - the same probe SIGNED OUT on `/` (`--landing`), light then dark. No contrast probe had
  read the landing before 2026-10-07. Red on the old stat labels (text-foreground/60): 4.21:1, exit 1; now 0 of 49. A redirect
  away from `/` exits 2. Does NOT see the testimonial disclosure while `src/data/testimonials.ts` is empty.
- ⚠️ **SINCE 2026-10-07 THE WALK-UP ARM COMPOSITES TRANSLUCENT TEXT INSTEAD OF SKIPPING IT.** Chrome reports every
  `text-x/NN` colour as oklab(), which the old rgba regex read as null, so ALL opacity text and every oklch colour was
  invisible to check:*-contrast. Colours now resolve through a canvas and blend over the opaque surface. First run found 5
  real strings (budget-equation operators 2.17:1, lesson '2 min' 3.13, Dashboard month 3.87, Forecast receipts hint 3.87,
  Debt cash-floor warning amber-600 2.93) - all fixed. Red on the old nav: 'Debt' 3.56:1, exit 1. Findings now print colour + class.
- ⚠️ **ALL FOUR contrast scripts now run a PIXEL ARM too (2026-09-29, ask ea989790):** each on-screen string
  is measured against the worst pixel under its own glyph rect with text hidden, so a glow, gradient or
  image background is no longer invisible. A planted grey-on-grey `background-image` string is the control
  (walk-up passes it, pixels must flag it; discriminating in DARK only). TRANSITIONS ARE FROZEN during the
  read: without that, the arm's own hide/unhide caught colours mid-fade and reported gold-on-dark at 1.38:1.
  `CONTRAST_DEBUG_DIR=<dir>` saves each measured frame. Reads the first viewport only.
- `npm run check:nav-highlight` - the HIGHLIGHTED (not current) nav item, Debt, in dark and light at 390 (bar) and 1440
  (rail, hovered open): its label must read >= 4.5:1 against the pixels under it, and must NOT be painted like the current
  page's label. ⚠️ `check:dark-contrast` SKIPS every text colour with alpha < 0.95, so it passed the old `text-primary/75`
  and `/80` labels in both themes; this one composites the colour (resolved through a canvas, Chrome reports oklab) over
  the median pixel with the text hidden. Red on the old nav: light 3.73:1 (390) and 3.99:1 (1440), exit 1; red with the
  label in full gold (same as current page), exit 1. Fix (be864a14): gold icon + dot, full-contrast label, 14.8-15.9:1.
  Frames: test-results/nav-highlight-<theme>-<width>.png. Does NOT cover the icon's 3:1, other routes or hover.
- `npm run check:dark-contrast:desktop` / `check:light-contrast:desktop` - the same probe at 1440x900. Desktop is a
  different DOM (rail, header buttons, multi-column cards), and no contrast probe had read it before 2026-09-22.
  First run: 452 elements per theme, 0 below AA. Proven red by lightening the light muted-foreground (81 findings).
- `npm run check:toast-contrast` - ERROR TEXT, which the page walks cannot see. It raises a real server-refused sign-in
  and asserts AA plus that the toast IS the app's card surface. Sonner's own rule used to paint every toast black in both
  themes, so light mode showed a black slab.
- `npm run check:destructive-states` — the **ARMED DELETE**, the least legible state of the most
  dangerous control in the app. Every other contrast gate here measures only elements that OWN A
  TEXT NODE and only what renders WITHOUT INTERACTION; this control is an **icon** whose destructive
  colour appears only **after a first click arms it**, so it was invisible to all of them.
  Measured **5.94:1** against the 3:1 WCAG 1.4.11 non-text floor; **proven RED with the real
  pre-fix token at 2.25:1 — which was below even the relaxed 3:1 floor**, so the 2026-09-18 token
  split fixed a non-text contrast failure on the delete control as well as the text one.
  ⚠️ **IT ARMS AND NEVER CONFIRMS** (`BudgetControl.tsx` uses a two-step INLINE confirm, not a
  dialog), and it ASSERTS that it armed rather than assuming the press did anything.
  ⚠️ **ITS SAFETY CONTROL COUNTS ROWS, NOT DELETE BUTTONS, AND THAT CORRECTION IS THE POINT.** The
  first version counted buttons named `/^delete /i`; arming RENAMES that button to
  `Confirm delete …`, so the count fell 2 → 1 and the control announced **data had been destroyed
  when nothing had been touched**. It failed safe by luck — a real delete drops that count by one
  too, so it could not tell "row deleted" from "label changed" in **either** direction. It was
  measuring the LABEL and reporting about the DATA. The control also runs on **every** exit path,
  because the failing path is the one where the press might not have been harmless.
  Does NOT cover: validation errors and form error text (still unmeasured anywhere), light mode,
  desktop widths, other routes, or whether the armed state is DISTINGUISHABLE from the unarmed one.
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
- `npm run check:forecast-assumptions` - at 375x667, signed in: Forecast > Controls > Assumptions must
  open the panel ON SCREEN. It finds the panel by its own heading, never by the id or aria-expanded the fix
  added, so it can see the old defect: proven red on the pre-fix page (heading at top=763 on a 667px screen)
  and green on the fix (top=99). Does NOT cover desktop widths or the panel's contents.
- `npm run check:consolidation` - at 390x844, signed in: PRESSES Debt Payoff's "Would a consolidation loan
  help?" panel. Collapsed by default; opening it must show the enter-an-APR prompt and NO Interest block (the
  panel never invents a rate); an APR must produce separate Interest and Utilization blocks; changing the APR
  must change the text. Proven red by pricing before an APR (exit 1). Its only write is the shared dialog-flag
  PATCH on the walk account. Numbers are owned by
  `consolidation-view.test.ts`, whose case 6 found the engine comparing a PARTIAL loan against ALL card debt.
- `npm run walk:empty` - what a NEW user sees: 10 main routes at 390x844, signed in as an account with NO data.
  Needs a throwaway `@forgenta.test` user created in SQL (no signup email to bounce; Tre approved 2026-09-30,
  ask 813d6b21) passed as EMPTY_WALK_EMAIL / EMPTY_WALK_PASSWORD, and DELETED after (prove auth.users returns).
  Flags ErrorBoundary, NaN/undefined/Infinity/$-0/null text and blank pages; a planted "$NaN" is its control.
  ⚠️ ITS GREEN WAS WEAK: the first run passed 10/10 while the Forecast drew a phantom $97.5k salary
  (ask 9f385515). Since 2026-10-01 it also fails on ANY "$<digits>" on Dashboard and Forecast (the
  account wrote no rows, so every figure is invented or a confident $0; Sam's rule), with a planted
  "$1,234" as control. Since 2026-10-06 it also reads /budget and PERCENTAGES ("Fixed (0%)"), joining
  each element's own text nodes: React splits `{label} ({pct}%)` into four nodes, and a per-node reader
  passed five "(0%)" rows. Control: a planted "Fixed (12%)" built from four separate nodes. `WIDTH=1440` walks desktop.
  Since 2026-10-07 it also fails on a LONE TILE (one card alone in a 2+ column grid, half the row blank); control: a
  planted 1-of-2 tile. Its first 1440 run found the empty Forecast hero (half a row) and the empty Garage tile (423 of
  1296px); red on the pre-fix Forecast (exit 1), both fixed, 10/10 at 1440 and 390. Proven red with the pre-fix engine ($20k-$80k axis) and on the pre-empty-state
  app (19 $0 figures). Each route is read only once no `.skeleton-shimmer` shows and two reads agree:
  a 6 s sleep read a skeleton Dashboard as "figures 0". Never-settled routes exit 2. Still LOOK AT
  the frames: it reads figures, not meaning.
- `npm run check:one-banner` - a new user's Dashboard shows ONE nudge at a time (Sam, 2026-10-01): at 390x844 on an empty
  throwaway `@forgenta.test` account (EMPTY_WALK_EMAIL / EMPTY_WALK_PASSWORD, as walk:empty), the free-bank notice shows and
  the 2FA banner does not; PRESSING the bank Dismiss must bring up 2FA; pressing that Dismiss must clear it. Frames in
  test-results/one-banner/. Proven red with the Dashboard gate removed (both banners at once, exit 1).
- `npm run walk:first-run` - the wizard with REAL writes on a fresh throwaway `@forgenta.test` user (create it in
  SQL, pass FIRST_RUN_EMAIL / FIRST_RUN_PASSWORD, DELETE it after and prove auth.users returns). Reads the profile
  from outside the browser right after the walk and again 10 s later: furthest_step='finish', completed=true,
  income > 0, no write refused. First run 2026-10-01: 8/8, 15 writes all 2xx. A non-fresh account exits 2 (proven).
  `REOPEN=1` loads /dashboard fresh after the finish screen and asserts Home shows the tour but NOT What's New, and the
  row carries a whats_new_* flag (ask 47a25afa). Only REOPEN can see that defect: pressing through leaves a stale cached
  profile that hides it. Red with the wizard's recordCurrentReleaseSeen stripped (What's New stacked, flag {}); green 11/11.
- `npm run check:first-save` - at 390x844, signed in: walks onboarding twice and asserts the wizard
  saves on "See your plan" BEFORE the finish screen says "Your profile is set", that neither finish
  button saves again, and that every press works with the cookie banner up. Writes are answered
  in-browser with a 204, so nothing reaches the database; the walk account is restored on every exit.
  Proven red three ways (pre-fix wizard, no `saved` guard, pre-fix banner). Header names one probe
  artefact (`cache_restore` after the Premium reload). Does NOT cover the bank path or OAuth sign-up.
  ARM C (ask d53dbbe1) answers "Me and a partner": the finish screen must show the partner card (A and B must
  not), and "Set up partner sharing" must open Account on the invite-code field with Account parked on
  Leaderboard first. Red both ways (redirect removed; card always shown). Frames: test-results/first-save/partner-*.
  ARM D (ask 769b6e40) never answers the release-flag PATCH: "See your plan" must still reach the finish, because
  a real walk hung there for good with the profile already saved. Red on the unbounded write (walk stuck, exit 1).
  ARM E (2026-10-06) presses "Save what I have" on Expenses (no bank): the save must land on that press with the
  income and still reach the finish; ARM A asserts the link shows on its Expenses screen. Red with the link hidden (exit 1).
- `npm run check:plan-tab` - Plan took Garage's bottom-bar slot (Tre, decision c5e29d9e, 2026-10-06), at 390 and 1440 signed in:
  the nav has Plan and no Garage (control: Home found), PRESSING Plan lands on /budget with the heading AND BudgetControl's body,
  the nav marks it aria-current, Transactions has no Plan pill, an old `/transactions?tab=budget` lands on /budget, and Account's
  Garage link lands on /vehicles. Table writes aborted; rpc passes (aborting it raised the offline banner). Red on the old nav (exit 1).
- `npm run check:save-timeouts` - supabase-js has NO timeout, so every write the first-run path waits on is bounded
  (`boundedWrite`, 15 s; ask 61c40702). At 390x844 on the walk account, writes answered in-browser, it HOLDS one write
  open per arm: the profile save (timeout message, no finish screen, button usable again), a budget_items insert (save
  finishes, says it could not CONFIRM - never "failed", it may have landed), and Skip setup ("We couldn't save that",
  stays on /onboarding). Each arm's control asserts the write really was held. Red on the unbounded writes (5 fail).
  Does NOT cover sign-in's trusted-device read (needs an MFA account; bounded at 4 s, unit-level only) or auth calls.
  Its RELOAD arm (ask b3f0bbcc) reloads on Expenses and requires the wizard to reopen ON Expenses with the income kept
  (it used to keep the answers and reopen on Welcome). Red on the old init (welcome=true, 2 fail).
- `npm run check:boot-failure` - a load failure fails LOUD, never black (Tre's black screen, 2026-09-29). Needs
  `npm run build` first; serves dist/ with `vite preview` and loads it in WEBKIT (the iOS engine) at 390x844,
  fully offline. Arms: unblocked app mounts (control); entry script aborted -> "Couldn't load Forgenta" renders
  and Retry reloads into the app; entry script stalled -> the 12s timeout shows it; /auth lazy chunk aborted ->
  one automatic reload, then the screen. Proven red with `STRIP_GUARD=1` (7 of 10 fail). Also asserts the BOOT SPLASH
  (ask 98cbf494): the 112px mark shows while the entry script loads and is gone on mount and on the error screen;
  red with `STRIP_SPLASH=1`. The splash is a SIBLING of #root on purpose: the guard counts #root's children. The guard is INLINE in
  index.html on purpose: a guard in the bundle cannot report that the bundle failed. The next good boot sends
  the record to `public.client_boot_failures` (insert-own only; the desk reads it with SQL), because
  `reportError` is off in the native app. Does NOT cover a crash AFTER mount (that is the ErrorBoundary's job).
  Also asserts the STATIC LANDING TEXT (`#seo-landing`, e1b0fffc): before mount it is in the DOM (>150 words) but
  not painted (1px), and it is GONE after mount and on the error screen. It is the landing copy as plain HTML for
  crawlers that run no JS (a plain curl read only the <title> before, 272 words after). A SIBLING of #root for the same reason as
  the splash. Red with the guard's removal stripped (2 fail). Its copy drift is owned by `landing-static-text.test.ts`
  (fails if a string differs from `src/locales/en/landing.json`): change the landing copy, change the block too.
- `npm run check:safe-to-spend` - on /demo at 390x844 (no credentials): the "Safe to Spend until <date>" figure
  (ask 23fe1862) renders, PRESSING it opens its calculator drawer, and the drawer agrees with the card (lowest point
  minus floor = total = card). The maths is owned by `src/lib/__tests__/safe-to-spend.test.ts` (15 tests, each asserts
  a number, red under three mutants). Not on the deck-walk account: its income and checking rows are inactive, so it
  correctly shows the EMPTY state. `walk:empty` asserts an empty account shows no figure.
  PENDING checking debits (10-06): the stored balance is Plaid's POSTED `current`, so unposted swipes are reserved today
  (`safe-to-spend-pending.ts`, drawer row "Pending charges"). A pending row equal to the cent to a dated bill within
  -3/+10 days REPLACES that bill (no double count). Since 10-07 /demo carries one $41.27 pending swipe (demoPendingDebits)
  and this check requires the drawer row at that amount (red with the demo row removed); the maths stays with the unit
  tests (red under 3 mutants).
  The drawer's window note ("Checked through <date>, paychecks included") must be ON SCREEN when it opens (Sam, 10-07):
  it sat at 1056-1120px under 18 rows on an 844px phone; now 118-182px via CalcDrawer `summary`. Red on the old drawer.
- `npm run check:money-glance` - calls the DEPLOYED `money-glance` function (Leo's read of Safe to Spend, ask 1dc2c388)
  as the walk account: 401 without a token, 404 `no-snapshot` with no row, then a row planted through RLS with the
  account's own JWT must come back as EXACTLY 7 keys (amount_cents, payday, horizon, low_point_cents, low_date,
  floor_cents, computed_at ending in Z), and the user's own DELETE clears it. Never uses a service-role key; the
  30/min limit is `money_glance_rate_ok()` (429 measured at call 31). The dashboard writes the row only once the figure
  SETTLES (5 s): a 1/min throttle wrote Tre's interim $1,462.31 and blocked the $1,408.31 on screen.
- `npm run check:payoff-today` - on /demo at 430x932 (ask 25d01fda): the Dashboard hero's "$X today" equals the CC Debt
  tile, and the Debt page's trajectory chart starts at a "Today" point whose HOVERED tooltip sums to Total CC Balance.
  Both used to draw month 0's END balance (after this month's payment) as today: "$2,800 today" beside $6,482, and the
  chart starting at $3,543. Proven red on the pre-fix code with those exact numbers (exit 1). The recharts build here has
  no `.recharts-xAxis` wrapper; the probe finds X ticks by excluding "$" labels. Does NOT judge the curve after Today.
- `npm run check:update-reminder` - at 390x844, signed in, on the 1st-7th only (exits 2 otherwise): the start-of-month
  "need updating by hand" notice renders, and PRESSING it switches the Dashboard to Accounts (`?tab=accounts&panel=balances`).
  Proven red by pointing the link at `/dashboard` (exit 1). Future-dated cards are left out of the list; the unit test
  `AccountUpdateReminder.test.tsx` owns that (Tre, 2026-10-01).
- `npm run check:debt-layout` - the Debt Payoff cards tab's layout (ask 63e11072), rendered at 1440 and 390 signed in, plus
  /demo at 1440: Share sits in the toolbar beside Reset (not inside the ETA tile), utilization is labelled ONCE, the repeated
  safe-minimum notes stay gone, and the controls card sits beside the payoff order at 1440 and above it at 390. The walk
  account never pays off (no Share by design), so the /demo probe carries the Share check. Proven red on the pre-change
  layout (12 failures, exit 1). Its strategy selector matches "Strategy" with or without a colon on purpose: matching the
  new label alone made the red run exit 2 instead of 1.
- `npm run check:rewards-save` - the Which Card? rewards editor's SAVE, pressed at 390x844 signed in, with the PATCH
  answered in-browser (route.fulfill; nothing reaches the DB, every other write aborted). Picks Apple Card from the public
  catalog (f9b0da16), turns on Apple Pay, "Use these rates" must fill 2%, Gas 3 is typed over it, and Save must send ONE
  PATCH with card_rewards {base_pct 2, categories {gas 3}}. Also measures the first row of rate boxes lines up (spread 0).
  Red under: Save dropping categories, a dead "Use these rates", and the old inline-span markup (6.3px spread).
- `npm run check:intro-offer` - the WEB paywall's first-year intro offer (ask a6375f1c) at 390x844, signed in. Answers
  `create-checkout` in-browser (nothing reaches Stripe) and `user_subscriptions` as empty (reads as free). Offer on: $9.99 /
  $0.99 (Tre, ask 852772a5) with "Then $89.99/yr" / "Then $9.99/mo", no SAVE 25%, NO struck-through text (no "was" price, ask 599911a7); Get sends
  intro:true; a 409 shows a message and drops the offer. Controls: offer off shows $89.99 + SAVE 25%; a 400 (old deployed
  function) shows no offer. Red three ways (intro flag dropped, a struck "was" price, SAVE 25% kept).
- `npm run check:landing-proof` - the landing page's social proof and download counting (ask 4f473837), 390 and 1440,
  signed OUT, dev server. The live App Store rating must render beside the badges and AGREE with Apple's lookup fetched by
  the script (5.0 / 5 ratings on 2026-10-06); PRESSING each badge must send one `tap_store` row with its store, and the
  page one `landing_viewed`. Inserts are answered in-browser, store tabs closed. Red two ways (Play counter removed;
  section removed). Conversion READ: signup_funnel_events env='prod' platform='web', tap_store per landing_viewed.
  Testimonials live in `src/data/testimonials.ts` (empty until Ruby approves one; rewarded ones show the FTC disclosure).
  ⚠️ RUN IT WITH `BASE_URL=https://getforgenta.com` TOO: the dev server sends NO CSP, so localhost passed while prod showed
  no rating (connect-src lacked itunes.apple.com). Its inserts are answered in-browser, so a prod run adds no rows.
- `npm run check:intro-offer-live` - the intro offer against the DEPLOYED create-checkout (check:intro-offer stubs it and
  was blind to the 'stripe'-default bug, 394158ee). Walk account only; its row is the instrument (free, provider 'stripe',
  Stripe customer, no sub) and a CONTROL exits 2 if that shape changes. Direct offer call must be eligible, and /premium
  at 390 must show "$9.99 ... Then $89.99/yr" with the offer call passed through (all other writes aborted, no Stripe
  session ever made). Red 2026-10-06: walk row provider set to 'apple' -> exit 1; restored to 'stripe'.
- `npm run check:relink-prompt` - a BROKEN bank link says so (Accounts > Banks, 390x844, signed in). financial_connections
  answered in-browser with one Plaid row: reauth_required must show "sign in again" + Re-link; active must not. Red on the
  pre-fix row, which ignored connection_status and showed only "Updated Oct 3". Rules + 7 tests: src/lib/relink-prompt.ts.
  The Linked Banks header must read "1 bank paused" with a gold (not green) dot; red on the pre-change header.
  Dashboard arm: BrokenLinkBanner shows and the statement-consent banner does NOT (one nudge at a time); Dismiss hands over
  to consent. Red on the pre-banner Dashboard. Frames show a Cloudflare notice and the free-bank notice: probe artefacts
  (functions are aborted; the stub row has no linked accounts). Does NOT cover Akoya or desktop widths.
- `npm run check:card-advisor` - Debt > "Which Card?" (ask 1f3217bb) at 390x844, signed in: `/debt?tab=use` opens the panel
  (testid AND aria-selected), typing 300 turns "Enter an amount" into "Use <card>" - or the no-room line ONLY when every
  card row says "Not enough room" - and pressing Gas sets aria-pressed. Writes nothing. Proven red by hiding the answer
  (exit 1); its first version accepted the no-room line unconditionally and PASSED that mutant, which is why the answer is
  now checked against the card list. Numbers: `card-for-purchase.test.ts` (13 tests, red under 7 mutants).
- `npm run check:budget-tiles` - at 390x844, signed in: the dashboard's This Month's Budget tiles (two across on
  a phone since 2026-09-28) keep every figure on one line and inside its tile, and it prints the section height
  (813px before, 564px after). Proven red by forcing one tile to 60px. Positive control: exactly 7 tiles found.
- `npm run check:narrow-overflow` - TEXT CUT OFF at 320x568 (WIDTH=390 too; SIGNED_IN=1 reads the walk account, table writes aborted, rpc passes - its first run found "-$4,590.00" past its third on /transactions, fixed); also requires every bottom-nav label WHOLE (red on equal fifths: "Transactions" 74>61px at 390) (iPhone SE 1st gen; deployment target 15.0 still runs it) on
  /demo, 9 main routes, no credentials. Measures each text run's CHARACTERS (a Range) against the viewport and every clipping
  ancestor; skips sideways scrollers, ellipsis, sr-only, svg. Planted control: clipped nowrap flagged, wrapping not. First run
  2026-10-07: 17 cut (transaction amounts past the card, header buttons cut both sides, "Matches your entry" button, a stat
  figure, a tile label); 0 after. `WIDTH=390` also 0. Since 10-07 it also flags OVERLAPPING text within one layer (same fixed/sticky ancestor, or both unpinned): red on the pre-fix demo banner and nav, the two overlaps first found by
  LOOKING at the frame. Does NOT see overlap across layers, truncation outside the nav, dialogs, or signed-in data. Frames: test-results/narrow-overflow/.
- `npm run check:grid-orphans` - every CSS grid of card-sized tiles on the 7 main screens at 360, 390, 768, 1024,
  1280, 1440 and 1920, signed in: fails on an ORPHAN last row (fewer tiles than the first row and >25% of the width
  empty) and on an OVERSIZED tile (>1.4x its siblings' median width with its text spanning <60% of it).
  GRID_EMAIL / GRID_PASSWORD walk another @forgenta.test account; run walk:empty on it first to settle first-run.
  EMPTY account, 2026-10-07: 49 reads, 0 findings (after 499107be). Planted
  controls run first (3+1, blank double, even 2x2). Proven red on Tre's two 2026-10-05 screenshots (Monthly Income
  spanning 2 columns; Minimums Due alone at 768). Its first sweep also found raw account ids printed on the
  Transactions source tiles. Does NOT cover flex-wrap rows, grids behind a dialog, or colour.
- `npm run check:pay-more` - Debt's Simple "Finish sooner" card (ask e1b0fffc) at 390x844: view forced Simple by rewriting the
  profile READ, every write answered 204 in-browser. PRESSES "Show me" and requires the button to go and rows (or the honest
  no-change line) to come; rows read "Debt-free <Mon YYYY>" and grow no later as the extra grows; the card's base (first row's
  month + months sooner) must be a month the page shows. `DEMO=1` runs on /demo, which has a debt-free date (Dec 2027 -> Oct /
  May / Feb 2027 at +$100/250/500); the walk account never pays off, so only DEMO=1 exercises the rows. Red: an off-by-one in
  monthsSooner (base Jan 2028 vs page Dec 2027) and a dead button, both exit 1. The lever is $X more in
  forecastMonthEvents[1..].nonPaycheckIncome: an income RULE was tried and the engine ignored it (cash identical). Numbers:
  pay-more-payoff.test.ts (6, red two ways) and pay-more-payoff.realData.test.ts (shortcut == full re-render at 4 amounts).
  The DEMO arm starts on Home: the hero's "See how to finish sooner" link must be ABSENT in Advanced and present in Simple,
  and pressing it must reach the card (red both ways, exit 1).
  `VIEW=advanced` (with DEMO=1) runs the card in ADVANCED, where it renders since 2026-10-05 (e1b0fffc (a)); red on the
  Simple-only page (exit 1). Rows were re-laid out the same day: at 390 the amount wrapped one word per line, and at 320
  the date spilled past the card (a box check could not see it - measure the TEXT with a Range).
- `npm run measure:detail-load` - an INVENTORY of cards, dollar figures and phone screens per route (ask 7515c3fa).
  VIEW_MODE=simple reads every route in the Simple view; PRESS_ROUTE=/debt presses Simple, Show each account and
  Show advanced detail there and fails if the count does not drop and return. WIDTH=1440 for desktop.
  Also presses Transactions' "Filters" (show-filters) and fails if it opens nothing. 2026-10-05, 390px: Plan 10->2->10,
  Forecast 17->4->17, Transactions 8->3->8 (Filters 3->8). Each red-proven (panel ignoring `simple`; a dead Filters).
  PRESS_GONE=<regex> requires panel text gone in Simple (card counts missed a Goals panel ignoring Simple while the
  Dashboard shrank around it); STUB_GOALS=N answers the goals read in-browser. Goals: STUB_GOALS=2 PRESS_GONE="% complete".
  ⚠️ VIEW_MODE=simple also works on `walk:press` and all four `check:*-contrast` scripts (profile READ rewritten, nothing
  written). 2026-10-05 Simple: walk:press 335 enumerated, 135 pressed, 135 changed, 0 no-change; contrast 0 below AA x4.
- `npm run check:goal-grid` - the Dashboard Goal Progress card at 390 AND 1440, signed in: the savings_goals read is
  answered in-browser with 1, 2 and 3 goals (nothing written) and EVERY ROW of tiles must span the card. Proven red
  at 1440 on the fixed `md:grid-cols-3` (848px unused at 1 goal, 424px at 2) and at 390 by forcing 2 columns
  (174px at 3 goals). Does NOT cover widths in between or the empty state.
- `npm run check:loan-chart` - Debt > Auto Loans draws the payoff graph ONCE (ask 336b096c) at 390 and 1440, signed in:
  car_funds answered in-browser with 2 loans (writes aborted); control = both names render; then exactly 1 chart.
  Red on the pre-fix LoanCard (3 charts = trajectory + one per loan). Other loan tabs grep-verified to draw only the trajectory.
- `npm run check:spent-of-planned` - Budget Simple's "Spent so far" card (e1b0fffc (c)) at 390x844, signed in: profile READ rewritten
  to Simple, the month's synced_transactions read ANSWERED in-browser (writes aborted). Must read "$42.34 of $X planned" with Dining
  $12.34 and Shopping $30.00 ($50 less a $20 refund); a $500 TRANSFER_OUT and a $900 LOAN_PAYMENTS row must not count. VIEW_MODE=advanced:
  the same card (both views since 2026-10-06). Red with the provider exclusion removed ($1,442.34, exit 1). SPENT reads BANK rows: measured 10-05, bank charges never reach
  `transactions` (it holds future one-offs). Rules + 18 unit tests: src/lib/budget-spent.ts (red under 4 mutants).
  CONTRAST ARM (10-07): Dining pushed over plan, the red "over" line measured against its composited background in dark and
  light at 390 (AA 4.5): 5.85:1 / 6.32:1. Red on the fill red (`text-destructive`): 3.02:1 dark, exit 1.
- `npm run check:build-badges` - Garage > Builds link badges in DARK and LIGHT at 390, signed in, every build read answered
  in-browser (car_builds/phases/items, payment_plans, transactions; writes aborted). Presses the phase header open, then measures
  the charge badge and the plan badge against their composited background (AA 4.5): 7.19 / 5.09 and 8.27 / 6.15. Red on the pre-fix
  PhaseBlock: 3.88 / 3.51 and 5.57 / 3.97, exit 1. ⚠️ Chrome reports Tailwind opacity colours as oklab(); its first run read those
  numbers as RGB and called gold 1.04:1 on dark. It converts oklab/oklch and throws on any colour it cannot parse.
- `npm run check:avg-spend` - Account > Analytics "Avg Monthly Spend" reads the BANK where it has rows (ask 0ac9c4b3), 1440,
  signed in, full synced_transactions read answered in-browser: must read $400.00 (two months of $1,000, $5,000 transfers
  excluded); NO_BANK=1 must read the old ledger figure. Red on the pre-fix card (exit 1). The ledger-only figure read
  ~$1.5k/mo for Tre against ~$6.2k of bank charges. The cash-flow BARS stay ledger-only (their income side is too).
- `npm run check:cash-flow-bars` - Forecast's Cash Flow Overview reads past months from the BANK, income AND expenses
  together (ask 01979820), 1440, signed in, bank read answered in-browser. HOVERS last month: Income $2,000.00 (a loan
  disbursement is not income), Expenses $1,000.00 (a transfer out is not spending), Net $1,000.00. NO_BANK=1 keeps the
  ledger month. Red on the pre-fix card (exit 1). Current month stays the projection.
- `npm run check:partner-view` - a PHONE can open the partner's budget (ask 07351a98): at 390, partner_links answered in-browser
  with one active link (writes aborted); control = "Linked with"; "View their budget" must be visible and PRESSING it must land on
  /dashboard with the PARTNER VIEW banner. Red on the pre-fix card (0 buttons; the only switch was the desktop sidebar).
  Second half (ask 3201f66a): the viewer's own "Connect a bank" notice must NOT render in partner view - found BY TEXT (it is a
  Link; a role-scoped locator read 0 on a frame showing it, and passed the red run). Red on the pre-fix Dashboard: 1.
- `npm run check:invite-resume` - a partner/friend invite code SURVIVES /auth and /onboarding (ask 4f623f93). Needs a throwaway
  `@forgenta.test` user made in SQL (INVITE_RESUME_EMAIL / INVITE_RESUME_PASSWORD), DELETED after. Arms: signed-out invite -> /auth;
  not onboarded -> /onboarding (control); after the onboarded write /dashboard must land on /account?partner_code=X with the field
  filled; a second visit stays on /dashboard. Red on the pre-fix guard (lands /dashboard). A version that CONSUMED the code on read
  also failed it: React StrictMode runs the resume effect twice. Does NOT cover the native app (email links open Safari).
- `npm run check:rail-click` - at 1440 on /demo: the desktop rail CLOSES after a MOUSE click (it used to stay 234px over the
  page because the clicked link kept focus and the rail opened on `focus-within`) and still OPENS for KEYBOARD focus. Control:
  hover widens it. Red both ways (focus-within: arm 2; no focus open: arm 3). Does NOT cover touch or other widths.
- `npm run check:goal-starts` - the Goals tab EMPTY STATE at 390 and 1440, signed in, savings_goals answered `[]` in-browser
  (nothing written): one start button per goal type except Custom, and PRESSING each opens "New Savings Goal" with that type
  selected. Control: the empty-state text renders. Proven red with every button opening Custom (8 of 8 fail). Frames
  test-results/goal-starts-empty-*.png. Does NOT cover saving the goal.
- `npm run check:forecast-table` - at 390x844, signed in: PRESSES Forecast's "Monthly breakdown" disclosure and
  requires every Income / Out / End Cash cell to show cents (ask 4066ff23) and to fit its cell on one line. Proven red
  on the whole-dollar table (36 cells, "$2,910" had no cents). Positive control: >= 6 rows, >= 18 cells. Does NOT
  cover the chips under each row, desktop widths or colour.
- `npm run check:overview-strip` - the Command Center's Net Worth strip at 1440 and 1024, signed in: the four stat
  labels share one top (spread <= 1px) and the Net Worth TEXT ends within 40px of the divider (a Range over its
  characters; its box fills the column). Proven red on the pre-fix strip (Liquid Cash 10px low; 234px dead band).
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
  renders, since the rail has no Settings row. Since 2026-10-06 it also requires the phone bar's Debt highlight dot to sit OUTSIDE
  its icon's box with a ring (it sat on the Landmark's roof), and saves `test-results/nav-highlight-dot.png`.
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
  ⚠️ **ALL THREE HOOKS ARE NOW TRACKED IN `.githooks/`** (2026-09-24), and `npm run install:hooks`
  points `core.hooksPath` at them. A FRESH CLONE HAS NO PROTECTION until that runs, and
  `--no-verify` skips every hook. Undo: `git config --unset core.hooksPath`.
- **Pre-push TYPECHECK** (`.githooks/pre-push`, 2026-10-07): `tsc --noEmit` must be green or the push is refused. Vercel's
  `vite build` never typechecks, so ea11292d reached main red and DEPLOYED green. Checks the working tree. Proven red with a
  planted type error (exit 1), green after. `--no-verify` skips it.
- **Pre-commit SECRET SCAN** (`scripts/secret-scan.mjs`, ported from tre-forged-conductor@6097b08) -
  refuses staged credential shapes (OpenRouter, Cerebras, Resend, Anthropic, Stripe live, Supabase
  secret, JWTs, PEM and more) and credential FILENAMES, whatever `.gitignore` says. Before it, a
  staged `sk-or-v1-` key passed the old hook with exit 0. Narrowed for this repo so ordinary work
  passes: `.env.example`, source files named `*-keys.ts`, and the public Firebase key (allowed by
  the SHA-256 of its exact value, never by file). Tests: `scripts/__tests__/secret-scan.test.mjs`,
  proven red two ways. Proven on real commits in a throwaway clone: LF key 1, CRLF key 1, clean 0,
  delete-only 0, src/lib stub still 1. ⚠️ **KNOWN SELF-FLAG:** `docs/security-checklist-2026-09-12.md`
  line 46 quotes a synthetic `sb_secret_` example; restaging that doc will be refused until the
  example carries `...`. Mistral keys have no prefix and are NOT caught by content.
- **Pre-commit SEMGREP** (`scripts/semgrep-staged.mjs`, ask 77cfda79) - after the secret scan, Semgrep runs on the
  STAGED JS/TS blobs only, ~7-9 s per commit (fixed startup; file count barely matters). Exit 1 = finding, 2 = could
  not check; BOTH refuse. `SEMGREP_SKIP=1` is the loud way past it. Two rule sets, both local, nothing fetched at commit:
  `.semgrep/forgenta-sqli.yml` (repo-owned) and `p/owasp-top-ten` trimmed to its 71 JS/TS rules, pinned OUTSIDE the
  public repo (Semgrep Rules License) at `~/.claude/tools/semgrep-rules/owasp-top-ten.jsts.yml` and checked by sha256
  in the script. Semgrep 1.179.0 lives in `~/.claude/tools/semgrep-venv` (wheel sha256 6c6cf104...; no install-time
  code; the engine `semgrep-core.exe` is a closed binary from Semgrep Inc), run with `--metrics=off` and no version check.
  ⚠️ **THE OWASP PACK ALONE IS BLIND TO THIS STACK'S SQL**: its JS SQL rules fire only on Lambda events and knex, and it
  read a planted `pool.query("..." + id)` and a Deno `sql.unsafe(\`...${id}\`)` as 0 findings. The repo rule is what
  catches them. Whole-repo baseline 2026-10-06: 1,372 files, 1 finding (a false positive: `og-consent-page.ts` escapes
  with `esc()`; ignored inline), 21 files NOT fully scanned (7 timeouts incl. `useCardProjection.ts`, 14 partial
  parses), which the hook PRINTS rather than counting as clean. Tests: `scripts/__tests__/semgrep-staged.test.mjs` (4;
  the scanning 3 SKIP in CI, which has no Semgrep), red with the concat pattern deleted. Proven on real commits in a
  throwaway clone: planted refused, clean committed. Does NOT cover: SQL inside Postgres functions (plpgsql EXECUTE),
  `--no-verify`, or a fresh clone/machine without the venv (it refuses there; install line is in the script).
  Refresh the OWASP pin: re-download `https://semgrep.dev/c/p/owasp-top-ten`, re-trim to JS/TS, REVIEW, update `OWASP_SHA256`.
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
