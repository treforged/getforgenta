# Growth / retention pass - 2026-10-09 (Ada, cloud session)

Ask (Tre approved 10-09, dispatched by Sam): audit the first-run journey and the store listing now
that quick add shipped (main 7d24c9d), fix only small safe things on `claude/growth-pass-10-09`, and
rank what needs Tre's call. Nothing was deployed, submitted or sent. The DB reads below are
read-only SQL against production; no rows were written and no test account was created.

## The numbers first (measured 2026-10-09, read-only SQL)

| | |
| --- | --- |
| Real users, all time (excl. `@forgenta.test`) | 34 accounts in auth.users (incl. test accounts) |
| Real signups, last 90 days | **5** - one each in the weeks of 07-13, 07-20, 07-27, 08-03, 09-28 |
| Real signups, last 30 days | **1** (iOS, Sign in with Apple, 10-04) |
| ...of whom finished onboarding / saved a row / linked a bank / came back after day 1 | 0 / 0 / 0 / 0 |
| Signed in during the last 7 days | 4 |
| Paid subscriptions | 0 |
| Push tokens | 12 tokens on 3 users; `push-send-daily` calls the function without `?dry_run=0`, so it still sends nothing |
| Weekly newsletter recipients | 1 (unchanged since 09-10) |

⚠️ **"About 2 new users a week" is not what the database says.** It says about one a month since
August, and the only one this month never reached the first onboarding write
(`onboarding_furthest_step` is null). Acquisition is the bottleneck by an order of magnitude;
retention work compounds on almost nobody.

**Funnel since tracking began (10-01, env=prod):**
- Web: 16 `landing_viewed`, **0 `tap_store`**, 1 `signup_form_shown`, 0 signups, 1 `try_demo`.
- iOS: 18 `app_opened`, 6 `try_demo`, 6 `signup_form_shown`, 1 `signup_completed`, **0 `demo_signup_tap`**.
- Android: 24 `app_opened`; every one of its 14 OAuth taps (7 Apple + 7 Google, 10-01 to 10-03) ends
  in `auth_error: user_cancelled`, and none has an install_id. That pattern (paired taps, 3 days, no
  consent) looks like Google Play's pre-launch robots rather than people, but it is unproven. Cheap
  check: the Play Console pre-launch report for those builds.

## Ranked findings

1. **Acquisition is near zero, and the landing page converts nobody.** 16 web landing views produced 0
   store taps and 0 signups. The landing hero sells "Discipline builds wealth... the financial cockpit"
   while the store subtitle, the auth screen and the App Store promo all sell "Safe to Spend & Payoff
   Date". The first screen a visitor sees says something different from every screen after it.
   **Proposal A** (Tre's call: positioning).
2. **The onboarding finish screen gave wrong directions.** It said "The bar at the bottom has five icons:
   ... Garage for vehicles": Plan took Garage's slot on 10-06, and the `+` shipped today was not
   mentioned at all. It is the last thing a new user reads before entering the app. **FIXED.**
3. **The new-user tour gave four wrong directions and never named quick add.** It pointed to
   "Transactions -> Plan" (Plan is its own tab), "Activity -> Bank Activity" (renamed 08-27), a Garage
   step (no longer in the bar) and "Goals lives here" on Forecast. The premium tour pointed to
   "Activity -> Budget Control", "the Forecast tab" and "the menu at the top left". Its test had kept a
   hand-written list of tabs (`Activity`, `Forecast`, `Garage`), so it stayed green while every one
   went stale. **FIXED**, and the test now derives the tabs from `PRIMARY_NAV`.
4. **The demo never asks for the signup.** 7 demo opens (iOS + web) and 0 `demo_signup_tap`. The demo's
   "Sign Up Free" sits in a strip above the dashboard and is never offered again at a value moment
   (after an Add, or after opening Safe to Spend). **Proposal B.**
5. **Nothing reaches a user who doesn't come back on day 2.** Push is still a dry run and can only
   reach someone who already opened the app. The weekly email still goes to 1 newsletter subscriber,
   not to users. That was the 09-10 recommendation and it is still open
   (`docs/retention-recommendation-2026-09-10.md`). `no-save-nudge` (day 3-30, nothing saved) is the
   only lifecycle email, and it sends people back to the full wizard rather than to the one thing that
   takes a minute. **Proposals C and D.**
6. **A new user's Home had dead-end empty states.** "No transactions yet." / "No expenses recorded yet."
   offered no action, while the `+` sat unnamed in the bar. **FIXED**: both now offer quick add where it
   adds, with a 44px target.
7. **The landing page advertised Premium "unlimited history"**, a limit that does not exist. The
   copy-pointers gate's own header records exactly this phrase as a known false claim, fixed elsewhere
   and left on the landing (and in the static SEO block). **FIXED** in en, es and `index.html`: it now
   lists what `Premium.tsx` lists.
8. **On a first visit the cookie banner covers the bottom bar, `+` included** (390x844 /demo frame).
   The new 5-tap door is invisible until the visitor answers the banner. **Proposal E.**
9. **The store listing cannot be audited from the repo.** The App Store description, promo text, Play
   title and descriptions, and screenshot captions live only in the consoles. The 09-23 screenshots
   predate both quick add and Plan-in-the-bar, and slot 1 shows net worth while the subtitle sells
   Safe to Spend. Drafts: `marketing/app-store/listing-draft-2026-10-09.md`. **Proposal F.**
10. **The Premium page lists "Budget control"** (renamed Plan 09-18) among the free features. That is
    copy only, but it is on the paywall, so it is left for Tre rather than touched in a growth pass.
11. **There are no funnel events after signup.** Onboarding progress is a single furthest-step column,
    and there is nothing for "first transaction", "opened quick add" or "came back day 2". A change made
    today cannot be measured next week. **Proposal G.**

## What this branch changes (`claude/growth-pass-10-09`)

| Change | Files | Proof |
| --- | --- | --- |
| Finish screen "Where things are" is built from `PRIMARY_NAV` (no more hand-written tab list) and names the `+`, only where it adds (`quickAddIsOpen`) | `src/pages/Onboarding.tsx`, `src/lib/first-run-nav.ts` (new) | `first-run-nav.test.ts` (every bar destination has a purpose, none for a route the bar lacks, Plan and Garage both named) |
| Tour: 4 stale pointers fixed, a quick-add step (dropped for a free native account, whose `+` is a Premium door), Guide folded into step 1 to stay at 8 steps; premium tour's 3 stale pointers fixed | `src/lib/tour-steps.ts`, `src/components/shared/AppTour.tsx` | `tour-steps.test.ts`: tabs derived from the nav, the new dead names, quick add present when live and absent when gated. **Red on the old tour copy (2 failures), green on the new.** |
| One rule for "does quick add add here" (`quickAddIsOpen`), used by the provider and by first-run copy | `src/lib/quick-add.ts`, `src/contexts/QuickAddContext.tsx` | `first-run-nav.test.ts` (4 cases); `QuickAddContext.gate.test.tsx` unchanged and green |
| Home empty states offer quick add | `src/pages/Dashboard.tsx` | typecheck + existing Dashboard tests; **not yet seen in a browser** (needs an empty signed-in account) |
| Landing "Premium Tools" line made true | `src/locales/en/landing.json`, `src/locales/es/landing.json`, `index.html` | `landing-static-text.test.ts` green (copy and static block agree) |

Gates run in the cloud: `npx tsc --noEmit` clean; eslint on the changed files 0 errors; 465 tests
across pages, shared components, contexts, copy-pointers, quick-add and tour; `npm run test:tz`
(result in the commit message / handoff).

**Not run here (no walk credentials in the cloud), for the PC:** `npm run walk:empty` and
`npm run walk:first-run` on a throwaway `@forgenta.test` account, to SEE the finish screen's new box
and Home's new empty-state buttons; `npm run check:narrow-overflow SIGNED_IN=1` at 320 for the new
finish-screen line.

## Proposals that need Tre's call (each with a recommendation)

- **A. Landing hero to the approved positioning.** Recommend: headline "Know what's safe to spend
  before payday." (the auth screen's approved line), subtitle "Add your bills and paychecks. Forgenta
  shows what's safe to spend until your next paycheck, and the month your cards hit zero.", and put the
  sample Safe-to-Spend card from `/auth` on the landing. Keep "Discipline builds wealth" as the
  founder-note heading. Cost: copy plus the static SEO block. Reversible.
- **B. Demo -> signup at the value moment.** Recommend: after a quick add on /demo (it already reaches
  the read-only refusal), show "That's the 5-tap add. Make it yours: Sign up free" instead of only
  the refusal toast. That counts as a gated change in the native demo, so it is Tre's call.
- **C. Send the weekly email to users (the 09-10 recommendation, still open).** Recommend yes: product
  email on by default with a working unsubscribe; content is their own dated numbers.
- **D. Point `no-save-nudge` at quick add.** Recommend changing the body's ask from "finish setup" to
  "add how much you get paid" plus "log one purchase with the + (five taps)". It is an edge-function
  edit plus a deploy (`npm run deploy:fn -- no-save-nudge`), so outward-facing.
- **E. Cookie banner off the bottom bar on phones.** Recommend lifting the banner above the bar
  (bottom offset = nav height) rather than shrinking it. UI-only, but it touches consent UI, so it is
  his call.
- **F. Store listing.** (1) Submit 6.8.2 so the approved name ships. (2) Paste the promo text in
  App Store Connect (it changes without a version). (3) Re-shoot slots 1, 3 and 5. (4) Keep the
  description and Play copy in the repo (`marketing/app-store/`) so the next pass can diff them.
- **G. Measure the first week.** Recommend three anonymous `signup_funnel_events` steps:
  `onboarding_finished`, `first_transaction` (any source) and `returned_day2`. These are the numbers
  this pass could not read.
- **H. Android OAuth "user_cancelled" x14.** Recommend reading the Play pre-launch report before
  anyone debugs sign-in. If they are people, Android sign-in is broken for every one of them.

## Not done, on purpose
No pricing or gating changes, no deploys, no store or console writes, no email sends, no test
account created in production, and nothing on the other cloud session's branches
(`claude/add-tx-free-web`, `claude/rent-split-plan`).
