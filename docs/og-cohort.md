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

## Open questions

- The RevenueCat → Stripe migration path at the anniversary is **not built**.
- Nothing yet *runs* at the anniversary. `og_members_reward_due_idx` indexes the
  members with `reward_granted_at is null` so the job can find them cheaply, but
  the job does not exist.
- The user-facing copy is unwritten. It may now say the year is free — the
  mechanism is decided and honourable on both platforms — but it must not name
  the billing rail.
