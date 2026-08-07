# Handoff — 2026-08-06 — session 92 — branch `main` — tab bar VERIFIED, Plaid safe-area re-diagnosed

Continues session 91. `site-walk-findings.md` is still the source list;
`.claude/plan/dashboard-expense-truth.md` is the plan (steps 1–11 all DONE).

## 0a. SESSION 92 — what changed

**§1's blocker is GONE.** Tre's Akoya work landed as `aabdcdbd`; the tree is clean. Item 5 / next-step 3
(Plaid) is no longer blocked on a parallel session. Keep §1's *habits* (targeted `git add`, `git status`
before each commit) — the tree is shared whenever Tre has a second session open.

**Next-step 2 is DONE — the mobile tab bar is live-verified at a real mobile viewport.** No code change.
Method worth reusing (it defeats §8.12): `resize_window` can't change the tab's viewport, but an
**injected same-origin iframe can**. From `localhost:8080/dashboard`, append
`<iframe src="/dashboard" style="width:390px;height:844px;position:fixed">`, click *Try Demo* inside it,
then read `iframe.contentDocument` — `innerWidth` really is 386, so `lg:hidden` resolves and widths are
real. Results at 386px **and** 316px (SE class): all five tabs render, `scrollWidth === clientWidth` on
every label, **zero truncation**. `Activity` measured **49.1px** — the exact number session 91 predicted
from a canvas measurement, so that technique is now validated too. Tightest cell is `Forecast` at 56px
in 59.6px. `href`s correct (`/dashboard`, `/transactions`, `/debt`, `/forecast`), bar flush at the
viewport bottom, and the **More sheet holds Budget Control, Accounts, Vehicles, Builds, Goals, Settings**.
⚠️ `paddingBottom` reads `0px` in desktop Chrome because `env(safe-area-inset-bottom)` is 0 there — the
inset is in the source and only resolves on device. Not a defect.

**Next-step 3 (Plaid safe-area) was re-diagnosed — it is NOT the fix session 91 assumed — then SHIPPED
as `bc16b4fc`.** Diagnosis in §4a. Tre picked **Hosted Link via Capacitor Browser**, native iOS surface.

### ▶ START HERE — Tre is SIGNED BACK IN on his real account (2026-08-06, end of session 92)

His words: *"test then continue work. i logged back into my account."* Session 92 hit the context gate
before it could run this. **Do it first, it is short:**

**A. Regression-test the WEB Plaid path** — `bc16b4fc` refactored `PlaidLinkButton` (extracted
`completeLink()` shared by both surfaces). Web behavior should be *identical*, and that is the claim to
check, because the web path is the one in production.
- The modified edge functions are **NOT deployed**, so web still calls the OLD
  `plaid-create-link-token` — which is fine, web never sends `hosted: true`. Deploying is **not**
  needed for this test.
- On `localhost:8080` → `/accounts`, click **Link Bank Account**, confirm Plaid's widget opens
  (the `iframe[id^="plaid-link-iframe"]` appears), then **close it**. Closing runs `onExit`, which only
  clears `localStorage`. Non-destructive.
- ⚠️ **Do NOT complete a link and NEVER enter bank credentials** — prohibited, and it would attach a
  real Item to his real account. Opening and closing is the entire test.
- Watch the console for React errors — the risk in that commit is a stale-closure/deps regression in
  the extracted `useCallback`, not the network calls.

**B. Then continue with next-step 4** (below): the not-yet-owned card's limit vs utilization. He is
signed in, so the live before/after that item needs is finally possible — **Venture X is the suspect**,
and the last reading was **38.0%, $17,230 / $45,400**. Item 4a carries an open design question; per
`feedback_customer_first_recommendations`, answer it from the data first and **lead with a
recommendation** rather than handing him a menu.

⚠️ §8.2 still applies: **never sign him in or out.** §8.3: check `/demo/i` on `/dashboard`, not `/`.

### ⚠️ `bc16b4fc` IS NOT VERIFIED. Before it can be trusted, in this order:

1. **Enable Hosted Link on the Plaid client** (Dashboard). Without it Plaid returns no
   `hosted_link_url` and the function deliberately 502s with
   *"Hosted Link is not enabled for this Plaid client"* rather than handing back an unopenable token.
2. **Deploy both edge functions** — `plaid-create-link-token` (modified) and
   `plaid-hosted-link-result` (**new**). Neither is deployed. `verify_jwt` stays at the default
   `true`; both send `Authorization`, so do **not** add them to `supabase/config.toml`.
3. **Test on a real device** — this is native-only code and cannot be exercised in the browser
   (`Capacitor.isNativePlatform()` is false on web, so the whole hosted path is skipped). Check:
   the sheet's own chrome is inset correctly, the redirect back to
   `com.treforged.forged://plaid-complete` closes the sheet, accounts land, and **dismissing the
   sheet by hand does not leave the button spinning**.
4. **No automated tests were added** — the new code is browser-sheet + edge-function glue with no
   pure logic to isolate, so unit tests would only assert the mock. `npx vitest run` is **423/423**
   green (up from 397; Akoya added tests), `npx tsc --noEmit` is **fully clean** now that Akoya's
   generated types landed — the §1 grep filter is no longer needed — and `npx eslint` is clean.

**Re-link/update mode never yields a `public_token`**, so the hosted path treats "session finished"
as the result and force-syncs directly instead of polling. Worth a look on device too.

**Web is deliberately untouched** and still uses the inline widget — do not "unify" the two paths.

## 0. GOAL (session 91)

**Session 91 (this one):** the Chrome classifier came back, so session 90's two unverified commits were
**live-verified on Tre's real account** — every prediction held. Then shipped three of Tre's items:
Debt Payoff decimals (`3770915c`), Transactions collapse persistence (`9f73dcfc`), and the mobile
bottom tab bar (`5cb969f8`).

**Nothing pushed — 56 local commits ahead.**

## 1. ⚠️⚠️ READ FIRST — TRE IS WORKING ON AKOYA IN A PARALLEL SESSION

**Confirmed by Tre 2026-08-06:** *"i am working on ayoka in a parallel session."* The uncommitted
Akoya work in the tree is **his, in flight, in another Claude session on the same branch**. It is
expected — do not treat it as a mystery, do not revert/stash/commit it, and do not "fix" its errors.

The repo was clean at session start; partway through, `git status` showed a large
**Akoya / `financial_connections` feature** appear:

```
 M src/App.tsx, src/vite-env.d.ts, src/pages/Accounts.tsx
 M src/components/onboarding/OnboardingWizard.tsx
 M src/components/shared/PlaidLinkButton.tsx, src/hooks/usePlaidItems.ts
 M supabase/functions/plaid-{create-link-token,exchange-token,sync-all,sync}/index.ts
 ?? src/hooks/useFinancialConnections.ts, src/config/, src/lib/providers/
 ?? src/components/shared/Akoya{ConnectButton,FallbackPrompt}.tsx, src/pages/AkoyaOAuth.tsx
 ?? supabase/functions/_shared/{providers/,sync-handler.ts,token-crypto.ts}
 ?? supabase/functions/{akoya-auth-url,akoya-exchange-token,financial-sync}/
 ?? supabase/migrations/20260806_financial_connections.sql
```

**Consequences — do not trip on these:**
1. **`npx tsc --noEmit` is NO LONGER CLEAN.** All errors are in `useFinancialConnections.ts` and are
   theirs: the `financial_connections` table isn't in the generated Supabase types yet, so the query
   builder resolves to `never`. **Verify your own work with**
   `npx tsc --noEmit 2>&1 | grep -v "useFinancialConnections\|financial_connections\|SelectQueryError\|Overload\|is not comparable\|missing the following properties"`
   — that filter returned **empty** for all three of this session's commits.
2. **NEVER `git add -A` or `git commit -a`.** All three commits this session used an explicit single
   file path. Confirm with `git show --stat` before/after.
3. **Item 5 (Plaid mobile safe-area) is BLOCKED until the Akoya work lands.** It modifies
   `PlaidLinkButton.tsx`, `usePlaidItems.ts` and all four Plaid edge functions — the exact surface
   item 5 touches. Editing them now means two sessions writing the same files. Ask Tre whether Akoya
   has landed before starting it.
4. **Two sessions share this working tree and this branch.** Assume files can change under you: re-read
   before editing anything outside your own scope, and re-check `git status` immediately before each
   commit. `handoff.md` is also contended — if it has content you didn't write, merge rather than
   overwrite.

## 2. ✅ SESSION 90's COMMITS — LIVE-VERIFIED, ALL PREDICTIONS HELD

Read on Tre's REAL account (`demo:false`), dev server `localhost:8080`.

| Surface | Predicted | Actual |
|---|---|---|
| Dashboard MONTH-END CASH | $2,873 | **$2,873** ✅ |
| Forecast Aug 2026 END CASH | $2,873 | **$2,873** ✅ (agree to the dollar) |
| Snapshot drawer chain | ends 4,692.74 + one-time row | **$4,692.74**, `One-time transactions +$172.50` ✅ |
| Dashboard SAFE TO PAY | "may rise" | **$1,820, UNCHANGED** — the $172.50 was absorbed by `Held back this month $172.74`, not passed to debt |

`9f2e4ced` also verified: the Forecast Aug 2026 drawer prints exact cents on the cash walk
($763.80 / $3,395.56 / $422.89 / $173.23 / $172.50 → **Ending Cash $2,872.74**), balance lines stay
whole ($12,240 assets, −$19,805 net worth), and the month TABLE behind it still shows $2,873. The
pinned card payments render `$1,008.00` / `$812.00` — `.00` by design, see §3.

**§5b and the Forecast-decimals work are both CLOSED.**

## 3. WHAT SHIPPED THIS SESSION

### `3770915c` — Debt Payoff decimals (Tre's item, part 2 of 3)
Scoped like `9f2e4ced`: **breakdown drawers only**, tile behind stays whole.

- **Est. Liquid Cash tooltip → cents.** Every source is raw unrounded cash (`fundingBalance`, the
  per-item transaction amounts, `estLiquidCash`, `cardEstimatedCash`). Live-verified it reconciles:
  `763.80 + 3,395.56 + 52.00 + 172.50 + 1,100.00 − 75.00 = $5,408.86`, tile still `$5,409`.
- **Safe to Pay tooltip → deliberately LEFT WHOLE**, now with a comment saying why. Every line is an
  **integer by construction**: `useCardProjection.ts` rounds each month-0 per-card payment and pins
  those integers into the sim (`m0FloorPins`, ~line 1857) *and* into the ledger the engine reads, and
  `safeToPayTotalFinal = Math.round(cycling + revolving)` (~line 1827). Cents would print `.00`, and
  since the total is rounded independently of its parts the walk could visibly fail to add up.
  **Unrounding the source is not a display change — it alters engine inputs (Q6–Q12 convergence).**
- **Per-card month accordion → left alone, DECIDED, don't revisit.** Tre asked "what would be best
  for my customers?"; the answer given and accepted: it's a 60-month *projection* people scan for the
  trajectory and payoff date, not a number anyone acts on to the penny, and it's a 3-col × up-to-60-row
  table already tight on mobile. The lone `+interest` line **keeps** its cents on purpose — at ~$104 a
  dollar is 1% and it's the figure that motivates paydown.

### `9f73dcfc` — Transactions remembers Payment Plans collapsed/expanded (Tre's item)
`showPlans` was plain `useState(true)`. Now `usePersistedState<boolean>('tre:transactions:show-plans', true)`.
**Payment Plans is the only collapsible section on that page**, so this is the whole ask. localStorage
not a profile column: per-device UI preference, matching `tre:debt:expanded-card` /
`tre:debtpayoff:pause-savings`. Live-verified: collapsing writes `"false"`, and after /dashboard → back
the section renders collapsed. **The key was reset to `true` afterwards so Tre's UI is as he left it.**

### `5cb969f8` — mobile bottom tab bar (Tre's item, part 3 of 3)
⚠️ **The bar already existed** (`src/components/layout/MobileNav.tsx`: 5-col grid,
`env(safe-area-inset-bottom)`, More sheet). The bug was *which tabs*: Home / Budget / Debt / Goals.
Now **Home / Activity / Debt / Forecast / More**, with Budget Control + Goals moved into SECONDARY.
The `AI_ADVISOR_ENABLED` (currently `false`) conditional moved from PRIMARY to SECONDARY so the grid
stays filled either way.

**Label is "Activity", and the reason is measured, not guessed.** At the real computed font
(Inter 500 13.5px) five columns leave **66.8px** of text width at 390px (63.8 at 375, 52.8 at 320);
`"Transactions"` renders **83.3px** → truncates to "Transacti…" on *every* phone. `"Activity"` is
49.1px and fits a 320px SE. Full name kept on the desktop rail and in the More panel.
⚠️ **NOT seen at a real mobile viewport** — `resize_window` resized the OS window but the tab's
`innerWidth` stayed 2560, so the nav was `display:none` and widths read 0. Fit is *calculated*.
**Next agent: verify on a real phone or a properly-resized viewport.**

## 4. ⭐ NEXT STEPS (in order)

1. ~~Ask Tre about the Akoya work in §1~~ **DONE — it landed as `aabdcdbd`, tree clean.**
2. ~~Eyeball the new bottom tab bar at a true mobile viewport~~ **DONE — verified, see §0a.**
3. ~~Plaid in-app popup ignores device boundaries~~ **SHIPPED `bc16b4fc`, UNVERIFIED — do the 4 steps in §0a first.** Original report: Tre: *"on mobile the in app popup
   for plaid is not respecting the device boundries like the rest of the app. the close and back button
   are unusable at the top."* 📸 Screenshot (iOS 1179×2556) pins it: Plaid's own header (back chevron
   left, PLAID wordmark centre, `X` right) is drawn at **y = 0**, colliding with the iOS status bar —
   the `X` overlaps the battery, the chevron sits under the clock. Content below is fine. So the
   **webview/sheet is not inset by `safe-area-inset-top`**; it is how we present the container, not a
   Plaid-content problem. **Native iOS surface → look at the Capacitor side first** (`StatusBar`
   overlay config + the Link presentation), not the web modal CSS. ⚠️ Native and web are **different
   bugs** — separate containers, and there's a known minor OAuth tab-switch UX issue on mobile Safari.
   Confirm which surface Tre hit. **`MobileNav.tsx` is the reference for how the app does insets.**
4. **Tre's remaining two items from session 86.** Neither root-caused; **grep before trusting a line number.**
   a. **A not-yet-owned card's limit must not count toward utilization.** ⚠️ **Open design question —
      ask Tre:** does `accounts.active` already mean this, or is a separate "planned / not-yet-opened"
      flag needed? Overloading `active` collides with existing `a.active` filters.
      `accountSummary.ccLimit` already filters on `a.active`, so Dashboard and Debt Payoff may already
      disagree — check both. Suspect **Venture X**. Live now: **38.0%, $17,230 / $45,400** (read this
      session) — pair with a live before/after.
   b. **Goal transfer plans should auto-stop at 100%.** `recurring_rules(rule_type:'transfer')` ↔
      `savings_goals` via `linked_rule_ids`, **already known to go stale** (open since session 72) —
      fix the linkage first. Decide explicitly whether "stopped" means deactivating the rule row
      (destructive, needs undo) or the forecast engine simply ceasing to schedule it past the
      completion month (non-destructive, consistent with `estimateGoalCompletionMonths`). Must hold in
      **both** projection and actual transfer, or Goals and Forecast disagree.
5. **§2.9** car-fund earmark (needs Tre).
6. **Card interest** — only with §6 below applied.
7. **§1A** Plaid auto-pull + rule matching (a matched actual overrides the rule ONLY for its month,
   never re-bases it). Also blocked by §1.
8. Rest of session 84's list: **§2.1 / §3.2 / §3.4** (may be demo-fixture defects — re-observe first);
   §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor control** despite
   Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation; full
   real-data walk; mobile/Capacitor pass.
9. **§4 of session 84 still unfiled** — `forecast-engine.ts` picks `liquidBal` from
   `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
   `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
   numbers; pair with a live check. **Grep the line number.**
10. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
    `CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`. **Line numbers shifted
    by `3770915c` — re-grep.**

## 4a. PLAID SAFE-AREA — RE-DIAGNOSED (session 92). A CSS INSET CANNOT WIN CLEANLY.

Session 91 guessed "look at the Capacitor side / StatusBar overlay config". That is **not** where this
lives. What is actually true, read from the code and from Plaid's shipped bundle:

1. **There is no native Plaid SDK here.** `capacitor.config.ts` sets `server.url = https://getforgenta.com`,
   so the iOS app is the *web app* in a WKWebView, and `PlaidLinkButton.tsx` loads Plaid's **web** SDK
   from `https://cdn.plaid.com/link/v2/stable/link-initialize.js` and calls `window.Plaid.create().open()`.
   Link is therefore an `<iframe>` **in our own document**, not a native sheet. Native and mobile-web are
   the *same container* after all — one fix would cover both. (§3's "different bugs" note is wrong.)
2. **`viewport-fit=cover` is set** (`index.html:12`) and the app insets *everything* itself — 30+
   `env(safe-area-inset-*)` sites across `MobileNav`, `FormModal`, `Auth`, `DemoBanner`, etc.
   **Plaid's iframe is the one full-screen surface nobody styled** — `grep -rn plaid src/index.css`
   returns nothing. That is the root cause: not a missing native config, a missing rule for *their* node.
3. **But we cannot simply add that rule.** Plaid injects its own stylesheet (`plaid-link-stylesheet`)
   whose selector is `html` + **eight repetitions of `#plaid-link-temporary-id`** `> body >
   .plaid-link-iframe`, declaring `top: 0 !important; bottom: 0 !important; height: 100% !important;
   border: 0 !important; z-index: 9999999999 !important`. Eight ID selectors, all `!important`. An author
   rule of ours — `iframe[id^="plaid-link-iframe"] { … !important }` — **loses on specificity**, and the
   `border-top: env(safe-area-inset-top)` trick is dead on arrival because they pin `border: 0`.
   The bundle also carries **two older creators** that set the same geometry as *inline* styles instead,
   so any override has to beat both shapes.
4. **And the script is unversioned.** `.../link/v2/**stable**/link-initialize.js` updates under us with no
   deploy on our side, and Plaid chooses which of the three creators runs. A specificity hack pinned to
   `#plaid-link-temporary-id` and `.plaid-link-iframe` is a hack pinned to two undocumented internals on a
   CDN path that mutates without notice.

**RECOMMENDATION (customer-first): migrate the native surface to Plaid Hosted Link, opened through
`@capacitor/browser` (already a dependency, `package.json:20`).** Hosted Link runs in an
SFSafariViewController / Custom Tab, which iOS insets correctly by construction — the safe-area problem
stops existing rather than being fought. This is the highest-stakes screen in the product (it is the
moment a user hands over bank credentials), so an unusable close button there costs trust and
conversion, and it is not a screen to leave resting on a selector that Plaid can silently break.
**It is also already a tracked backlog item** (`project_plaid_hosted_link`), so this is pulling planned
work forward, not inventing scope. Keep the current in-webview flow for desktop web, where it is fine.

**The tactical alternative, honestly stated:** ~6 lines in `src/index.css` — one rule at
`html#plaid-link-temporary-id`×9 for the stylesheet path, one `iframe[id^="plaid-link-iframe"]` rule with
`!important` for the inline path, both applying `transform: translateY(env(safe-area-inset-top))` (the one
property Plaid does **not** pin). Fixes the visible bug this week with no risk to other surfaces, but it
pushes the bottom ~47px of Link off-screen — which may clip the CTA — and it breaks silently on any Plaid
CDN change. **Only worth doing if Tre wants the header usable before Hosted Link can land.**

⚠️ Whoever picks this up: **do not start coding either option before Tre picks one.** Also re-confirm
with him which surface he actually hit — the screenshot is native iOS (1179×2556), and there is a known
separate minor OAuth tab-switch UX issue on mobile Safari.

## 5. ⚠️ CARD INTEREST — STILL DEFERRED, READ BEFORE IMPLEMENTING

Under Option B a card payment splits into interest (expense) + principal (not an expense). Adding
card interest to `expenses` **requires netting it out of debt service in the same commit**:

```
expenses    = living + autoInterest + cardInterest
debtService = autoPrincipal + (totalDebtPayments − cardInterest)   // clamp at 0
```

Otherwise cash flow double-counts and Annual Savings moves for a fake reason. Hazards:
- Source is `cardProjection.monthlyInterest` (`Map<cardId, number[]>`, index 0) **plus**
  `monthlyCyclingInterest` — cycling cards push 0 into `monthlyInterest` and track interest separately
  (`credit-card-engine.ts:1261`). Miss that and cycling cards report no interest.
- Mixes an **engine-derived** figure into a **stream-derived** one. Early in a month the stream may
  hold no card payment at all, so the subtraction can go negative. Clamp, and test that case.
- /transactions' `of which debt service` sub-line reads the same concept from the stream. If card
  interest becomes an expense, that sub-line must net it out too or the two pages stop agreeing — and
  their agreeing to the dollar is the only reason the line exists.

## 6. THE RULE THAT DROVE EVERY CONSUMER DECISION (unchanged, still governs)

**Option B changes only what is LABELLED an expense. Every cash-derived number keeps its cash
meaning.** Five consumers deliberately still read `expensesAllIn` / `cashOut` — do not
"consistency-fix" them: `month0Snapshot.spentSoFar` (donut asks what is *gone*), emergency-runway burn
(principal is still owed when income stops), Cash Flow Overview month 0 (months 1–5 are all-in
actuals), PDF export (no DEBT SERVICE row, so Option B would silently drop principal), and
/transactions (it means **CASH**, so its headline kept its value).

**The residual $510 between /transactions and Dashboard is CORRECT** — the two CC-sourced plan
installments (Car Amazon Starter Pack $347 + ExtremeOnlineStore Aero Kit $163) that the expense model
excludes by design, since they already sit inside the Prime Visa balance. Do **not** "fix" it.

## 7. DECISIONS STILL NEEDED FROM TRE (carried, none answered)

- **Checking-sourced plan installments classify `living`, not `principal`** — session 86's judgment
  call, not Tre's answer, still unflagged to him. The Carnival Flex Pay $120 is technically borrowing
  but sits inside no balance anywhere, so classifying it `principal` would make $120/mo of real cash
  appear in no figure at all. One line to flip if he disagrees.
- **`transfers` is structurally always 0** — `EnrichedTransaction` does not carry `rule_type`. His HYS
  $400 is absent from the tile while Owners Contribution $50 and a $25 investment ARE counted.
- **Insurance anchors on `insurance_start_date ?? payment_start_date`** while
  `generateCarLoanTransactions` anchors on `payment_start_date` only. Same answer for August; they
  differ for a car insured before its first payment. Not reconciled.

## 8. ⚠️ ENVIRONMENT GOTCHAS

1. **The Chrome safety classifier is BACK UP** (was down all of session 90). Browser automation works.
2. **Tre is SIGNED IN on the real account.** **Never sign him in, and never sign him out.** `Try Demo`
   needs no password and is the fallback for anything not tied to his real numbers.
3. Check which account with `/demo/i.test(document.body.innerText.slice(0,600))` (false = real). **On
   the landing page `/` this returns TRUE even when signed in** — marketing copy contains the word.
   Navigate to `/dashboard` first.
4. **Wait ~13–15s after each nav** before reading. Mid-settle reads return plausible-but-wrong numbers.
5. **Dev server is on `localhost:8080`**, serves fresh transforms immediately after edits.
6. **Routes bite: Budget Control is `/budget`, Debt Payoff is `/debt`.** `/debt-payoff` 404s (cost a
   round trip this session). Grep `src/App.tsx` rather than guessing.
7. Read tiles as a **structured array**: `document.body.innerText.split('\n').map(s=>s.trim())
   .filter(Boolean)`, then index off the label. A long `|`-joined string or a `$`-heavy slice trips
   `[BLOCKED: Cookie/query string data]`. Output truncates ~95 items — use `.slice(n)` for the tail.
8. **In-app nav by link text is unreliable** — use `location.href='/transactions'` in its own call.
   Don't put a long sleep in the same call as the navigation.
9. **Use DOM reads, never screenshots** — the tab is `visibilityState: hidden`, so rAF never fires and
   framer-motion never runs; pages look blank in automation screenshots.
10. **To open a drawer/tooltip, call the React onClick prop directly** — real and synthetic clicks both
    silently failed this session. Working recipe:
    `const el=[...document.querySelectorAll('*')].find(e=>{const k=Object.keys(e).find(k=>k.startsWith('__reactProps$'));return k&&e[k].onClick&&/LABEL/.test(e.innerText.slice(0,30))&&e.innerText.length<200;});`
    then `el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onClick({stopPropagation(){},preventDefault(){}})`.
11. **Forecast's `CalcDrawer` is a plain `div.fixed.inset-0`, NOT a portal** — `[role="dialog"]`
    finds nothing. Query `div.fixed.inset-0`. Debt Payoff's breakdowns ARE `[role="tooltip"]`.
12. **`resize_window` does not change the tab's viewport** — `innerWidth` stayed 2560 after resizing to
    390×844, so `lg:hidden` elements stay hidden and all widths read 0. For responsive checks, measure
    text with a canvas at the element's computed font instead (see `5cb969f8`).
13. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
14. **Vitest suppresses `console.log`** — `--silent=false` does not restore it. To get values out of a
    test, `writeFileSync` to a scratch file and `cat` it.
15. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
    `git commit -F -` works.
16. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401, `gemini` exit 41.
    Don't re-probe, ~90s each.

## 9. SUPABASE — his real IDs

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. **Always filter by it** — 45 profiles.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is stored **`account:<uuid>`-prefixed**; account ids are not.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163
  (Prime Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING).
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07, insurance
  $173.23 from 2026-06-25. Month-0 split ≈ $140.23 interest / $282.66 principal.
- **Car funds: exactly one**, `2004 Chevorlet C5`, `phase: 'loan'`. **Savings goals: four**, none with
  `goal_type: 'Car Fund'` (401K Roth, Brokerage, Savings, Roth IRA).
- The two Aug one-time rows behind the §5b bug: `2026-08-23 income $172.50` "GF half of cruise
  excursions" → TOTAL CHECKING (`933cbc10…`), and `2026-08-18 expense $145.00` "Cruise Exursions" → a
  CREDIT CARD (`34c9574b…`, so CC-sourced and correctly excluded from the cash one-time).

## 10. FILES

- **`3770915c`:** `src/components/debt/CreditCardEngine.tsx`.
- **`9f73dcfc`:** `src/pages/Transactions.tsx`.
- **`5cb969f8`:** `src/components/layout/MobileNav.tsx`.
- Backups: `backups/2026-08-06_150000/` (all three originals).
- `npx vitest run` **397/397 green**. `npx eslint` clean on all three. `npx tsc --noEmit` clean **once
  the §1 Akoya errors are filtered** — see the grep in §1.
- **`python -m graphify update .` NOT run — carried debt from session 90 too.**
- **Not pushed. 56 commits ahead.**

## 11. LESSONS WORTH KEEPING

- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- Session 85: *before "make surface A match surface B", find out which one is complete.*
- Session 86: *a plan's predicted number is a measurement too, and it can be stale.*
- Session 86: *answer a question from data before putting it to the user.*
- Session 87 (a): *a test that fails on first run is doing its job — diagnose before you loosen it.*
- Session 87 (b): *when a relabel touches a shared figure, the invariant to protect is that nothing
  else moves.*
- Session 88: *a bridge line is only worth adding if it is defined identically on both sides.*
- Session 88: *when a fix touches a value, check whether anything reads it at all.*
- Session 89: *verifying a $1 fix is what exposed a $172.50 one.* Read both sides of an agreement,
  every time.
- Session 90 (a): *prove the new test RED before trusting it.*
- Session 90 (b): *"add decimals" was a data question, not a formatting one.*
- Session 90 (c): *unrounding is safe exactly where rounding was only ever cosmetic* — and where a
  rounded value feeds LOGIC, leave it. Session 91 hit the second half of that rule head-on: Safe to
  Pay's integers are *pinned into the engine*, so "unrounding the display" would have been an engine
  change wearing a formatting change's clothes.
- **Session 91 (a): check whether the feature already exists before building it.** Tre asked for a
  mobile bottom tab bar; `MobileNav.tsx` already had one, with safe-area insets and a More sheet. The
  real request was four different tabs — a 13-line diff instead of a new component. Same shape as
  session 84's lesson, one level up: *re-observe the UI, not just the bug report.*
- **Session 91 (b): measure the layout instead of arguing about it.** "Does 'Transactions' fit in a
  5-col bar?" was settled in one canvas call — 83.3px needed vs 66.8px available — after two rounds of
  guessing at label lengths in prose. Cheaper and it produced the number that belongs in the comment.
- **Session 91 (c): `git status` before every commit, not just at session start.** A whole Akoya
  feature appeared in the tree mid-session from outside this session. Targeted `git add <path>` is what
  kept three commits clean; `git add -A` would have swallowed someone else's unfinished migration.
- **Session 92 (a): if a fix means styling someone else's node, read their shipped CSS first.** Three
  sessions of notes assumed Plaid's overlay was a Capacitor presentation problem. Ten minutes of
  `curl`ing `link-initialize.js` and grepping it showed an 8-ID `!important` stylesheet that makes the
  obvious fix impossible — and reframed the whole task from "add a CSS rule" to "stop rendering Link
  in our webview." *The vendor bundle is readable; read it before designing against a guess.*
- **Session 92 (b): a viewport you cannot resize, you can still nest.** `resize_window` never moved the
  tab's `innerWidth` (§8.12), which left session 91's tab bar unverifiable. A same-origin iframe **is** a
  real viewport, media queries and all. Cheap, no device needed.
- **Session 91 (d) — Tre's standing instruction:** before asking him a product/UX question, first ask
  *"what would be best for my customers?"* and **lead with a recommendation**. Never hand him an
  unweighted menu. Saved to memory as `feedback_customer_first_recommendations`.
