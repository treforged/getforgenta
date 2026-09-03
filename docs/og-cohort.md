# The OG cohort — the first 100, and what they are owed

This document is the rule **in plain words**, so that in a year somebody can
answer "why did this person not get their free year?" without reading a trigger.
Where this file and the SQL disagree, the SQL is what actually happened and this
file is the bug.

Schema: `supabase/migrations/20260902_achievements_and_og_cohort.sql`.

---

## Who is an OG

The **first 100 accounts to become premium organically.**

- **Organic** means they paid. A comped account — anything granted through
  `grant-promo-premium` — is not one of the hundred. The test in code is that the
  subscription carries a real provider id (`stripe_subscription_id` or
  `revenuecat_app_user_id`); a promo grant has neither.
- **Premium** means `user_subscriptions.plan = 'premium'` with a status of
  `active` or `trialing`. That table is the single source of truth for premium in
  this system: the Stripe and RevenueCat webhooks are its only writers, and
  everything else — this cohort, the Conductor's revenue view — **reads it**
  rather than asking a provider directly. Two readers of two provider APIs
  disagree slowly and invisibly.
- Places are numbered 1–100 and each is taken once. The number is assigned by a
  database trigger the moment the subscription row says premium, not by an
  application, and not by a person.

**A user cannot make themselves an OG.** The `og_members` table grants
`authenticated` nothing but `SELECT` on their own row — no INSERT, no UPDATE, no
DELETE, and no RLS policy for any of them. Every write happens inside a
`SECURITY DEFINER` trigger. The matching badge, `og_founder`, is written the same
way: the `achievements` INSERT policy **enumerates** what a client may claim
(`lesson:%`, `follow_instagram`, `follow_tiktok`) and `og_founder` is not on that
list. This was tested by attempting it as a signed-in client, not by reading the
policy — the attempt is refused with *"new row violates row-level security
policy"*.

## What they get

**A free year, one year after they joined.**

`reward_due_at` is written at the moment they join — claim date plus one year —
rather than being re-derived later from subscription history. Tre's word for the
requirement was *trackable*, and a debt whose due date has to be reconstructed a
year afterwards is not.

## How the free year is actually granted

**Stripe is the only provider that can grant a free period.** RevenueCat, which
handles mobile, cannot.

Tre decided on 2026-09-02: **an OG who subscribed on mobile is moved to a
Stripe-billed plan at the one-year mark**, and the free year is granted there.

Two consequences worth stating plainly:

1. **The user is promised a free year, not a billing rail.** The migration is our
   operational problem and should be invisible to them. Never write copy that
   promises a mechanism.
2. `claimed_provider` records which rail they joined on, **at claim time**,
   because by the anniversary the subscription row may say something different.
   That column is what tells the anniversary run which members need migrating.

The migration path itself still needs building: moving a live RevenueCat
subscriber to Stripe without losing access mid-switch is the part that quietly
fails, and it is not written yet.

## Who keeps it, and who does not

**An OG keeps the free year if they are still with us at the anniversary — or if
the reason they are not is a billing failure rather than a decision.**

Evaluated by `og_reward_eligible(user_id, at)`. Three parts:

1. **Premium within 30 days of the anniversary.** A grace window, not a single
   day. A single-day equality check would forfeit a whole year over a card that
   declined on the wrong Tuesday.
2. **An involuntary lapse never forfeits.** Someone who paid for eleven and a
   half months and had a card expire in month twelve earned the year, and would
   be right to be furious about losing it. `lapse_reason = 'billing_failure'`
   qualifies.
3. **Ambiguity goes to the customer.** Where the provider does not tell us
   whether a lapse was a choice or a failure, the reason is recorded as
   `'unknown'` and it **qualifies**. Being wrong in the customer's favour costs
   one free year; being wrong against them costs the relationship — with the
   hundred people most invested in this product.

**The one case that does not qualify:** cancelling deliberately and staying gone.
That is precisely what the rule exists to exclude — cancel on day 2, resubscribe
on day 364, collect a free year.

Being *in* the cohort is permanent regardless. A lapse records `lapsed_at` and
never deletes the row: being one of the first hundred is a historical fact, and
it stays true even when the reward does not apply.

### How voluntary and involuntary are told apart

From what the provider actually told us, in `track_og_premium_state()`:

| Signal | Recorded as |
| --- | --- |
| `cancel_at_period_end = true` | `voluntary` |
| status `canceled` / `cancelled` | `voluntary` |
| status `past_due`, `unpaid`, `incomplete`, `incomplete_expired` | `billing_failure` |
| anything else | `unknown` (qualifies) |

`last_premium_at` is stamped every time we observe the account as premium, and
the lapse fields are **cleared** when they come back — someone who lost a card
and fixed it has not lapsed, and leaving the stamp would say they had.

This has to be recorded as it happens: `user_subscriptions` holds one upserted
row per user, so it is current state, not history. "Were they premium during the
grace window?" is unanswerable retroactively.

### Verified behaviour

Each case was executed against the live schema (inside a transaction that was
rolled back) rather than reasoned about:

| Case | Eligible |
| --- | --- |
| Still premium at the anniversary | ✅ |
| Cancelled deliberately, gone 200 days | ❌ |
| Card failed, gone 200 days | ✅ |
| Provider did not say why | ✅ |
| Cancelled, but premium 10 days before | ✅ |

## Achievements the app cannot verify

`follow_instagram` and `follow_tiktok` are **claim-based on purpose.** Neither
platform gives a consumer app a supported way to ask "does user X follow account
Y", so there is no version of this feature where the app knows. The RLS policy
says so honestly: a signed-in client may write both ids itself, which also means
anyone can mint them without following anything.

**Do not "fix" this by wiring it to something real — there is nothing real to
wire it to.** Two rules follow instead:

1. **A claimed follow must never unlock anything of value.** Cosmetic only. It may
   sit on a badge wall or count toward a streak. It must not gate a feature, a
   discount, or anything touching the OG reward. That is exactly why `og_founder`
   is *not* on the client-writable list while these two are: the test is whether a
   user could profit by lying.
2. **The wording is an intent, not an assertion.** The app says *"Tapped through
   to Instagram"*, because opening the profile is the event it actually observed.
   It must never say *"Followed us"* — printing a fact you did not measure is the
   same error as drawing a gauge value you never read. A test asserts the absence
   of that wording, not only the presence of the right one.

**Both handles are confirmed against a source**, and the provenance is recorded
because re-deriving it from the brand name is exactly the mistake to avoid:

| Network | Handle | Confirmed from |
| --- | --- | --- |
| TikTok | `@treforged` | `tre-forged-marketing/TIKTOK.md` |
| Instagram | `@treforged` | Instagram's own thread header ("TRE Forged" / "treforged"), read in-session by Sam, 2026-09-03 |

A wrong handle **does not fail** — it succeeds at sending users to a stranger's
profile. No error, no log line, nothing to notice. If either handle changes,
re-confirm it against the platform rather than against this file.

## The anniversary run

`supabase/functions/og-anniversary` runs daily and settles members whose year has
come due. Its decisions are a **pure module** (`_shared/og-anniversary.ts`) with
tests, deliberately: the first genuine anniversary is a year after the code was
written, so without a way to exercise it now it would run for the first time in
production, once, on a date nobody is watching.

Three properties, each one a lesson this repo paid for on 2026-09-02:

- **It fails loudly.** Every run writes to `og_anniversary_runs`, *including* a
  run that found nothing: "No members were due today" is a positive statement,
  not silence. `og_anniversary_last_run()` is the question a human or a monitor
  asks. The backup task on this machine reported success for six days while
  doing nothing; this one would go unnoticed for a year.
- **It can be rehearsed.** `?simulate_due_before=<iso>` pretends the date has
  arrived; `?dry_run=1` is the **default** and walks the whole path writing
  nothing but the run row. The dry-run flag is honoured at every write and
  tested — `FORGENTA_BACKUP_DRY_RUN` was defined and never read, and a
  "rehearsal" uploaded to Drive and deleted 17 folders.
- **It is safe to re-run.** Granting a free year twice costs real money, and the
  natural way to do it is a half-completed run that gets retried. Already-settled
  members are skipped, and every write is conditional on the row still being
  unsettled.

### ⚠️ A mobile OG cannot be migrated by us

This is a fact about the stores, not a gap in the code. **Only the user can
cancel an App Store or Play subscription**, and only the user can enter card
details for Stripe. So there is no version of this where the job silently moves
someone's billing rail.

The job's output for a mobile member is therefore `needs_user_action` with a
timestamp — an action that is *owed*, recorded — rather than a silent no-op. What
the ask should look like, and whether it risks a gap in their access, is a real
product decision and is **open**.

Recommended shape, for whoever decides it: offer the free year as a Stripe
checkout that costs nothing for twelve months, ask them to cancel the store
subscription only *after* it completes, and let the two overlap rather than risk
a day without access. An overlap costs them nothing because the Stripe side is
free; a gap costs trust.

#### ⛔ THE ASK GOES BY EMAIL. NEVER INSIDE THE APP.

This is not a design preference — it is the difference between a loyalty reward
and an app-store risk, and the penalty is not a warning, it is the app.

Telling an iOS user, **inside the app**, to pay outside the App Store is
anti-steering: historically the fastest way to get rejected or pulled. US rules
loosened after the Epic injunction, but it remains the most sensitive surface in
the store. Google's rules are looser and not absent.

So:

- **Deliver the ask by email.** An email to a customer is unambiguously outside
  the app; a screen inside it is not.
- **The in-app side may say a member is an OG and that their reward is being
  arranged.** It must not name Stripe, must not carry a payment link, and must
  not instruct anyone to cancel anything.
- **Use the same channel for both platforms**, so there is one flow to get right
  rather than two.

If a future change moves this into an in-app banner, modal or push, it is a
regression, not an improvement.

#### The consent record (Tre, 2026-09-03)

He authorised the Stripe route and added a requirement: *"id want it to notify
the user that their subscribtion would be moved to stripe and require a
confirmation. it would need to be tracked for legal reason."*

So the flow is **notify → explicit confirmation → act**, and the consent record
is a compliance artefact rather than a UX flag. `og_billing_consent` exists to
answer one question to a stranger a year from now: **who agreed, to what exact
wording, when, and by what action.**

- **The wording is STORED, not referenced.** `consent_text` + `consent_version` +
  a SHA-256, never a foreign key to live copy. Copy gets edited; a record that
  points at current text would silently start claiming people agreed to something
  they never read.
- **Append-only.** No UPDATE policy and no UPDATE grant for anyone, and no client
  INSERT — rows are written server-side. A record the subject can write or amend
  proves nothing. *Pressed as a signed-in client: insert, update and delete are
  each refused with "permission denied"; reading one's own row works.*
- **A decline and a non-response are both recorded.** `decision` is
  `asked` / `confirmed` / `declined`. An absent row is indistinguishable from
  never having asked, and "we asked and heard nothing" is a different obligation
  from "they said no".
- **It must be a real confirmation.** No pre-ticked box, no "continuing means you
  agree", and consent is never inferred from clicking a link in an email. An
  affirmative act on a page that states: the subscription moves to Stripe
  billing, it costs nothing for twelve months, what happens after that, and that
  they should cancel the store subscription only **after** this completes.
- **Nothing grants without a confirmed row**, and nothing is stamped granted
  unless Stripe itself confirmed the change.

##### The one place Stripe IS named

The general rule above — never name the billing rail in user-facing copy — is
**superseded for the consent text specifically**. They are consenting to a move
to Stripe, so the text must say so; consent to an unnamed thing is not consent.
Keep it out of marketing copy everywhere else.

##### The confirmation surface is email-and-web too

The anti-steering constraint binds harder here, not less: the ask goes by
**email** and the confirmation happens on a **web page**. Never in the app, and
never behind a link *in* the app. That is what keeps the whole flow outside App
Store payment rules.

#### Both halves, or it is not settled

The user performs two actions and **we only ever observe the first**: starting
the free Stripe year, and cancelling the store subscription. Some will do the
first and never the second; a few will cancel first and stall.

So a member who has been asked is recorded as `outstanding` — **counted and named
in every run summary until both sides are confirmed**, not skipped after the day
they were asked. An obligation that stops being mentioned is an obligation that
stops being kept.

## Open questions

- **The Stripe grant is written but not wired.** Applying the free year means
  creating a twelve-month 100% discount against a live subscription in a real
  payment account — an outward action to be authorised, not switched on quietly.
  Until it is, an eligible Stripe member is flagged `reward_action_required_at`
  rather than marked granted: a `reward_granted_at` written by code that granted
  nothing is exactly the class of lie this job exists to avoid.
- **The function is not deployed and no cron schedule exists yet.** Both are live
  changes and neither has been made.
- The mobile ask above is undecided.
- The user-facing copy is unwritten. It may now say the year is free — the
  mechanism is decided and honourable on both platforms — but it must not name
  the billing rail.
