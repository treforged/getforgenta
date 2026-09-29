-- A record the desk can READ when the app failed to load on someone's device (ask 76d3f608).
-- ============================================================================
-- Tre opened the iOS app to a black screen on 2026-09-29. Nothing recorded it: the boot guard in
-- index.html can only write localStorage (the code that talks to Supabase is the code that failed
-- to load), and reportError is deliberately OFF inside the native app (monitoring.ts isEnabled).
-- So the next GOOD boot inserts the recorded failure here (src/lib/boot-failure.ts).
--
-- SECURITY:
--  * A signed-in user may INSERT only a row carrying their own user_id. Nobody but the service role
--    can SELECT, UPDATE or DELETE: there is nothing here a user needs to read back.
--  * No PII by construction: reason is a short machine string, path is a URL path. Lengths capped.
--  * Anonymous cannot write. The volume is bounded by the client: one row per recorded failure.
-- UNDO: drop table public.client_boot_failures;

begin;

create table if not exists public.client_boot_failures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (char_length(reason) <= 200),
  failed_at   timestamptz not null,
  path        text not null default '' check (char_length(path) <= 200),
  platform    text not null default '' check (char_length(platform) <= 20),
  created_at  timestamptz not null default now()
);

alter table public.client_boot_failures enable row level security;

revoke all on public.client_boot_failures from anon, authenticated;
grant insert on public.client_boot_failures to authenticated;

drop policy if exists client_boot_failures_insert_own on public.client_boot_failures;
create policy client_boot_failures_insert_own on public.client_boot_failures
  for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;
