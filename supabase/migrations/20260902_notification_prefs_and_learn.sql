-- Notification preferences + the Learn track's read/achievement state.
-- ============================================================================
-- Two things that had nowhere to live:
--
-- 1. `profiles.notification_prefs` — the notification switch. It used to exist
--    ONLY in Capacitor Preferences on one device, which meant (a) the web app
--    could not show the control at all, so there was no off switch anywhere a
--    browser user could reach it, and (b) nothing on the server could honour it.
--    Any notification we ever send from a cron or an Edge Function would have
--    had no way to know the user had said no. A switch the sender cannot read
--    is not a switch. It lives on `profiles` rather than in a new table because
--    it is one small object per user, exactly like `tour_flags` and
--    `ui_preferences` beside it, and those already carry the RLS this needs.
--
-- 2. `learn_progress` — one row per lesson a user has finished. The lessons
--    THEMSELVES are static content in `src/lib/learn-lessons.ts`, not rows:
--    there is no author but us, no CMS, and a public content table would be one
--    more surface to get the grants wrong on. What is per-user is only "when
--    did you read it", and the achievement for a lesson is derived from the
--    presence of its row rather than stored again — a denormalised badge column
--    can disagree with the row that earned it, and then the UI has to pick a
--    winner.
--
-- The REVOKE before the GRANT is inherited from 20260826_friend_links.sql and
-- is load-bearing: the default ACLs on schema `public` grant ALL to both `anon`
-- and `authenticated`, so a new table is world-writable the instant it exists.

begin;

-- ── 1. The notification switch ─────────────────────────────────────────────
-- Shape (all keys optional; absent means "not chosen", which reads as on):
--   { "enabled": true,
--     "categories": { "bill_due": true, "floor_risk": true, "weekly_recap": true,
--                     "learn_lesson": true, "streak_risk": true,
--                     "milestone": true, "stale_accounts": true } }
--
-- Deliberately NOT `not null`: an existing row must keep meaning "never chosen"
-- rather than silently becoming a set of explicit choices the user never made.
-- The client treats null and `{}` identically (see notification-prefs.ts).
alter table public.profiles
  add column if not exists notification_prefs jsonb;

comment on column public.profiles.notification_prefs is
  'Notification master switch + per-category opt-outs. Null = never chosen (all on). Read by the client AND by anything that sends on the user''s behalf.';

-- ── 2. Learn progress ──────────────────────────────────────────────────────
create table if not exists public.learn_progress (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- The slug from `src/lib/learn-lessons.ts`. Text rather than a foreign key
  -- because the lesson catalogue is code, not data. A row whose lesson has been
  -- retired is harmless: the UI joins from the catalogue, so an unknown slug is
  -- simply not shown, and the read history is not falsified by a content edit.
  lesson_id  text not null check (length(lesson_id) between 1 and 64),

  read_at    timestamptz not null default now(),
  created_at timestamptz not null default now()
);

revoke all on public.learn_progress from anon, authenticated;

-- One achievement per lesson per person. The unique index is what makes
-- "mark as read" idempotent: pressing it twice cannot mint a second badge, and
-- the client upserts on this constraint rather than reading-then-writing.
create unique index if not exists learn_progress_user_lesson_uniq
  on public.learn_progress (user_id, lesson_id);

-- The streak query orders a user's reads by day, newest first.
create index if not exists learn_progress_user_read_at_idx
  on public.learn_progress (user_id, read_at desc);

alter table public.learn_progress enable row level security;

drop policy if exists learn_progress_select_own on public.learn_progress;
create policy learn_progress_select_own on public.learn_progress
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists learn_progress_insert_own on public.learn_progress;
create policy learn_progress_insert_own on public.learn_progress
  for insert to authenticated
  with check (user_id = auth.uid());

-- No UPDATE policy, on purpose. A read is a fact with a timestamp; the only
-- legitimate edits are "I read it" (insert) and "forget that I did" (delete,
-- which the account-deletion cascade also needs). Letting a client rewrite
-- `read_at` would let it fabricate a streak.
drop policy if exists learn_progress_delete_own on public.learn_progress;
create policy learn_progress_delete_own on public.learn_progress
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.learn_progress to authenticated;

commit;
