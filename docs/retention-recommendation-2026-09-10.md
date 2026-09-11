# "What do you recommend for retention?" — answered 2026-09-10

**Short answer: stop building channels and point the one you already have at your users.**

You have two retention channels built, deployed, running on schedules, and reporting success.
**Between them they reach one person, and that person is you.** Nothing needs to be built to fix
that. The work is a redirect, not a feature.

---

## The measurement

```
Users                      31        Ever returned after day one     9
Active in 7 days            2        New signups in 30 days          0
Active in 30 days           4        Confirmed email addresses      27
```

## Channel 1 — push. Built, firing, reaches 1 user.

`push-send` is deployed, `push-send-daily` runs at 17:00 daily, `push_send_runs` holds 7 runs.

**`device_tokens` holds 9 tokens belonging to exactly 1 user — you.** All minted 09-05 and 09-06,
none since.

⚠️ **A push token is only minted when someone opens the app.** So the 23 dormant users have no
token, and no amount of send-side work can give them one. **Push cannot reach a dormant user by
construction.** It is the right channel for someone who comes back at least once; it is
structurally the wrong one for someone who has stopped.

This is the same correction that was made about *local* notifications on 09-05, one layer up, now
true of the thing that was built to fix it.

## Channel 2 — email. Built, firing, succeeding weekly, reaches 1 person.

`newsletter-digest` is deployed. `newsletter-digest-weekly` runs every Monday at 15:00 UTC. It
has run **4 times in the last 30 days and succeeded all 4 times.**

**It sends to `public.newsletter_subscribers`, which holds 1 row.**

**27 users with confirmed email addresses receive nothing.** The job is not broken — it is
pointed at the marketing-site signup list, not at the people who actually installed the app. A
succeeding cron that reaches nobody looks exactly like one that works, which is why this sat for
weeks.

---

## The recommendation, in order

### 1. Point the existing weekly email at your users. This is the whole thing.

Everything needed already exists and is already proven in production:

| Piece | State |
|---|---|
| Resend integration | ✅ used by 7 edge functions |
| Weekly cron | ✅ `newsletter-digest-weekly`, succeeding |
| Branded HTML template | ✅ in `newsletter-digest/index.ts` |
| `List-Unsubscribe` header | ✅ already sent |
| UTM tagging | ✅ already on every link |
| Per-user preference storage | ✅ `profiles.notification_prefs` jsonb, already transport-agnostic |

**What it would take:** a second recipient query against confirmed users, an `email` key inside
`notification_prefs` with an unsubscribe path, and content that is about *their* money rather than
the blog feed. **Roughly a day**, no new service, no new dependency, no new cost — Resend's free
tier covers 27 recipients many times over.

⚠️ **The one thing that is genuinely new is CONSENT, and it is the part to get right.** These
people signed up for an app, not a newsletter. A product email to your own users with a working
unsubscribe is ordinary and legitimate; the same email sent without one is not. Default the
preference **on for product email, off for anything promotional**, and honour the unsubscribe
header that template already sends.

### 2. What it should say, since that decides whether it works

The blog digest is the wrong content for a dormant user — it is about you, not about them. **The
thing you have that no newsletter has is their own numbers.** One sentence that could only be
written about them beats any amount of product news:

- *"Your Prime Visa statement posts in 3 days."*
- *"Three cards are due this week."*
- *"You're 40% of the way to your truck."*

That is a digest only your app can send, and it is the same content the push channel already
computes — so the two share a content layer rather than being two products.

⚠️ **And it is only honest if the data is fresh.** `plaid-daily-sync` runs daily, but a user
dormant for 30 days may have expired bank connections, so a figure in an email could be stale in a
way the app would show as stale and an email cannot. **Send the number with its date, or send no
number.**

### 3. Then acquisition, because retention compounds on nothing

**Zero signups in 30 days.** Retaining 9 people harder does not grow anything. This is a bigger
problem than retention and it is worth saying plainly rather than leaving implied.

### 4. What I would NOT do

- **Do not build more send infrastructure.** Two working channels already reach one person.
- **Do not write 23 emails by hand.** I suggested that yesterday, before finding the weekly cron
  was already live and succeeding. **The pipe exists — use it.** Correcting that here rather than
  quietly dropping it.

---

## What needs you

**Sending is yours, not mine.** Nothing outward-facing was written, queued, or sent. The two
decisions:

1. **Product email to your 27 users, on by default with a working unsubscribe — yes or no?** My
   recommendation is yes.
2. **Their numbers, or the blog digest?** My recommendation is their numbers, dated.

## What I did not do

No email was sent. No recipient query was changed. No cron was touched. `newsletter-digest` is
exactly as it was.
