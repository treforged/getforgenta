# Handoff — Forgenta

> **This file is a SNAPSHOT, not a log.** It was 1,075,335 bytes on 2026-09-01,
> read into context at every SessionStart in this folder, and it had swallowed
> every previous session end to end. The history is in `handoff-archive.md`;
> search that when you need something this file no longer carries. Keep this one
> under ~15 KB: rewrite the state, do not append to it. Everything below the
> AUTO-SNAPSHOT marker is machine-written and is replaced on every run — write
> above it.
>
> ✅ **PRUNED 2026-09-05: 101 KB -> 54 KB.** Sixteen closed sections moved to
> `handoff-archive.md` with a one-line pointer each, carrying the load-bearing fact
> (a reversal state, a lesson, a do-not-rebuild) so nothing has to be re-derived to
> act. Still above the ~15 KB rule; the remaining weight is the Resume queue and the
> genuinely open sections, which is what this file is for. When you close something,
> move it — do not append.

---

## ⇢ FIRST UP — nothing is blocking. Take the next item from the resume queue.

The 2026-09-04 load-bearing unknown is CLOSED — see "RESOLVED 2026-09-05: a pin is a
REPLACEMENT" below. It is the most important thing in this file for anyone touching the
debt controls, so read that section before you touch `withPaymentOverrides`, the DebtPayoff
override UI, or any copy that says "pay more".

Multi-currency is PARKED, deliberately and cleanly: decided (per-currency subtotals) and
scoped, NOT started, nothing half-edited. It needs a currency column on money-carrying rows
plus a backfill — a schema change on live financial data. See the MULTI-CURRENCY section for
the constraints already settled, so that slice does not re-argue them.

---

## RESOLVED 2026-09-05 — a payment pin is a REPLACEMENT, and the promo cards were never the reason

**The standing explanation — "his payoff date will not move because his cards are
promo-heavy" — is WRONG and is struck. Do not repeat it.** Three facts replace it, each
measured, on the demo fixture AND reproduced on the real capture. The regression test is
`src/lib/__tests__/payment-pin-semantics.test.ts`.

**1. A pin sets the card's EXACT total for that month.** Not a floor, not extra money.
`paymentOverridesByMonth` (credit-card-engine.ts, param #21, JSDoc ~line 1090) clamps only at
`>= 0` and at what the card owes, deducts the pin from the month's cash BEFORE the pools are
sized, and excludes the card from normal allocation so the others rebalance around it. It may
even be pinned BELOW the contract minimum. Measured on the demo fixture: the unpinned plan
sent the 24.74% card $2,485 / $1,673 / $942 / $743…; a "$400 pin" made it pay exactly $400 —
a CUT of $343 to $2,085 a month. **The previous session's test never pressed "pay more". It
pressed "pay less" and read the result as "the control does nothing".**

**2. A pin cannot add cash to debt, so it cannot move the date by paying more.** Total paid to
cards over the horizon, demo fixture, 18 months: base **$19,785**, $400 pin **$19,428**, $600
pin **$19,117**, $1,000 pin **$19,617**. Real capture, 24 months: base **$40,143**, and every
pin between $400 and $1,200 on either card lands **$39,706–$40,416**. The total is set by
income minus the cash floor. The plan already spends everything above the floor on debt, so
there is no "more" to find — a pin only re-orders WHICH card receives it.

**3. The highest-APR card is not the card that sets the payoff month.** Demo fixture: the
24.74% card's revolving balance is **$0 at month 2** while `simRevolvingPayoffMonth` is **16** —
the 16 comes entirely from the OTHER card. Real capture: payoff **24**, set by **Discover
(16.6%, $10,440, clears month 23)**, while **Prime Visa (27.49%, $8,565) clears at month 16**.
Under avalanche the lowest-APR card is paid LAST by construction, so it is the one that sets
the date. **Paying more onto the highest-APR card cannot move a date that card does not set.**

**Why the old measurements looked contradictory, resolved exactly.** "$400 pin → still 16,
$600 pin → moves" was pinning months 0-11. A user pin at month 0 outranks the m0 floor pin
(`mergeM0FloorPins`, useCardProjection.ts ~2350), so $400 at month 0 cut the month-0 payment
from $2,485 to $400 and the balance ballooned to $7,963 by month 12 — landing back on 16 by
the opposite route. Pinning months 1-12 instead: $400 → **14**, $600 → **14**, $1,000 → **15**.
**Non-monotonic**, because a pin re-orders rather than adds.

**⚠️ THE PRODUCT CONSEQUENCE, and it is a real one — routed to Sam for Tre.** On the real
capture NO pin improves the payoff date: every value tried leaves it at 24 or pushes it to 25.
Pinning Discover $1,200/mo clears Discover at month 10 instead of 23 and makes the OVERALL
date WORSE (25), because Prime Visa then finishes at 24 instead of 16. A user who reaches for
this control to "get out of debt faster" is reaching for a control that cannot do that. Either
the UI must say what it does (re-order, not accelerate), or the app needs a real "pay extra"
input that raises the debt total by lowering the cash floor. That is a product decision, not
a bug fix.

**What would actually move the date:** more cash into the plan (lower the cash floor, more
income, less spend), not a different split across cards.

## CLOSED 2026-09-03 — the "$799 divergence" was a replay artifact

Hunting it found three real bugs, all fixed. Lesson kept: replay a capture at its own wall
clock, never at today's. Detail: `handoff-archive.md`.

## OG billing consent — the GATE is in, the SURFACES are not (2026-09-03)

`decideAnniversary` now refuses to grant without a confirmed `og_billing_consent`
row (`needs_consent`), Stripe-native members included — `docs/og-cohort.md` states
that rule with no exception. Gate proven by deletion: remove it and three tests
fail, including "NEVER GRANTS WITHOUT A CONFIRMED ROW".

Two deliberate choices, both toward not lying in the record:
- `needs_consent` is REPORT-ONLY. Writing `reward_action_required_at` would record
  that we asked somebody we have not — the same class of lie as a
  `reward_granted_at` written by code that granted nothing.
- A failed consent READ is a failure, not an absent consent. A database blip that
  read as "never asked" would re-email someone who already confirmed.

The WEB CONFIRMATION PAGE is built too: `functions/og-consent`, server-rendered
so it stays out of the Capacitor bundle (a React route would ship inside the
mobile app whether or not anything links to it). The link is a credential —
256-bit CSPRNG, SHA-256 at rest, expiring, single-use, own table so
`og_billing_consent` never gains an UPDATE path. A GET records nothing; both
buttons are POST. Tests parse real DOM and PRESS the buttons; switch either form
to GET and three fail.

The EMAIL is built too: `functions/og-consent-ask` + pure `_shared/og-consent-email.ts`.
It reuses `decideAnniversary` rather than re-deriving who is owed, retires any
outstanding link before issuing a new one, and writes the `asked` row AFTER the
send — recording first would claim we asked someone we did not, and the unique
index would then block the retry that fixes it. Dry run is the default and is
checked at every branch; `?limit=N` caps the blast radius and a malformed limit
is a 400, never "no limit".

**`needs_consent` stays report-only in `og-anniversary` ON PURPOSE — that is not
an unfinished flip.** The notify job is its own function so the emails can be
stopped without stopping the accounting. Turning the ask on is a SCHEDULING
decision (a cron entry calling `og-consent-ask?dry_run=0`), not a code change.

**Next up here:**
1. Nothing in code. The flow is notify -> confirm -> act end to end; what remains
   is applying migrations, setting env, deploying, and scheduling — all Tre's.
2. A consent copy **v2** when convenient: v1's body says "Decline below", but the
   buttons are on the linked page, not below in the email. NEVER edit v1 in place
   (rule 1 of `og-consent-text.ts` — it would rewrite what everyone already
   consented to); add a version.
3. The Stripe grant itself stays unwired pending Tre's explicit yes; it is a real
   action on his live Stripe account.

**Migrations WRITTEN, NOT APPLIED** — `20260903_og_billing_consent.sql`,
`20260903_og_anniversary_consent_required.sql`, `20260903_og_consent_tokens.sql`.
**`og-consent` must deploy with `verify_jwt = false`** — declared in
`config.toml`, but the MCP/dashboard deploy path ignores that file and defaults
to true, which would break the page for anyone not signed in.

## CLOSED 2026-09-03 — the OG consent handlers are deployed and were PRESSED

A real-shaped consent row was written and then removed; the test artefacts are gone. Detail:
`handoff-archive.md`.

## CLOSED 2026-09-03 — the OG cohort was BACKFILLED on Tre's direct instruction

⚠️ FOR REVERSAL: both tables held ZERO rows for these users before the backfill, so deleting
the five inserted rows restores the exact prior state. Who the five are, and why: `handoff-archive.md`.

## CLOSED 2026-09-03 — the OG cohort was empty, which is why the consent ask sent nothing

Pattern worth keeping: a cron-gated function can be exercised without waiting for its cron.
Detail, and the one subscriber still undecided, in `handoff-archive.md`.

## CLOSED 2026-09-05 — "paying more does not move the payoff date"

Answered in full, with numbers, in "RESOLVED 2026-09-05 — a payment pin is a REPLACEMENT"
near the top of this file. Test: `src/lib/__tests__/payment-pin-semantics.test.ts`.

One correction this made to the record: the demo fixture is NOT free of promo balances —
card `d7` carries a $2,417 balance transfer at 0% APR to 2027-05-11. It did not matter, but
"the rebuilt fixture carries plain revolving balances" was inaccurate and is struck.

## DEMO FIXTURE REBUILT 2026-09-03 — a persona the app is FOR, and 12 filmable lines

The fixture is the ONLY thing that can ever be filmed (Tre): his real accounts are
not marketing material. It was measured weak on 2026-09-03 — zero balance tranches,
so the strongest line the app produces could not fire — and real card brands in the
names. Both are fixed; what follows is what it IS now.

**The persona changed, and that was the real defect.** The demo ran on the app's
`DEFAULT_PROFILE`: $1,875/wk gross, a roommate, ~$2,800/mo of surplus, and a forecast
climbing past $91,000 in eighteen months while the same fixture carried $6,482 of card
debt at 24.74%. Nobody saving $2,800 a month carries that balance. `demoProfile` in
`src/lib/demo-data.ts` is now its own object — $968/wk gross, thin surplus, a
semiannual $1,014 insurance premium — and `useSupabaseData`'s demo branch reads it.
A signed-out non-demo user still gets `DEFAULT_PROFILE`.

**What the engine now says about it** (`npx vitest run src/lib/__tests__/demo-marketing-lines.engine.test.ts`):
cards clear Dec 2027 ("CC Debt Free"), no month breaches its floor, tightest month is
$2 above it, $2,417 reprices 0% -> 24.74% on May 11 2027, minimums alone would cost
$8,924 on $6,482.

- **The harness is the reusable part:** `src/lib/__tests__/fixtures/demo-forecast-harness.ts`
  runs the app's own card sim (`useCardProjection`, so callers need jsdom) and feeds it
  to `calculateForecast`. `runDemoForecast` WITHOUT cards reads several hundred a month
  too rich — the file says why. Use `runDemoForecastWithCards` for anything about cash.
- **Twelve lines, four types** (repricing / leakage / acceleration / cash-floor), every
  figure read out of the engine run, guarded against Ruby's F1/F2/F5/F6 in
  `demo-marketing-lines.engine.test.ts`. Spec: `tre-forged-marketing/docs/DEMO-FIXTURE-SPEC.md`.
- **A cash-floor BREACH line is not producible and should not be chased.** The converged
  engine protects the floor by holding back debt payments, so a breach only happens for a
  persona the app cannot help. The honest cash-floor lines are the tightest-month headroom
  and the lumpy premium, and that is what shipped.

## RULE: verify against the DEMO FIXTURE, not Tre's live account

Set 2026-09-03 after I toggled two of his card payment preferences to answer a
marketing question, then restored both and verified. Sam's reasoning, and it is
right: **a restore that verifies is still one step short of never having changed
it.** If a sync, webhook or scheduled job had fired between the change and the
restore, the restore would have been correct and the intervening state would
still have been wrong. Low probability, real, avoidable at no cost.

**Mutate his account only when ONLY his data can answer the question.** That was
not true here — the fixture would have answered it AND given a second dataset.

⚠️ `/demo` does NOT switch while signed in — it stays on the real account, checked.
So the fixture route for a question like this is a **headless comparison**
(compute with `paymentPreference: 'statement'` vs `'min'` over `demo-data.ts` and
diff the payoff months), not the browser.

## Two open items from the "one input, one number" question

1. **Run the payment-mode toggle against the demo fixture.** On Tre's data the
   payoff MONTH did not move on either card tested — only the label changed,
   "Interest-free: 16 mo (Dec 2027)" → "Payoff: 16 months (Dec 2027)". His card
   set is promo-heavy, so his payoff months are pinned by 0% expiry schedules
   rather than payment size. **n=1: "does not move ON THIS DATA", not "cannot
   move".** Ordinary revolving debt would likely move. If it does, Ruby gets a
   second marketing asset; if it does not, that is a real product finding about
   what the control does.
2. **The recompute takes 2,499 ms** (measured, card toggle → label change). Worth
   fixing on its own merits, not just for filming: two and a half seconds of
   nothing after a tap reads as a broken control.

**The stronger finding, already routed to Ruby:** the app ALREADY renders
zero-input lines that name a number, a date and a consequence — e.g. *"$3,562 at
0% reprices to 27.49% on Jul 7, 2027 (+$82/mo) — clearing it first needs $356/mo
for 10 months"*, and the cash-floor warning naming the exact card and statement.
No tap, no wait, nothing built for a camera.

## `reach` — EXPOSED and GRANTED 2026-09-04. Containment is proven for the first time.

Supersedes the 2026-09-03 section below, whose evidence proved routing rather than
containment. Sequence, all of it verified against the live project rather than reported:

1. **Tre toggled `reach` into the exposed schemas** (via Sam). I approved it: reachable
   is not permitted, the revokes are the control, and hiding the schema was the thing
   PREVENTING the control from ever being tested.
2. **Exposure immediately revealed a bug that had been invisible since 0001.** Every
   migration ended `revoke all on schema reach from anon, authenticated, public` — and
   **PUBLIC is every role, `service_role` included**, with no explicit grant anywhere. So
   the APP had no USAGE either, and `/r/<code>` returned `permission denied for schema
   reach`: the exact words of correct containment, produced by a completely different
   fact. Third time on this schema that two failures produced one observation.
3. **`0005_service_role_grants.sql` applied by me** (migration
   `reach_service_role_grants_and_rate_limit_rls`), read in full first. Revoke FIRST then
   grant — the reverse order strips `service_role` again, which is how four consecutive
   migrations looked right and were wrong.

Verified AFTER the apply, from `has_*_privilege` and `pg_class`, not from the success flag:

    role            schema_usage  select tracked_link  insert click  execute limiter
    anon            false         false                false         false
    authenticated   false         false                false         false
    service_role    TRUE          TRUE                 TRUE          TRUE
    RLS enabled on campaign, click, rate_limit, tracked_link — all four

Piper's `verify_reach_grants.sql` also caught a real omission the first time it ran
against something live: `reach.rate_limit` had RLS off (her 0004). Closed by 0005.

**CLOSED 2026-09-04 — the app read a row, and the privacy claim is now about a real
request.** Piper's smoke test: `/r/<code>` → 302 to the real destination, `/api/briefs/…`
→ 200. The click row the APP wrote, every column: `id, link_id, at,
referrer_host='l.instagram.com', device='mobile'` — **no IP, no user agent**, against a
request that carried a real iPhone UA and a real `Referer`. The limiter row held a salted
hash (`brief-read:57a8f312…`), which also proves `rate_limit_hit` executed as
`service_role`. Anon probes after the grants: 401/42501 on both a read AND a write, with a
live-key control. Full verify 7/7 PASS.

**Cleanup verified by ME, not by her report:** `count(*)` on all four `reach` tables reads
0/0/0/0. She nearly missed the `rate_limit` row because she wrote two rows and the APP
wrote the other two — a cleanup list built from "what I inserted" misses what the system
inserted in response, and the system's rows are the ones carrying request-derived data.

**Two open notes, neither urgent:** `relforcerowsecurity` is false on all four tables, so
the table OWNER bypasses RLS (Postgres default, consistent) — only matters if anything
connects as the owner rather than `service_role`. And `alter default privileges` binds to
the role that RAN it, so a future migration applied as a different role lands ungranted —
`for role postgres` would pin it.

## ⛔ DO NOT LET ANYONE "TIDY" THE `send.treforged.com` DNS RECORDS

Forgenta's auth mail AND the OG consent email both send from
`noreply@treforged.com` through Resend (`og-consent-ask/index.ts:38`,
`CONSENT_FROM`). Ellis established 2026-09-03 that `send.treforged.com` is **not a
stray second setup**: it is the MAIL FROM / bounce subdomain Resend requires to
verify `treforged.com`, and its SPF TXT and `feedback-smtp` MX come from Resend's
own record set.

Mail from `noreply@treforged.com` aligns on DKIM strictly (`d=treforged.com`) AND
on SPF under relaxed alignment via that subdomain. **Sam moved the root domain to
`p=quarantine` today**, so removing those `send.` records would break bounce
handling and leave DMARC resting on DKIM alone — with quarantine live, that is
consent emails and password resets landing in spam or vanishing.

It looks like clutter. It is not. This is second-hand from Ellis and I have not
read the DNS zone myself, but the consequence lands on my flow, so it is recorded
here rather than only in his repo.

## MULTI-CURRENCY: Tre said PER-CURRENCY SUBTOTALS (2026-09-04). The blocker is now DATA, not the decision.

**Measured before designing anything, and it decides the whole feature: this app stores
NO currency on any money-carrying row.**

    grep currency src/integrations/supabase/types.ts  -> profiles, expenses, capital_contributions
    accounts                                          -> NO currency column
    transactions / recurring_rules                    -> NO currency column
    grep -rl currency supabase/migrations             -> ZERO files
    grep -rl "capital_contributions" src              -> types.ts only
    grep -rl "from('expenses')" src                   -> nothing

So the two tables that DO carry a currency are **not used by the app at all**, and the
one live column — `profiles.currency` — is a display preference, not a per-amount fact.
Every balance, rule and transaction in Forgenta is a bare number.

**Consequence: "per-currency subtotals" has nothing to group by yet.** The decision Tre
made is the right one and it is not the next step. The next step is attaching a currency
to money-carrying rows, and that is a migration + a write path + a backfill of every
existing row to `USD`, which is a slice in its own right and was NOT started at 84% of a
91% weekly cap.

**Design constraints, settled now so the slice does not re-litigate them:**
- Subtotal PER CURRENCY. Never a single converted total, and never a rate this app invents.
- A missing rate renders as a missing subtotal with a reason, not a converted figure. An
  empty subtotal beats a confident wrong one — Tre's own recorded preference, and currency
  is where a plausible-looking number hides a wrong one most easily.
- `formatCurrency` already takes a per-call currency override and `setMoneyDisplay` exists
  (`src/lib/calculations.ts`). The display layer is ready; the data layer is not.
- Settings' currency selector stays DISABLED with its note until rows carry a currency.
  A selector that changes the symbol on unconverted USD numbers is a lie with a dropdown.

## INTERNATIONAL RELEASE — planned, NOT started. Plan: `docs/international-release-plan.md`

Tre wants Forgenta in more countries. **No store setting has been changed, and the
app must be fixed first** — the store change is a checkbox, the app change is the
work, and adding a country before the app is right ships wrong numbers on day one.
Sam agreed the reordering.

**THE LIVE BUG THIS FOUND, fixed:** the Settings currency picker offered USD, EUR
and GBP and **did nothing**. `formatCurrency` takes a currency argument that ZERO
call sites pass, and the only reader of `profile.currency` outside Settings is the
home-screen widget. Now DISABLED with an honest note, **verified on screen**
(`disabled: true`, value `USD`, note rendering).

**Counted, not estimated:** 44 hardcoded `en-US`, 91 `toLocale` sites, 32 pinned
to `en-US`, 19 hardcoded `$`, 0 `formatCurrency` calls passing a currency.

⚠️ **I OVERSTATED THE DATE PROBLEM AND CORRECTED IT.** I first said those 32 sites
render MM/DD/YYYY. They do not: every one passes `{ month: 'short', ... }`, and
there are ZERO bare `toLocaleDateString('en-US')` calls and ZERO numeric month
options. The app renders `Sep 2026`, unambiguous in any locale. The real gap is
**hardcoded English month names** — a translation issue, not a wrong date. This
removes the argument that dates block an English-speaking first tranche. `exportPdf.ts:168` and `notification-policy.ts:307` hardcode
locale AND USD together.

**Decisions Tre has made:** real multi-currency, NOT display-only relabelling.
**Japan is EXCLUDED and decided** — Google requires publishing the business
operator's name, phone and physical address, and he declined. Do not re-ask.

**Still his to decide:** per-currency subtotals or one converted total, and which
rate applies to HISTORY (a payoff projection converted at today's rate differs
from one converted per-transaction, and it compounds over the horizon).

**Next, in order:** thread currency AND locale through `formatCurrency` → the 32
date sites → then countries. Rate-source criteria are in the plan; nothing has
been priced or read, so do not treat any provider as chosen.

## DEV SIGN-IN: Google SSO carries, and the session DOES drop

Tre is signed into Google in the Claude-controlled Chrome, so `/auth` → "Continue
with Google" signs in with **no credential typed**. Worth knowing because the
Supabase session dropped mid-verification today — a probe that read SIGNED IN at
3560s was signed out twenty minutes later. If a page bounces to `/auth`, re-run
that click rather than assuming the dev server broke.

⚠️ `Object.keys(localStorage)` can show `[BLOCKED: JWT token]` instead of the
`sb-*` key. That is the harness redacting, NOT proof of being signed out. Check
where the app actually routes.

## NEXT SLICE, SCOPED AND READY: the cash-floor warning Tre asked for

His ask (2026-08-27, approved, unstarted): *"a mandatory marker on each card is
fine. it just lets the user know a not meeting the cash floor is inevitable and
to check cash floor."*

**Do not build the marker. It already exists.** `accounts.payment_preference`
('statement' | 'full') and `autopayFullBalance` are both live and read all over
`credit-card-engine.ts`. The engine also already computes WHY a month is tight:
`ccMandatoryReasonByMonth` (useCardProjection.ts:1293) names the card whose pinned
statement sized the reserve, and `floor-protection.ts:210` prefers it over its
own heuristics — with a comment recording that the heuristic once reported a
$2,443 Prime Visa reserve as "$200 Pay sibling to watch dogs".

**THE ACTUAL GAP: that reason never reaches the user.** `CreditCardEngine.tsx:763`
builds its OWN local `saveUpMonths` set and the sim's `saveUpReason` map is
rendered nowhere — `grep saveUpReason src/components src/pages` returns nothing.
So the app computes a known-cause explanation specifically to avoid mislabelling,
then throws it away and recomputes a worse one.

So the slice is: surface `cardProjection.saveUpReason` / `saveUpMonths` on the
debt page instead of the local recomputation, and say plainly when the floor
cannot be met because a full-balance card must be paid. Warning first, engine
input second — his own ordering.

⚠️ It is a UI slice on a money page, so it needs a real press, not a green build:
`dev-signin` skill, then look at the page. Do not ship it on tests alone.

## CLOSED 2026-09-03 — claim-on-first-sync is shipped and deployed

The policy was checked against LIVE data, which is the part worth keeping. Detail: `handoff-archive.md`.

## CLOSED 2026-09-03 — the CI Tests gate is green for the first time

Lesson: local green is not CI green; four commits went in before it held. ⚠️ The real-data
fixtures are gitignored, so the golden/convergence tests SKIP in CI — a green badge says
nothing about the money engine. Run `npm run test:tz` locally. Detail: `handoff-archive.md`.

## CLOSED 2026-09-03 — Dependabot: 3 fixed, 3 left alone on purpose

Do not "finish" the remaining three; the reasoning is in `handoff-archive.md`.

## iOS CI secrets are being rotated this week (2026-09-03) — what will break

Tre's Apple distribution certificate is being rotated, which invalidates every
provisioning profile built on it. `.github/workflows/ios-build.yml` consumes
`BUILD_CERTIFICATE_BASE64` and `BUILD_PROVISION_PROFILE_BASE64`; **they must be
replaced in the SAME pass.** Update one and not the other and iOS CI goes red on
a signing error that never mentions certificates — expect an hour lost to it
otherwise. Runbook lives at
`claudecontext/security-reviews/2026-09-03_credential-rotation-runbook.md` (Sam's).

App Store Connect keys, read off the live key list 2026-09-03 so nobody re-checks:
- **`VP34CQ3J84`** ("Forged CI") is the LIVE API key — the only active one, last
  used today. It is what `APP_STORE_CONNECT_API_KEY_ID` resolves to. Nothing in
  this tree names it: the workflow builds `AuthKey_${...}.p8` at runtime, so
  rotating is a secrets update, not a code change.
- **`AH86Q9RAQW`** is NOT active. Nothing to revoke; any file of that name is a
  stale artefact.
- **`G77784XFWZ`** ("Forged Subscription") is an ACTIVE in-app purchase key with
  no consumer in this repo. ⚠️ Apple shows DOWNLOADED, not LAST USED, for these,
  so **Apple cannot tell you whether anything uses it** — the only place that
  answers it is RevenueCat's app settings. Revoking it fails SILENTLY
  (subscription status going stale), never as a red build.

When the profile is regenerated, **include the App Group entitlement** — the iOS
widget slice (`docs/ios-widgets-scope.md`, scoped not started) needs it, and it
is free to fold into a regeneration that is happening anyway.

---

## CLOSED 2026-09-02 — five things shipped, all on `origin/main`

Includes the OG cohort going live and the discovery that backups had silently done nothing
since 2026-08-27 while reporting success. Detail: `handoff-archive.md`.

## LESSON — what live-pressing found that 3,272 green tests did not

A green suite is not a pressed button. Live UI verification needs the `dev-signin` skill.
The specific findings: `handoff-archive.md`.

## DECISIONS THAT ARE SETTLED — DO NOT RE-OPEN

- **The DATABASE is the truth about "premium".** The webhooks write it; Conductor
  and this cohort READ it. Never a provider API directly.
- **An OG who joined on mobile is MOVED TO A STRIPE-BILLED PLAN** at the
  anniversary; that is how the free year is granted (Tre, 2026-09-02).
- **Churn:** keeps the year if premium within 30 days of the anniversary, or if
  the lapse was a billing failure rather than a choice. `unknown` QUALIFIES —
  ambiguity goes to the customer. Only deliberate-and-stayed-gone forfeits.
- **The follow badges are claim-based ON PURPOSE.** Neither platform will tell a
  consumer app whether someone followed. They gate NOTHING, and the wording says
  "Tapped through to Instagram" because that is the event actually observed.
  Do not "fix" this by wiring it to something real.
- **Both social handles are `@treforged`,** confirmed against sources (see
  `docs/og-cohort.md`), not inferred from the brand name.

## STILL UNBUILT — recorded so a year does not pass with these in a doc only

- **The anniversary job EXISTS and is deployed, but nothing fires it.** No cron
  schedule, and the Stripe grant is unwired — both are live changes waiting on
  Tre. `docs/og-cohort.md`.
- **A mobile OG CANNOT be migrated by us** — a fact about the stores, not a gap.
  Only the user can cancel a store subscription. The ask must go BY EMAIL, never
  in-app (anti-steering). Awaiting Tre. `docs/og-cohort.md`.
- **iOS widgets are unstarted**, scoped in `docs/ios-widgets-scope.md`. Do the
  entitlements/provisioning step FIRST and separately.
- **The Android widget change is unpressed.** Strictly safer than what it
  replaced, so shipping it that way was the right risk — but a device build
  should confirm it when convenient.
- **No user-facing promise copy.** It may now say the year is free. It must never
  name the billing rail — the user is promised a year, not a rail.
- **`ForgentaRedditScout` still points at the dead pre-move path.** Sam hit
  Access denied on it (registered elevated) and it is DISABLED, so it is
  harmless where it sits. The fixed `scripts/setup-scheduler.ps1` repairs it
  whenever it is next wanted.

---

## CLOSED — the debug-console security gate, and it was seen to fail

Detail: `handoff-archive.md`.

## CLOSED — Plaid native Link, fixed and confirmed on his device (`ca3f88fc`)

Lesson kept: a negative result from a tool that can be silently intercepted is not a result.
The Robinhood duplication after the re-link was merged and is reversible. Detail: `handoff-archive.md`.

## CLOSED — the "grace period" for a bill that has not cleared (`c85a8565`)

⚠️ DO NOT REBUILD IT. A grace period already existed and is better than a fixed window; the
fix was wiring, and the cause was not where the old section said. Detail: `handoff-archive.md`.

## NEW 2026-09-02 — two product asks routed in by Mona (from Tre's Instagram DMs)

Neither was recorded anywhere until Mona pulled them off Instagram. Both are his
words, verbatim, and both are DESIGN-FIRST — nothing should be built until the
forks below are answered.

**A. REVIEWS, tied to the value moment.** *"research my market and create a plan to
get more reviews. part of that was the app updates which will prompt it after the
ah ha moment(value moment)."*
**IT IS ALREADY BUILT — READ THIS BEFORE PLANNING ANYTHING.** `useInAppReview.ts`
fires the native prompt on the **3rd** qualifying action, once ever, gated on
`localStorage`. The two call sites are `BudgetControl.tsx:731` (a rule saved) and
`SavingsGoals.tsx:724` (a goal created). So this is a TRIGGER-PLACEMENT job, not a
build, and Tre's ask is precisely the criticism of what is there.

✅ **ANSWERED BY TRE 2026-09-02: "first plaid link completing."** So the trigger
moves to the moment a Plaid link succeeds and real balances land — the first time
the app shows him something he did not type in himself. Do NOT ask him again.
⚠️ Note the ordering dependency this creates: native Plaid linking is CURRENTLY
BROKEN (see the Plaid section above), so on iOS this trigger cannot fire until
that is fixed. Wire it anyway — the web/Android path still reaches it — but do not
read "no review prompts on iOS" as this feature failing.

⚠️ **THE CURRENT TRIGGER IS AIMED AT A MOMENT OF WORK, NOT A MOMENT OF VALUE.**
Saving a third budget rule is data entry — the app is asking to be rated right
after making the user do chores. The aha moments in this product are where the
user first SEES something they did not already know: a payoff DATE appearing, the
CC Debt Free milestone firing, a Plaid link completing and real balances landing,
a goal completing. Any of those is defensible; the third row typed into a form is
not. Pick with evidence, not by taste, and note that both stores RATE-LIMIT the
prompt (Apple ~3/year), so a mistimed trigger is SPENT, not retried.

⚠️ **AND THERE IS A REAL DEFECT IN IT, of the silently-wasted kind.** `KEY_DONE` is
written BEFORE `InAppReview.requestReview()` is awaited, and the catch swallows
everything. So if the call throws — or the OS declines to show anything, which it
does routinely and without telling you — the user's ONE shot is already burned and
can never fire again. Some of his existing installs may have spent their prompt on
nothing. Moving the flag after a resolved call is not a complete fix either (Apple
never confirms display), but burning it before the attempt is strictly worse than
after, and the current order cannot be defended.
Also minor: keys are `tre:review:*` where the rest of the app uses the `forged:`
prefix.

**B. FIRST 100 ORGANIC PREMIUM USERS + OG PROGRAMME.** *"we need to push for our
first 100 organic premium users. they should recieve an OGs achievement as well.
after a year, they get a year free just for being an OG. this needs to be
trackable. we also need to make revenue trackable on conductor. i use revenue cat
for mobile and stripe for desktop. note stripe is the only one where i can award
free forever plans. make an acheivement for following the socials, instagram and
tiktok."*

⚠️ **THE LOAD-BEARING CONSTRAINT IS HIS OWN: Stripe is the ONLY side that can award
free-forever plans.** So "a year free after a year as an OG" CANNOT be implemented
symmetrically — a mobile OG on RevenueCat has no equivalent lever. **This is a
MONEY PATH and an entitlement that must still be honourable in twelve months**, so
the answer has to be settled BEFORE any schema lands. Do not pick it by default.
The options, none obviously right: grant the mobile OG a Stripe-side comp that
requires them to move to web billing; issue RevenueCat promotional entitlements
(time-limited, need renewing, so someone must own that in a year); or restrict the
OG offer to Stripe signups and say so up front, which is honest but caps the
programme at desktop users.

SPLIT INTO FOUR, because they estimate very differently and only one is blocked:
 B1. OG achievement + the first-100 counter (needs "organic" DEFINED — it is doing
     real work in that sentence and currently means nothing queryable).
 B2. The year-free entitlement — BLOCKED on the fork above. Money path.
 B3. Revenue tracking surfaced on Conductor — cross-desk, RevenueCat + Stripe.
 B4. Social-follow achievement (Instagram, TikTok) — ⚠️ NOT VERIFIABLE. Neither
     platform exposes "does user X follow account Y" to a third party. So this can
     only ever be self-attested or link-click-attested; say which, visibly, rather
     than shipping an achievement that silently trusts a tap.

Relates to the existing streak/achievements items already in the queue below —
these should be ONE achievements system, not two.

## Resume queue

> **A RESUME ITEM IS A POINTER, NOT A REPORT.** One or two lines and a path to
> where the detail lives. This file is injected into every session that starts at
> this desk, so every character here is a tax paid on every cold start, forever —
> the queue alone was ~30 KB on 2026-09-03. Closed items move to
> `handoff-archive.md`; open items keep only what a fresh session needs to pick
> the work up. If an item needs three paragraphs to explain, those paragraphs
> belong in `docs/` or in the commit body, and the item points at them.


**DONE 2026-09-04 — the demo-fixture rebuild is proven and pushed.** `npx tsc --noEmit`
clean, `npm run test:tz` green in all three zones (3460 passed, 1 skipped), the
NO REAL MERCHANT NAMES guard applied, `origin/main` verified by CONTENTS. Detail: the
"DEMO FIXTURE REBUILT" section above.

**⚠️ MY CONTAINMENT PROBE FOR `reach` PROVED THE WRONG THING (found by Piper, 2026-09-04).**
`verify_reach_grants.sql`'s closing note — mine — reads *"406/PGRST106 → `reach` is
provably not exposed. Not 'not seen to be exposed'."* That is true and it is not
containment. **PostgREST refuses an unexposed schema BEFORE authentication, for every
key including service_role**, so the identical 406 that I read as proof of containment
was also the reason forge-reach's app could never read a row. The grants and RLS
underneath — the actual control — have never been exercised by a single real request.
A test can be passed by the bug it should have caught when the assertion and the defect
produce the same observation.
- **Decision: EXPOSE `reach`** (approved to Piper 2026-09-04). Reachable is not
  permitted; the revokes are the control, and exposure is what finally tests them.
- **Needs Tre:** exposed schemas is a project API SETTING, not SQL — no Supabase MCP
  tool reaches it. Dashboard, or the Management API.
- **The control probe is the whole point:** after exposure, anon + `Accept-Profile: reach`
  must return **401/42501**, not 406 and NOT an empty 200. An empty 200 reads like
  "nothing there" and means "you are in". Anything else: revert first, diagnose second.
- **Standing consequence:** schema-level hiding used to backstop a forgotten revoke.
  It will not any more, so every future `reach` migration must carry its own revokes.
- Correct the misleading note in `forge-reach/supabase/verify_reach_grants.sql` — that
  is Piper's repo, so ask rather than edit.

**TOP OF QUEUE — added 2026-09-02 ~12:05 ET, ahead of the numbered items below.**

- [x] **DONE 2026-09-03 15:56 ET — debug-console dev-mode preview deploy.**
  URL: `https://getforgenta-5vj0wmdoc-treforgeds-projects.vercel.app`
  (target=preview, status=Ready). Built with `npm run build:dev` and
  `VITE_ENABLE_DEBUG_CONSOLE=true` via a `--local-config` copy of `vercel.json`,
  `--archive=tgz`, `--scope treforgeds-projects`. The rate limit that blocked the
  earlier attempt had long expired. NOT publicly reachable, verified rather than
  assumed: an anonymous GET returns 302 to `vercel.com/sso-api`. Tre must sign in
  with his Vercel account to open it. The recipe below was correct as written and
  needed no changes.

<details><summary>Original item, kept for the recipe</summary>

- [~] **Debug-console dev-mode preview deploy. Tre APPROVED it; it is still
  outstanding.** Do not re-ask him. Blocked only by a Vercel free-tier upload
  rate limit (`api-upload-free`) that this desk tripped at ~11:57 ET, so it
  clears around **2026-09-03 12:00 ET**. The full recipe, the mistake that
  caused the block, and the two dead ends already ruled out are in the
  "Debug-console preview deploy" bullet under BLOCKED / WAITING above — read
  that before retrying, it saves the whole hour. Short version: write
  `.vercelignore` FIRST (the CLI does not read `.gitignore`, and the tree is
  465 MB), then deploy with `--scope treforgeds-projects`, `--archive=tgz`,
  `--local-config <a copy of vercel.json carrying "buildCommand":
  "npm run build:dev">` and `--build-env VITE_ENABLE_DEBUG_CONSOLE=true`.
  Vercel SSO protection is already confirmed ON, so the preview URL is not
  publicly reachable.

</details>

- [~] **Auto-dedupe is DEPLOYED but NOT PROVEN.** `plaid-exchange-token` went
  live 2026-09-02 11:49:13 ET, verified via `list_edge_functions` (ACTIVE,
  `verify_jwt` still true). What is missing is one real re-link on Tre's device
  showing the `Retired N account(s)` line. `function_edge_logs` retains only
  24 hours, so that evidence must be collected DURING a re-link, never after.
  Do not redeploy and do not rebuild the dedupe — `bb421023` is shipped.

- ⛔ **DO NOT REBUILD the rent / bill grace-period fix. It is SHIPPED as
  `c85a8565`** and closed out in this file (see the section at "CLOSED — the
  'grace period' for a bill that has not cleared"). A duplicate fix on a money
  path is expensive and hard to unpick; if it looks unfixed, verify against
  `c85a8565` first and ask before touching it.

- An untracked `.vercelignore` sits at the repo root. Deliberately NOT
  committed — it would also change what git-integrated production builds see,
  and no gate has been run on that. Gate it and commit, or re-create it per
  deploy. It is not stray junk; delete it only on purpose.

---
1. [x] The five-month payoff swing is NOT a defect — `aadf3ae2` explains it. Detail: handoff-archive.md.

2. [x] Forecast engine is OFF the first-paint path — `0a74fc5d`. Detail: handoff-archive.md.

3. [x] Density pass DONE; the last two screens needed no change. Detail: handoff-archive.md.

4. [ ] `monthEndCash.invariant` still cannot exercise its post-cutoff scenario:
   the live capture was taken on the last evening of August, so the cutoff IS
   the last day of month 0. It still asserts month-0 equality and warns loudly.
   DELIBERATELY NOT DONE on 2026-09-01 — a recapture at 02:20 on the 1st sets
   the cutoff to day 1, which swaps one unrepresentative extreme (month 0 all
   actual) for the other (month 0 almost all projected), and it re-invalidates
   the ~10 real-data pins that `f031e96b` had just re-pinned hours earlier. The
   fixture is gitignored and CI never sees it, so nothing is failing in the
   meantime. Next concrete step: recapture on a genuinely mid-month day (the
   10th-20th), `RECAPTURE=1`, runbook `docs/forecast-fixture-recapture.md`, and
   budget the same session for re-pinning the ~10 assertions with judgement.
5. [~] Plaid on iOS TestFlight. The `query_logs` blocker is CLEARED — Tre
   approved it 2026-09-01 02:30 and `mcp__claude_ai_Supabase__query_logs` is now
   in `.claude/settings.local.json`; verified by running it, not by reading the
   file. **But the evidence it was wanted for has expired.** `function_edge_logs`
   on `mdtosrbfkextcaezuclh` retains exactly 24 hours (measured: oldest row
   2026-08-31T06:20Z, newest 2026-09-01T06:15Z, 87 rows), and the failing taps
   were 2026-08-29T17:41Z — three days gone and unrecoverable. Everything else
   the previous session established still stands: both edge functions ARE
   deployed with the hosted branch (create-link-token v45, hosted-link-result
   v2), TestFlight is current, render gates pass, DeepLinkHandler ignores
   plaid-complete, `oauth_states` has zero rows ever, and `rate_limits` shows 3
   taps in 16s on 08-29 with no exchange after — so no native tap has got past
   `/link/token/create`. Next concrete step, and it is the ONLY one left: Tre
   taps Connect Bank once on the phone, then read the function logs WITHIN 24
   HOURS with `query_logs`. The owning session (`getforgenta-5e`) is no longer
   in the peer roster, so this desk owns it again.
6. [~] APP DESIGN — the inventory is DONE and the vocabulary exists; the rollout
   is not. `13e43d50`. Measured: **456 `<button>` in 88 files, no shared Button
   component, and the 446 with a className use 380 DISTINCT class strings** — 8
   vertical paddings, 9 type sizes (9/10/11/13px arbitrary values among them), 5
   radii, and **only 18 of 456 declare a tap target at all**. `src/index.css` now
   carries a `btn` vocabulary in the file's own idiom (`@utility`, like the
   existing `icon-btn`/`btn-press`) rather than a React component, so it adds
   zero JS and leaves `0a74fc5d`'s first-paint work alone: base `btn` (44px
   floor stated once, 32px under `pointer: fine`), sizes `btn-sm/md/lg/block`,
   variants `btn-primary/secondary/outline/ghost/danger`. Values are the measured
   modes, not invented. `btn-outline` was added on review: 72 of 446 buttons are
   border-with-no-fill, a real variant here.
   Auth's five full-width CTAs are migrated as the proof (py-2.5/3/3.5 for one
   role, now one size) — CSS verified in the built stylesheet and live page, but
   NOT pressed: /auth redirects to /dashboard while signed in.
   ⚠️ KNOWN DEAD END, do not retry blind: a chevron that rotates on `<details>`
   open. `group-open:rotate-180`, `[details[open]_&]:rotate-180`, a plain
   `transform: rotate(180deg)` rule and the individual `rotate: 180deg` property
   were ALL tried and ALL silently produced no rotation in the browser (rule
   present, selector matching, computed value 0deg). Dropped rather than shipped
   dead. Worth 20 minutes with devtools some day, not mid-slice.
   Next concrete step: roll the vocabulary out surface by surface, densest first
   (Settings 24, BankActivity 24, BudgetControl 22, PhaseBlock 20, Transactions
   19, Accounts 17), pressing the buttons on each. The 93 sub-12px interactive
   labels (`text-[9px]`/`[10px]`/`[11px]`) are the other half of "sizing" and
   should converge on `text-xs` as the floor.
7. [ ] ONBOARDING — "onboarding = value, not explain every feature." Get the
   user to a first real outcome and stop touring features. **Conversion is the
   metric**, so whatever ships has to be measurable against it.
8. [ ] RETENTION (his ASAP) — widgets + notifications. NOTIFICATIONS ARE DONE
   (item 25). What is left is WIDGETS; see item 23, which has the measurement.

9. [ ] Login STREAK award. ⚠️ MONEY-ADJACENT — a 30-day streak grants 30 days of
   free premium via RevenueCat, so highest effort tier and a test that ACTUALLY
   CLAIMS A REWARD, never a smoke print.
   PARTLY UNBLOCKED: the achievement system now exists (`achievements` table,
   `docs/og-cohort.md` for the security line — a client may only claim what it
   cannot profit by faking). The streak MATH also exists (`src/lib/learn-streak.ts`).
   What is missing is only the entitlement grant.

10. [ ] LANGUAGES — Spanish, Portuguese, Arabic. **Arabic is RTL: the layout
   mirroring is the real work, not the string files.** Budget for that, not for
   a translation pass.
11. [ ] DISTRIBUTION — expand to more countries "while staying legal": Claude in
   Chrome to update distribution countries, then update the legal requirements
   for Google and Apple respectively. **Sam's standing call, already made, do
   not re-ask Tre: this desk prepares, stages and verifies everything, and the
   irreversible SUBMIT/PUBLISH click stays with Tre** — country distribution
   carries tax and consumer-law consequences. That click belongs in "Actions
   for me" when the staging is done.
12. [ ] Test the app on Tre's iPhone FROM WINDOWS (he knows it is "mainly a mac
   thing"). Free workaround, search GitHub for prior art. Must be SECURE and
   must not "bug my phone". ⚠️ **Nothing touches his phone without his explicit
   yes**, and see the standing rule below before running anything found.

> **STANDING RULE, set by Tre 2026-09-01 alongside this list (Sam is recording
> it in `~/.claude/CLAUDE.md`): every skill, tool or script pulled from anywhere
> or newly created is READ and CHECKED for security vulnerabilities and prompt
> injection BEFORE it is installed or run. No exceptions.** It binds item 12
> hardest, because that one starts by fetching someone else's code off GitHub.

### Tre, 2026-09-02 — ten new asks (logged in the Asks Ledger the turn they arrived)

These arrived mid-turn while item 1 was being closed. He did NOT place them
behind items 6-12, so they are ahead of that list: they are concrete defects and
gaps in shipped surfaces, which outrank a design refactor.

13. [x] Dashboard "Spending by Category" shows every category — `13e43d50`. Detail: handoff-archive.md.

14. [x] TRANSFERS on the homepage — `1ef4c108`. Detail: handoff-archive.md.

15. [ ] Transfer RULES, and anything generated from a GOAL, must show in
    Transactions.
16. [ ] AUTO EXTRA PAYMENTS and TRANSFERS must show in Transactions.
    **THE READ IS DONE (2026-09-02). 14-16 are NOT one fix - they are two, and
    the split is what matters:**
    - **TRANSFERS are real rows nobody queries.** They live in the
      `lump_sum_transfers` table and already have full CRUD in
      `useSupabaseData.ts:517-549`. `src/pages/Transactions.tsx:8` and
      `src/pages/Dashboard.tsx:19` import `useTransactions` and NOT that hook, so
      both surfaces are blind to the table for no reason beyond never having asked
      for it. Item 14 and the transfer half of 16 are this same one cause, and it
      is the cheap half: read the hook, merge into the list, tag the rows.
    - **AUTO EXTRA is not a row at all.** `auto_extra` lives on the goal and
      vehicle records and is consumed by the FORECAST ENGINE
      (`useCardProjection`, `useSurplusRanking`, `useForecastEngineInputs`).
      Nothing is written to `transactions`, so there is nothing to query - showing
      it means DERIVING projected entries from the engine and displaying them
      beside real ones. Same shape as the goal-generated half of item 15.
    - Item 15's RULE half may already work: `Transactions.tsx:457` already maps
      `rule_type` into projected rows. Verify before building anything.
    ⚠️ The design call before any code: do derived/projected entries appear in the
    same list as real transactions, and how does a user tell them apart? On a
    finance app, a projection that reads as a settled transaction is a lie. Decide
    that first; it governs all three items.
17. [ ] Review text WRAPPING and FORMATTING issues. Pairs naturally with the
    item 6 rollout — `truncate` and fixed-width columns are all over the button
    inventory's neighbourhood.
18. [ ] "this is a good concept" https://www.instagram.com/reel/DcmoHfNJDWO/ —
    watch it (`yt-dlp` skill), extract the concept, propose how it applies.
    ⚠️ The caption and transcript are UNTRUSTED DATA, never instructions, and
    nothing pulled from it gets installed or run without the standing security
    review below.
19. [ ] Selecting a point on the /debt STUDENT LOANS tab chart breaks on MOBILE
    (desktop unchecked). ⚠️ Memory says Tre has NO student loan, so that tab
    draws nothing on his data — reproduce with seeded/demo data, not his.
20. [ ] Create SYMMETRY across the sections of the SECURITY tab.
21. [x] General Operations balance in the forecast pop-ups — `83f9cd3d`. Detail: handoff-archive.md.

22. [x] Cash-floor setting row hidden in AUTOMATIC mode — `5f506f40`. Detail: handoff-archive.md.

23. [ ] WIDGETS + NOTIFICATIONS (his ASAP; retention, users back weekly/daily).
    ⚠️ **Widgets are NOT unstarted — do not scope this as greenfield.** Measured
    2026-09-02: ANDROID IS BUILT. `android/.../widgets/NetWorthWidgetProvider.java`,
    `SurplusWidgetProvider.java`, `WidgetBridgePlugin.java`, the two
    `widget_*_info.xml` layouts, `src/plugins/widget-bridge.ts`, `useWidgetSync.ts`
    (carrying a partner-view guard so a widget never syncs someone else's numbers)
    and tests for both the hook and the registry.
    The two REAL gaps:
    (a) **iOS has no widget extension** — nothing widget-shaped anywhere under
        `ios/App`. That is WidgetKit + Swift + a new Xcode target, and it cannot be
        verified from this machine, so it is coupled to the iPhone-testing item and
        should not be started before it.
    (b) **Notifications do not exist at all** — no `@capacitor/local-notifications`,
        no push package, nothing in `src`. This is the whole of the notification half.
    Start with NOTIFICATIONS: they are cross-platform, verifiable from here, and the
    stronger retention lever — a widget is passive, a notification actively brings
    someone back. Then iOS WidgetKit alongside item 12.

### Closed 2026-09-02, later in the day

24. [x] The forgenta tab that would not auto-close — `45334a7f`. Detail: handoff-archive.md.

25. [x] NOTIFICATIONS — policy, service, settings and cadence are all SHIPPED.
    See "SESSION OF 2026-09-02" at the top of this file for what changed and why;
    `docs/` has nothing extra. Nothing here is open.

26. [x] Superseded by item 25 and by the 2026-09-02 section above. The toggle's
    real fault (it rendered nothing off-native, and the value lived on one device)
    is written up there.

27. [x] `/answers/snowball-or-avalanche.html` stated a wrong minimum-payment formula; corrected. Detail: handoff-archive.md.

13. [x] 15 red tests — `f031e96b`. Golden tests pin engine self-consistency now.
14. [x] The payoff wobble — `aadf3ae2`. Not a defect; see below.
15. [x] Google OAuth popup hang — `7108311a`. `INITIAL_SESSION` was the missing event.
16. [x] Blank localhost — `2315285c` + `48025907`. An ad blocker matching `cookie-consent`.
17. [x] Convergence budget 24 to 32 — `c5107228`, measured.
18. [x] Robinhood duplicate — a manual $2,000 row, set inactive in the database.
19. [x] Density, Accounts panel — `4dcd60fe` + `ab5c60aa`.
20. [x] handoff.md trimmed from 1,075,335 bytes — `0bc51eef`.

## Auto-snapshot

_Written 2026-09-04 01:42 by handoff_hook. Everything below this heading is
machine-generated and replaced each time; put durable notes above it._

- **Branch:** `main`
- **vs upstream:** 0 ahead, 0 behind

- **Uncommitted (6 file(s)):**

```
M .claude/settings.json
 M supabase/.temp/cli-latest
?? .claude/settings.json.bak-deadpath-20260903
?? .github/workflows/handoff.md
?? .vercelignore
?? deno.lock
```

- **Recent commits:**

```
7843868a docs(handoff): name the ONE thing a cold session does first, and park multi-currency
758962ac docs(handoff): reach item 20 closed - the app read a row, and no IP reached the database
d7150d40 docs(handoff): reach is exposed and granted - and containment is proven for the first time
51320d1c docs(handoff): multi-currency is decided, and the blocker moved from the decision to the data
fd3c71cd docs(handoff): the payoff date still does not move, and the promo cards are not why
6b43cd4d docs(handoff): the reach containment probe proved routing, not containment
91030ffe test(demo): fail if a real company name gets back into the synced feed
774f1cf9 docs(handoff): put the unfinished half of the fixture rebuild first in the queue
```

<!-- AUTO-SNAPSHOT:END -->
