-- A record of each BACKGROUND widget refresh (ask e74da89c), so the desk can read from SQL whether
-- iOS / Android actually ran the closed-app refresh and how often - instead of asking Tre to look
-- at his home screen. Only background publishes are logged; an ordinary open writes nothing.
-- ============================================================================
-- SECURITY:
--  * authenticated may INSERT their own rows (two closed-list columns only) and SELECT their own
--    rows. Nobody can UPDATE or DELETE. The app has no read path; the desk reads it with SQL.
--  * The trigger sets user_id from auth.uid() and created_at from now(); the client chooses
--    neither, so a row cannot be attributed to someone else or back-dated.
--  * RATE-LIMITED per user: past 24 rows in the last 24 hours the row is dropped silently. The
--    feature runs about 4 times a day, so the cap only bounds a misbehaving client.
--  * No figures, no device id, no IP: platform and how the page knew it was in the background.
-- UNDO: drop table public.widget_refresh_events; drop function public.widget_refresh_events_stamp();

begin;

create table if not exists public.widget_refresh_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default '' check (platform in ('', 'ios', 'android', 'web')),
  -- 'host' = inside the Android hidden WebView; 'hidden' = page hidden (iOS background reload).
  via         text not null check (via in ('host', 'hidden')),
  created_at  timestamptz not null default now()
);

create index if not exists widget_refresh_events_user_created_idx
  on public.widget_refresh_events (user_id, created_at);

create or replace function public.widget_refresh_events_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if new.user_id is null then
    return null;
  end if;
  if (select count(*) from public.widget_refresh_events
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 24 then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.widget_refresh_events_stamp() from public, anon, authenticated;

drop trigger if exists widget_refresh_events_stamp on public.widget_refresh_events;
create trigger widget_refresh_events_stamp
  before insert on public.widget_refresh_events
  for each row execute function public.widget_refresh_events_stamp();

alter table public.widget_refresh_events enable row level security;

revoke all on public.widget_refresh_events from anon, authenticated;
grant insert (platform, via) on public.widget_refresh_events to authenticated;
grant select on public.widget_refresh_events to authenticated;

-- WITH CHECK runs after the BEFORE trigger has set user_id, so this pins every row to its writer.
drop policy if exists widget_refresh_events_insert on public.widget_refresh_events;
create policy widget_refresh_events_insert on public.widget_refresh_events
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists widget_refresh_events_select on public.widget_refresh_events;
create policy widget_refresh_events_select on public.widget_refresh_events
  for select to authenticated
  using (user_id = auth.uid());

commit;
