# Reach users - proposals C, D, G (2026-10-09, Ada, cloud)

Tre said yes via Sam on 10-09 (growth pass, `docs/growth-pass-2026-10.md` on `claude/growth-pass-10-09`).
Branch: `claude/reach-users-10-09`. **Nothing is deployed, no migration is applied and no email was sent.**
No live database was read for this work; the schema comes from `supabase/migrations/` and the types file.

## What each part does

**C. The weekly email reaches app users.** `newsletter-digest` now mails every confirmed real user
(test domains excluded) a short email about their own account:
- Safe to Spend until payday, with its date, but only if the app computed it in the last 72 hours and
  payday has not passed. Otherwise no figure.
- How many entries they saved this week, or, if none, a link that opens quick add.
- "Add your pay" if they have no income set.
- Blog posts from the last 7 days, when there are any.
- Footer: why they get it, a one-click unsubscribe link, "TRE Forged LLC" and the postal address.

Newsletter-only subscribers (not app users) keep the blog digest. Anyone who unsubscribed from the app
email is also left off the newsletter list.

**It is a dry run by default.** Without `?dry_run=0` it only reports counts. A real send also refuses
until `EMAIL_UNSUBSCRIBE_SECRET` and `EMAIL_POSTAL_ADDRESS` are set, and refuses above 200 recipients.
The response never contains an email address.

Unsubscribe: new function `email-unsubscribe`. The link is signed (HMAC) so it can only unsubscribe its
own owner. Gmail / Apple Mail's built-in Unsubscribe button works (RFC 8058 one-click POST). Opening the
link shows a page with one button; just opening it changes nothing (mail scanners open links). It sets
`profiles.email_unsubscribed_at`, which also stops `no-save-nudge`.

**D. no-save-nudge points at quick add.** The email now asks for one purchase ("press + ... about five
taps") with a link to `/dashboard?quickadd=1`, which opens the quick-add sheet on arrival, and asks for
pay second. It used to link to `/onboarding` (the full wizard).
⚠️ To make that link work for the people it is sent to (they have not finished setup), `/dashboard`
with `?quickadd=1` now skips the setup redirect. Every other route, and a plain `/dashboard`, still
sends them to the wizard. Nothing is written for them. Undo: `passesOnboardingGate` in
`src/lib/quick-add-link.ts` returns false.

**G. First-week funnel.** Three new anonymous rows in `signup_funnel_events`: `onboarding_finished`
(wizard save landed), `first_transaction` (first entry, detail says `manual` or `bank`), and
`returned_day2` (signed in on a later day than signup). Only in the account's first 7 days, once per
account per device, `detail` = day since signup (`d0`..`d6`). No account id, name or email, and nothing
under an analytics rejection, same as the existing steps. Read:

```sql
select step, detail, count(*) from signup_funnel_events
where env = 'prod' and step in ('signup_completed','onboarding_finished','first_transaction','returned_day2')
group by 1, 2 order by 1, 2;
```

## Tre's steps to turn each on (in this order)

1. **Merge the branch** (it is not on main; a push to main deploys the web app). G and D's link need the
   web app; C and D's emails need the functions.
2. **Apply both migrations**: `20261009_weekly_email_to_users.sql`, then `20261009b_signup_funnel_first_week.sql`.
   Until 20261009b is applied, the three new funnel rows are refused by the table (silently; nothing breaks).
   ⚠️ Assumption: `auth.users` has `deleted_at` and `banned_until` (standard Supabase Auth). If not, the
   first migration fails on apply and nothing changes.
3. **Set two secrets** on the edge functions: `EMAIL_UNSUBSCRIBE_SECRET` (any long random string; never
   change it later, it would kill every link already sent) and `EMAIL_POSTAL_ADDRESS` (the LLC's mailing
   address, one line; a PO box registered with USPS is allowed).
4. **Deploy**: `npm run deploy:fn -- email-unsubscribe newsletter-digest no-save-nudge`. Read each back:
   `email-unsubscribe` should come back as `version: 1` (new) with `verify_jwt: false`.
5. **Check the unsubscribe page renders** before any send: open one link in a browser (a dry run does not
   make links; sign one by hand or send yourself the first real email via step 7). ⚠️ Supabase may serve
   HTML from `*.supabase.co` as plain text. If the page shows raw HTML, the one-click button in Gmail /
   Apple Mail still works (it POSTs and reads no page), but the link in the footer will look broken;
   tell the desk and the page moves to getforgenta.com.
6. **Dry run**: the Monday cron already calls the function without `dry_run`, so Monday's run reports
   `app_users`, `with_safe_to_spend`, `blockers` in `net._http_response`. Or call it once by hand with the
   cron secret.
7. **First real send**: change the `newsletter-digest-weekly` cron URL to end in `?dry_run=0` (a migration
   or a one-line `cron.alter_job`). Until then, the one newsletter subscriber also gets nothing.
8. **D needs only step 4** (and the web app merged for the link). It keeps the reply-to-unsubscribe line
   until the secret is set.

## Your decisions

- **Is the weekly email commercial?** It has the account figure (transactional-ish) and blog posts plus
  "add a purchase" asks (promotional-ish). The build treats it as commercial: postal address, one-click
  unsubscribe, honoured right away. Keeping it that way is the safe reading. If you want it treated as
  purely transactional, the blog section should come out.
- **Opt-out vs opt-in.** It goes to every confirmed user unless they unsubscribe (the 09-10
  recommendation: product email on by default). Fine for CAN-SPAM; if you ever mail people in the EU or
  Canada, they need opt-in.
- **The quick-add link skipping the setup redirect** (part D above). Recommend keep: otherwise the nudge
  lands every recipient on the wizard it is trying to route around.
- **Postal address on the nudge too?** It still has none (your decision 0e582396). It now carries the
  one-click unsubscribe once the secret is set.
- **Subject lines** are "Your week in Forgenta" and the nudge's unchanged "Your Forgenta plan is one minute
  away". No money in subjects (they show on lock screens).

## Not covered
- No in-app switch for email preferences yet; the only way back in is writing to contact@.
- Not seen in a browser: `/dashboard?quickadd=1` for a signed-in un-onboarded account (needs walk
  credentials; PC step: `npm run walk:empty` style account, open the link, the sheet must show).
- The email HTML is not rendered in a real mail client.
