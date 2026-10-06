-- NO-SAVE FOLLOW-UP (Tre, 2026-10-06, ask 6d0e50b0: "make future items like this auto follow up").
--
-- The one-off win-back email of 2026-10-06 (10 real accounts that saved nothing, all delivered)
-- becomes automatic: ONE email, once per user, to a real account that is 3 to 30 days old and has
-- still saved nothing. Same copy, no postal line (decision 0e582396), mailto unsubscribe.
-- The `no-save-nudge` edge function sends it; this file selects who and records who was sent.
--
-- "Saved nothing" = no row in budget_items, debts, accounts, savings_goals, transactions or
-- recurring_rules - the same definition the manual send used, re-measured before it went out.
-- RFC test domains are excluded, and so is anyone who never confirmed AND never signed in
-- (that group belongs to unverified-nudge, which asks them to confirm first).
--
-- The 30-day ceiling keeps this to recent signups: a dormant account from months ago is not who
-- "auto follow up" was about, and widening it later is one number.

alter table public.email_nudges drop constraint email_nudges_stage_check;
alter table public.email_nudges add constraint email_nudges_stage_check
  check (stage in ('gentle_24h', 'final_72h', 'no_save_72h'));

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
      select 1 from public.email_nudges n
      where n.user_id = u.id and n.stage = 'no_save_72h'
    );
$$;

revoke all on function public.get_users_to_nudge_no_save() from public, anon, authenticated;
grant execute on function public.get_users_to_nudge_no_save() to service_role;

-- The 10 who got the manual email on 2026-10-06 14:44Z must never get it twice. They are the
-- accounts that matched the same definition at send time (no window): record them as sent.
insert into public.email_nudges (user_id, stage, sent_at)
select u.id, 'no_save_72h', '2026-10-06 14:44:11+00'::timestamptz
from auth.users u
where u.email is not null
  and u.created_at < '2026-10-06 14:44:11+00'::timestamptz
  and split_part(lower(u.email), '@', 2) !~ '(\.test|\.example|\.invalid|\.localhost|^example\.(com|net|org))$'
  and not (u.email_confirmed_at is null and u.last_sign_in_at is null)
  and not exists (select 1 from public.budget_items x    where x.user_id = u.id)
  and not exists (select 1 from public.debts x           where x.user_id = u.id)
  and not exists (select 1 from public.accounts x        where x.user_id = u.id)
  and not exists (select 1 from public.savings_goals x   where x.user_id = u.id)
  and not exists (select 1 from public.transactions x    where x.user_id = u.id)
  and not exists (select 1 from public.recurring_rules x where x.user_id = u.id)
on conflict (user_id, stage) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'no-save-nudge-daily') then
    perform cron.unschedule('no-save-nudge-daily');
  end if;
end $$;

-- 15:30 UTC, half an hour after unverified-nudge, so the two never race on one user.
select cron.schedule(
  'no-save-nudge-daily',
  '30 15 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/no-save-nudge',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CRON_SECRET'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
