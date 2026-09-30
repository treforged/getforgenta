-- Anonymous COUNTS of the steps before an account exists (ask 6dbd80d8, residue of 9ed575ea).
-- ============================================================================
-- 8 people installed the app and never signed up, and funnel_step starts AT signup, so nothing
-- can say where they stopped. This table counts each first-launch step, with nothing that can
-- identify a person or a device.
--
-- SECURITY:
--  * anon and authenticated may INSERT only. Nobody but the service role can SELECT, UPDATE or
--    DELETE: the desk reads it with SQL.
--  * No PII by construction: no user id, no email, no device id, no IP column. step and platform
--    are closed lists; detail is an error CODE only (<= 40 chars of [a-z0-9_]).
--  * Anonymous writes are RATE-LIMITED in the database: past 120 rows in the last 60 seconds,
--    the trigger drops the row silently (returns NULL). A flood can therefore cost at most
--    120 rows a minute, and it can only inflate counts; it can never read anything.
-- UNDO: drop table public.signup_funnel_events; drop function public.signup_funnel_rate_limit();

begin;

create table if not exists public.signup_funnel_events (
  id          bigint generated always as identity primary key,
  step        text not null check (step in (
                'app_opened', 'welcome_shown', 'signup_form_shown',
                'tap_email', 'tap_google', 'tap_apple',
                'auth_error', 'confirm_email_shown', 'signup_completed')),
  method      text not null default '' check (method in ('', 'email', 'google', 'apple')),
  detail      text not null default '' check (detail ~ '^[a-z0-9_]{0,40}$'),
  platform    text not null default '' check (platform in ('', 'ios', 'android', 'web')),
  created_at  timestamptz not null default now()
);

create index if not exists signup_funnel_events_created_at_idx
  on public.signup_funnel_events (created_at);

create or replace function public.signup_funnel_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The client never chooses the time.
  new.created_at := now();
  if (select count(*) from public.signup_funnel_events
      where created_at > now() - interval '60 seconds') >= 120 then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.signup_funnel_rate_limit() from public, anon, authenticated;

drop trigger if exists signup_funnel_rate_limit on public.signup_funnel_events;
create trigger signup_funnel_rate_limit
  before insert on public.signup_funnel_events
  for each row execute function public.signup_funnel_rate_limit();

alter table public.signup_funnel_events enable row level security;

revoke all on public.signup_funnel_events from anon, authenticated;
grant insert (step, method, detail, platform) on public.signup_funnel_events to anon, authenticated;

drop policy if exists signup_funnel_events_insert on public.signup_funnel_events;
create policy signup_funnel_events_insert on public.signup_funnel_events
  for insert to anon, authenticated
  with check (true);

commit;
