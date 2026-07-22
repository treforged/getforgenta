-- Unverified-account email nudges.
-- Tracks which stage of reminder each user has been sent so we never double-send,
-- and exposes a service-role-only selector that the `unverified-nudge` edge function
-- calls to find who needs an email today.

-- ── State table ────────────────────────────────────────────────────────────────
create table if not exists public.email_nudges (
  user_id uuid not null references auth.users(id) on delete cascade,
  stage   text not null check (stage in ('gentle_24h', 'final_72h')),
  sent_at timestamptz not null default now(),
  primary key (user_id, stage)
);

-- RLS on with no policies → only the service role (which bypasses RLS) can read/write.
alter table public.email_nudges enable row level security;

-- ── Selector ───────────────────────────────────────────────────────────────────
-- Returns at most one row per user. The two windows are mutually exclusive by
-- created_at, so a user gets a gentle nudge in the 24–72h window and a final nudge
-- once past 72h. Users already older than 72h (who missed the gentle window) go
-- straight to the final nudge.
create or replace function public.get_users_to_nudge()
returns table (user_id uuid, email text, stage text)
language sql
security definer
set search_path = public
as $$
  -- Final: older than 72h, final not yet sent.
  select u.id, u.email, 'final_72h'::text
  from auth.users u
  where u.email_confirmed_at is null
    and u.email is not null
    and u.created_at < now() - interval '72 hours'
    and not exists (
      select 1 from public.email_nudges n
      where n.user_id = u.id and n.stage = 'final_72h'
    )
  union all
  -- Gentle: in the 24–72h window, gentle not yet sent.
  select u.id, u.email, 'gentle_24h'::text
  from auth.users u
  where u.email_confirmed_at is null
    and u.email is not null
    and u.created_at <  now() - interval '24 hours'
    and u.created_at >= now() - interval '72 hours'
    and not exists (
      select 1 from public.email_nudges n
      where n.user_id = u.id and n.stage = 'gentle_24h'
    );
$$;

-- Lock the selector down to the service role only.
revoke all on function public.get_users_to_nudge() from public, anon, authenticated;
grant execute on function public.get_users_to_nudge() to service_role;

-- ── Schedule: daily at 15:00 UTC (11am EDT / 10am EST) ──────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'unverified-nudge-daily') then
    perform cron.unschedule('unverified-nudge-daily');
  end if;
end $$;

select cron.schedule(
  'unverified-nudge-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/unverified-nudge',
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
