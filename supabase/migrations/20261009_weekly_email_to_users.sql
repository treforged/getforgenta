-- WEEKLY EMAIL TO APP USERS (proposal C, Tre "yes" via Sam 2026-10-09; the 09-10 recommendation in
-- docs/retention-recommendation-2026-09-10.md).
--
-- newsletter-digest used to mail only public.newsletter_subscribers. This file gives it the app's
-- confirmed users, and gives every user email a working unsubscribe:
--   1. profiles.email_unsubscribed_at - set by the email-unsubscribe function (one click, RFC 8058).
--      NULL = subscribed. It covers the weekly email AND the lifecycle nudges below.
--   2. get_weekly_digest_recipients() - service_role only. Returns unsubscribed users TOO, flagged,
--      so the function can keep them off the newsletter list as well; the send code skips them and
--      weekly-digest.test.ts asserts it.
--   3. get_users_to_nudge_no_save() - same body as 20261006_no_save_nudge.sql plus one line: an
--      unsubscribed user is not nudged.
--
-- Nothing here sends anything. newsletter-digest stays a DRY RUN until its cron URL carries
-- ?dry_run=0 (see the function header).
-- UNDO: restore get_users_to_nudge_no_save from 20261006_no_save_nudge.sql,
--       drop function public.get_weekly_digest_recipients();
--       alter table public.profiles drop column email_unsubscribed_at;

alter table public.profiles
  add column if not exists email_unsubscribed_at timestamptz;

comment on column public.profiles.email_unsubscribed_at is
  'When the user pressed unsubscribe on a Forgenta email. NULL = subscribed. Honoured by newsletter-digest and no-save-nudge.';

create or replace function public.get_weekly_digest_recipients()
returns table (
  user_id          uuid,
  email            text,
  display_name     text,
  timezone         text,
  unsubscribed     boolean,
  has_income       boolean,
  entries_7d       integer,
  sts_amount_cents bigint,
  sts_payday       date,
  sts_computed_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.email,
    p.display_name,
    p.timezone,
    (p.email_unsubscribed_at is not null),
    (coalesce(p.monthly_income_default, 0) > 0),
    (select count(*)::int from public.transactions t
       where t.user_id = u.id and t.created_at >= now() - interval '7 days'),
    s.amount_cents,
    s.payday,
    s.computed_at
  from auth.users u
  join public.profiles p on p.user_id = u.id
  left join public.safe_to_spend_snapshot s on s.user_id = u.id
  where u.email is not null
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until < now())
    and split_part(lower(u.email), '@', 2) !~ '(\.test|\.example|\.invalid|\.localhost|^example\.(com|net|org))$';
$$;

revoke all on function public.get_weekly_digest_recipients() from public, anon, authenticated;
grant execute on function public.get_weekly_digest_recipients() to service_role;

create or replace function public.get_users_to_nudge_no_save()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email
  from auth.users u
  where u.email is not null
    and split_part(lower(u.email), '@', 2) !~ '(\.test|\.example|\.invalid|\.localhost|^example\.(com|net|org))$'
    and not (u.email_confirmed_at is null and u.last_sign_in_at is null)
    and u.created_at <  now() - interval '72 hours'
    and u.created_at >= now() - interval '30 days'
    and not exists (select 1 from public.budget_items x    where x.user_id = u.id)
    and not exists (select 1 from public.debts x           where x.user_id = u.id)
    and not exists (select 1 from public.accounts x        where x.user_id = u.id)
    and not exists (select 1 from public.savings_goals x   where x.user_id = u.id)
    and not exists (select 1 from public.transactions x    where x.user_id = u.id)
    and not exists (select 1 from public.recurring_rules x where x.user_id = u.id)
    and not exists (
      select 1 from public.profiles p
      where p.user_id = u.id and p.email_unsubscribed_at is not null
    )
    and not exists (
      select 1 from public.email_nudges n
      where n.user_id = u.id and n.stage = 'no_save_72h'
    );
$$;

revoke all on function public.get_users_to_nudge_no_save() from public, anon, authenticated;
grant execute on function public.get_users_to_nudge_no_save() to service_role;
