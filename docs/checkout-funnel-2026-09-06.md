# Why nobody has reached the end of checkout

Measured **2026-09-06** from live Stripe `acct_1TCRGl2cDVgFonAb` (39 checkout sessions, all of
them) and Supabase `mdtosrbfkextcaezuclh`. **Nothing is built by this document.** Sam asked for the
measurement before any redesign, because 31 users and one self-paid charge is a number with a
cause, and the cause is findable.

## ⛔ THE SHORT ANSWER

**Nobody has reached the end of checkout because almost nobody reaches the START of it — and the
one feature worth $89.99 is locked behind the paywall, so 29 of 31 users have never seen it work.**

The payment step is not where this fails. It is the last and smallest loss in the chain.

## The funnel, measured, with n on every line

| Step | n | of 31 |
|---|---|---|
| Signed up (`auth.users`) | **31** | 100% |
| Created a recurring rule | 17 | 55% |
| Set an income | 12 | 39% |
| Created an account | 6 | 19% |
| Recorded a transaction | 4 | 13% |
| **Linked a bank** | **2** | **6%** |
| Came back at all after day one | 9 | 29% |
| Ever opened a Stripe checkout (external people) | **5** | 16% |
| Ever saw the **$89.99** price | **3** | 10% |
| **Ever paid it** | **0** | **0%** |

⚠️ **These rows are measured from the DATA, not from a flag.** `profiles.onboarding_completed`
says 6 of 31 finished setup, and that figure is a FLOOR rather than a count: `onboarding-state.ts`
documents two completion stores, and a user who finished the old route wizard carries only a
`localStorage` key until their next visit migrates it.

⚠️ **CORRECTION, made the same day by the author.** This section first said
`onboarding_started_at` and `onboarding_furthest_step` are "written by nothing", the same shape as
`profiles.is_premium`. **THAT WAS FALSE.** Both are written by `recordFurthestStep`
(`Onboarding.tsx:98`), which is correct code — monotonic, ordered against *this user's own* step
sequence, and writing `started_at` exactly once. It shipped **2026-09-05 in `821dc985`**, and there
have been **no signups since**, so the columns are empty for want of traffic rather than for want of
a writer. Their zeroes still cannot be quoted as "nobody started" — but the reason is the opposite
of the one first given, and the instrumentation is already there for the next thirty signups.

**How the error was made, because it generalises:** a multi-pattern `grep` piped through
`head -20`. `onboarding_completed` has 30 hits and saturated the window; the other two patterns
have 9 and 10 hits and never appeared. **Truncated output was read as absence.**

## The checkout sessions themselves

**39 sessions, 7 distinct emails, and the last one was 2026-05-18 — 111 days ago.**

| Amount | Status | Sessions |
|---|---|---|
| $89.99 | expired | **18** |
| $9.99 | expired | 9 |
| $4.99 | expired | 4 |
| $4.99 | **complete** | **1** |
| $0.00 | complete | 7 |

- **At $89.99: 18 sessions, 3 people, 0 completions. Ever.**
- **Every completed session by anyone other than Tre was $0** — the 100%-off coupon.
- The only paid completion in the account's history is Tre's own $4.99.
- Two of the seven emails are Tre (`tre@treforged.com`, `tvonhines@gmail.com`) and account for
  **31 of the 39 sessions**. Only **5 external people have ever opened a checkout page at all.**

### ⚠️ The two minutes that say the most

Both external people who saw the real price left it within minutes and took the free path instead:

```
devanee    01:05  complete  $0
devanee    01:15  complete  $0
devanee    01:17  EXPIRED   $89.99     <- opened, abandoned
xarlithion 10:31  EXPIRED   $89.99     <- opened, abandoned
xarlithion 10:33  complete  $0         <- two minutes later
```

**Read this carefully rather than as a pricing verdict.** n = 2 people. What it proves is narrow
and still useful: the checkout path **works end to end** — session creation, Stripe, the webhook,
the entitlement — because $0 sessions complete through exactly the same code. **What stops is not
the machinery.**

## Why 6% is the number that matters

Bank linking is **premium-gated**: `plaid-create-link-token/index.ts:83` requires
`subscription_status` in `('active','trialing')`. So the 2-of-31 who linked a bank did so *because*
they already had premium, not on their way to buying it.

Turned around: **29 of 31 people have been asked to pay $89.99 for automatic bank sync without
ever having seen it work on their own money.** And there is no trial — `trial_period_days` is null
on all three live prices and `create-checkout` sets none (`docs/commission-stage-1-numbers.md`), so
there is no supported way to see it first.

## Signups are also falling, which caps everything above

| Month | Signups | Returned after a day |
|---|---|---|
| 2026-03 | 2 | 2 |
| 2026-04 | 6 | 2 |
| 2026-05 | **14** | 4 |
| 2026-06 | 5 | 1 |
| 2026-07 | 3 | **0** |
| 2026-08 | 1 | **0** |
| 2026-09 | **0** | — |

**11 people signed up after the last checkout session was ever created, and not one of them opened
one.** Retention is the harder number: **9 of 31 ever came back after day one**, and in July and
August that was zero of four.

## What this rules OUT, which is the useful half

- ❌ **"Checkout is broken."** It is not. Eight sessions completed through the same code path.
- ❌ **"The price is wrong."** Possibly true, unmeasurable here: n = 3 people ever saw it.
- ❌ **"We need a referral programme."** A multiplier on a funnel that converts nobody is zero.
  This is why the commission programme was shelved on 2026-09-06.
- ✅ **What is left standing:** people do not get far enough into the product to want it, and the
  thing they would pay for is the thing they are not allowed to try.

## Open, ranked — a decision for Tre, not a slice to start

1. **Let people see bank sync before paying.** A trial, a limited free link, or moving the paywall
   later. This is a product and pricing decision with real Plaid cost attached, so it is his.
2. **Every abandoned setup BEFORE 2026-09-05 is unrecoverable evidence** — at least 25 of 31
   people did not finish and no step was recorded. **This is already fixed going forward**:
   `recordFurthestStep` shipped 2026-09-05 (`821dc985`) and writes both columns. Nothing to build;
   the next signup starts producing the data.
3. ⚠️ **`profiles` holds 49 rows for 31 users — 18 have no `auth.users` row at all.** Orphans from
   deleted accounts. Not a funnel problem, but it means "49 profiles" is never a headcount, and
   any query joining the two must say which side it counts. Deleting them is destructive and is
   deliberately not done here.
4. **Retention before acquisition.** 0 of 4 July–August signups returned. More signups against
   that rate change nothing.

## Evidence standard

Every figure above was read on 2026-09-06 from live Stripe or from Supabase SQL, and the n is
stated on each. Where a column could not be trusted, it is named and excluded rather than quoted —
see the warning under the funnel table.
