# The three reddit-scout cron jobs, unscheduled 2026-09-14

## Why they are gone

Jobs 13 (`reddit-scout-morning`), 14 (`reddit-scout-evening`) and 19
(`reddit-scout-retry`) embedded a webhook secret as a **literal string in
`cron.job.command`**. All three were `active = false`, so nothing was firing
with it, but the secret sat in a database table in the clear on an app Tre
intends to sell.

They were the only three jobs on this database doing that. The eight active
jobs already read their secret from `vault.decrypted_secrets` at call time, so
the correct pattern was already established here and these three predated it.
Rewriting them in place would have preserved a burned secret, so they were
unscheduled instead and are rebuilt from this file when they are wanted.

## How far the exposure actually reached — measured, not assumed

`has_table_privilege('anon', 'cron.job', 'SELECT')` returns **true**, which
reads alarming and is the wrong instrument: it answers a question about TABLE
privileges and says nothing about schema USAGE. The behavioural pair, with a
positive control so a broken probe could not read as a clean result:

    as anon           -> 42501 permission denied for schema cron
    as authenticated  -> 42501 permission denied for schema cron
    control (privileged) -> 3 rows        <- the control

So the secret was never reachable from the client key. It was readable by
anything holding a privileged connection. Real, and worth removing; not a
customer-facing leak. `cron.job` also carries RLS with `username = CURRENT_USER`,
which is a second containment behind the schema denial.

## Still outstanding, and it is not this desk's to do

**Rotate the reddit-scout webhook secret.** It has sat in the clear and must be
treated as burned whether or not anyone read it. That is a credential action.
Unscheduling removed the copy in this database; it does not un-expose the value.

## Rebuilding them, on the vault pattern

Take the secret from the vault at call time, exactly as `unverified-nudge-daily`
(job 17) does — never as a literal:

```sql
select cron.schedule('reddit-scout-morning', '0 13 * * *', $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/reddit-scout',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-webhook-secret',  (select decrypted_secret from vault.decrypted_secrets
                            where name = 'REDDIT_SCOUT_WEBHOOK_SECRET' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
```

The other two differ only in name, schedule, and — for the retry job — the URL:

| job | schedule | url |
| --- | --- | --- |
| `reddit-scout-morning` | `0 13 * * *` | `/functions/v1/reddit-scout` |
| `reddit-scout-evening` | `0 1 * * *` | `/functions/v1/reddit-scout` |
| `reddit-scout-retry` | `*/5 1-6 * * *` | `/functions/v1/reddit-scout?mode=retry` |

The original command text is recorded nowhere with its secret intact, on
purpose. Rebuilding requires the rotated value from the vault, which is the
behaviour wanted.
