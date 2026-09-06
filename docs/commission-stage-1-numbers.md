# Commission programme, stage 1: the three numbers

Read on **2026-09-06** from the **live** Stripe account `acct_1TCRGl2cDVgFonAb` (TRE Forged LLC)
and from Supabase `mdtosrbfkextcaezuclh`. **No code was written for this stage** — it is three
numbers and their `n`, because a payout priced off a made-up rate is worse than one that waits.

## ⛔ THE HEADLINE, BEFORE THE THREE NUMBERS

**There is nothing to pay a commission on yet. Lifetime gross revenue is $4.99, and it is Tre's
own card.** Exactly one charge exists in the live account's entire history. Every other
subscription on the account is 100% off, forever.

That is not "a sample too small to price against". It is **n = 0 external paying customers**.
Every rate below is therefore reported as a count, never as a percentage.

---

## 1. Price and plan mix

**Prices are real and knowable. The MIX is not, because nobody has paid one.**

| Price id | Amount | Interval | Used by |
|---|---|---|---|
| `price_1TKXd02cDVgFonAbfApHZHkd` | **$9.99** | month | `create-checkout` (`plan: 'monthly'`) |
| `price_1TDyCe2cDVgFonAb5P637p2r` | **$89.99** | year | `create-checkout` **default**, and `grant-promo-premium` |
| `price_1TCZWP2cDVgFonAbtUAJHskT` | **$4.99** | month | ⚠️ **nothing** — still `active: true` in Stripe, referenced by no code |

All three sit on one product, `prod_UAvNdaidQ1zGal`. `create-checkout` sets
`allow_promotion_codes: "true"` and **no** `subscription_data.trial_period_days`.

- **Plan mix: n = 0.** There is no paid subscriber to attribute to a plan.
- **8 live subscriptions exist** (6 active, 2 canceled) and **all 8 carry the coupon
  `8G9evoSQ` "TRE Forged 100%" — `percent_off: 100`, `duration: forever`,
  `times_redeemed: 8`.** The redemption count matching the subscription count is what makes
  this airtight; it is not inferred from a database flag.
- ⚠️ **`public.subscription_tiers` says $9.00 / $90.00 with NULL `stripe_price_id_*`.** That row
  is stale, unwired, and matches no live price. **Do not quote it as the price.** The prices are
  the Stripe objects above and the ids hardcoded as fallbacks in `create-checkout/index.ts:19-20`.

## 2. Trial-to-paid conversion, and churn

**Neither number exists, and for two different reasons.**

**Conversion: there is no trial to convert FROM.** All three live prices have
`recurring.trial_period_days: null`, and `create-checkout` sets no trial. The `"trialing"` status
handled in ~10 edge functions comes from RevenueCat's `period_type === "TRIAL"`
(`revenuecat-webhook/index.ts:140`) — an Apple-side intro offer, not a web funnel. So the web
conversion rate is not low; **the funnel is not built.**

**Churn: n = 8, all of them comped, so any rate is fiction.** Two of the eight are canceled, and
one of those is Tre's own $4.99 monthly cancelled **22 minutes** after creation
(`sub_1TFTz32c…`, created 1774593303, ended 1774594632) and replaced the same minute by the
100%-off annual. That is a **plan swap, not churn.** A "25% churn" read off this would be wrong
in both the numerator and the population.

Population, for scale — none of these are customers:

| | n |
|---|---|
| `auth.users` | **31** |
| `user_subscriptions` rows / distinct users | **11 / 9** |
| Rows with `plan='premium'` and `subscription_status='active'` | **6** |
| `profiles.is_premium = true` | **3** |
| `og_members` | **0** |

⚠️ **The 6-vs-3 gap is real and unexplained** — two tables disagree about who is premium. It is
not a commission problem, but anything that pays out on "became premium" would have to pick one,
so it is recorded here rather than discovered later.

### ⚠️ `is_comp` AND `purchase_provider` ARE COLUMN DEFAULTS, NOT EVIDENCE

`user_subscriptions.is_comp` defaults to `true` and `purchase_provider` defaults to `'stripe'`.
**All 11 rows carry the default on both**, which means no webhook has ever written either one.
A row reading `is_comp: true, purchase_provider: 'stripe'` is indistinguishable from a row where
nothing was recorded at all. This nearly became a reported finding ("every subscription is
comped") sourced from the flag; **the comp fact is true, but it comes from the Stripe coupon's
`times_redeemed: 8`, not from that column.** Do not read these two columns as facts.

## 3. Refund and chargeback rate

| | |
|---|---|
| Charges in live history, all time | **1** |
| Its amount | **$4.99**, 2026-03-25 |
| Its payer | `tre@treforged.com` / TreVon L Hines — **Tre's own card**, visa …5630 |
| Refunds (`GET /v1/refunds`) | **0** |
| Disputes (`GET /v1/disputes`) | **0** |
| **Lifetime gross revenue** | **$4.99** |

Refund rate 0/1 and chargeback rate 0/1, on **n = 1 self-paid charge**. Both are unmeasured, not
good.

**Apple is not visible from here.** Two `user_subscriptions` rows carry an
`apple_original_transaction_id` and both read `canceled`. This session has no App Store Connect
access, so App Store revenue is **unread**, not zero. Someone with the console must confirm it
before any payout maths treats total revenue as $4.99.

---

## What this means for stages 2 and 3

Stage 2 (tracking design) and stage 3 (UGC bounty) are still worth writing, because the design
work does not need revenue to exist. But **any percentage-of-revenue payout is currently a
percentage of zero**, and the first real question is not "what rate" — it is whether a commission
programme should launch before a single non-founder has ever paid.

The one piece of good news for stage 2: `allow_promotion_codes: "true"` is already set on
checkout, so a per-affiliate promotion code is a Stripe-side change and not an app change.
