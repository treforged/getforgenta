-- ─────────────────────────────────────────────────────────────────────────────
-- FOLLOWS, AND AN ACCOUNT VISIBILITY SETTING.
--
-- Tre, 2026-09-16: "maybe we should make a follower System like how Instagram has and then
-- you can make a users account public or private. private would be friends only."
--
-- ⚠️ ADDITIVE. `friend_links` IS NOT TOUCHED, MIGRATED OR DEPRECATED HERE.
-- The two model DIFFERENT relationships and must not be conflated: `friend_links` is MUTUAL
-- and reached through a hashed 7-day email invite code; a follow is ASYMMETRIC and needs no
-- invite. Measured before writing this: 1 accepted friend link across 33 profiles, so the
-- blast radius of getting this wrong is small - but "small" is a reason to be careful with
-- the one real relationship, not a reason to migrate it on a guess.
--
-- ⚠️ THIS MIGRATION DELIBERATELY DOES NOT CHANGE WHO CAN SEE ANYONE'S FINANCIAL PROGRESS.
-- `leaderboard_snapshots_select_friend` still reads `active_friend_ids()` and is untouched.
-- Wiring follows into that policy widens who can read another person's money data, and that
-- belongs in its own migration with its own review - not bundled into the one that creates
-- the table. Until then this graph exists and grants nothing.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Account visibility ────────────────────────────────────────────────────
-- DEFAULT 'private', and that is the whole point. This app holds people's debt and income;
-- a visibility column that defaulted to public would opt 33 existing users into being
-- followable by strangers in a migration they never read.
alter table public.profiles
  add column if not exists visibility text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_visibility_check'
  ) then
    alter table public.profiles
      add constraint profiles_visibility_check check (visibility in ('private', 'public'));
  end if;
end $$;

comment on column public.profiles.visibility is
  'private (default): a follow is a REQUEST the owner approves. public: a follow is immediate. Enforced in request_follow(); the client never chooses the resulting status.';

-- ── 2. The follow graph ──────────────────────────────────────────────────────
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users(id) on delete cascade,
  followee_id  uuid not null references auth.users(id) on delete cascade,
  -- 'pending' only ever exists for a private followee. A public one is 'accepted' at once.
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint follows_status_check check (status in ('pending', 'accepted')),
  -- ⚠️ A SELF-FOLLOW IS NOT A HARMLESS ODDITY: it would put a user in their own follower
  -- list and, once the leaderboard reads this graph, in their own comparison set.
  constraint follows_no_self check (follower_id <> followee_id),
  constraint follows_unique unique (follower_id, followee_id)
);

create index if not exists follows_followee_status_idx on public.follows (followee_id, status);
create index if not exists follows_follower_status_idx on public.follows (follower_id, status);

alter table public.follows enable row level security;

-- Both sides of a row may read it: the follower needs to see "requested", and the followee
-- needs to see the request in order to answer it.
drop policy if exists follows_select_either_side on public.follows;
create policy follows_select_either_side on public.follows
  for select using (auth.uid() = follower_id or auth.uid() = followee_id);

-- ⚠️ NO INSERT POLICY, ON PURPOSE. A client that could INSERT directly could write
-- status='accepted' against a private account and follow somebody without being approved.
-- The only way in is request_follow() below, which reads the target's visibility itself.

-- Only the FOLLOWEE answers a request, and only pending -> accepted. A decline is a DELETE,
-- so there is no 'rejected' row left behind to record that somebody asked.
drop policy if exists follows_approve_own on public.follows;
create policy follows_approve_own on public.follows
  for update using (auth.uid() = followee_id and status = 'pending')
  with check (auth.uid() = followee_id and status = 'accepted');

-- Either side may end it: the follower unfollows, the followee removes a follower or
-- declines a request. Both are the same row disappearing.
drop policy if exists follows_delete_either_side on public.follows;
create policy follows_delete_either_side on public.follows
  for delete using (auth.uid() = follower_id or auth.uid() = followee_id);

-- ── 3. Asking to follow ──────────────────────────────────────────────────────
-- SECURITY DEFINER because it has to read the TARGET's visibility, and `profiles` is
-- readable only by its owner. It returns the resulting status so the UI can say
-- "Requested" or "Following" without a second round trip.
create or replace function public.request_follow(p_followee uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me         uuid := auth.uid();
  v_visibility text;
  v_status     text;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if v_me = p_followee then raise exception 'cannot follow yourself'; end if;

  select visibility into v_visibility from public.profiles where user_id = p_followee;
  -- A missing profile is NOT treated as public. An unknown account must be the safe one.
  if v_visibility is null then raise exception 'no such account'; end if;

  v_status := case when v_visibility = 'public' then 'accepted' else 'pending' end;

  insert into public.follows (follower_id, followee_id, status, responded_at)
  values (v_me, p_followee, v_status, case when v_status = 'accepted' then now() else null end)
  on conflict (follower_id, followee_id) do nothing;

  -- Read back rather than returning v_status: on a conflict the EXISTING row wins, and the
  -- caller must be told what is actually true, not what this call would have written.
  select status into v_status from public.follows
   where follower_id = v_me and followee_id = p_followee;
  return v_status;
end;
$fn$;

revoke all on function public.request_follow(uuid) from public;
grant execute on function public.request_follow(uuid) to authenticated;

-- ── 4. Finding somebody to follow ────────────────────────────────────────────
-- ⚠️ THIS EXISTS BECAUSE `profiles_select_own` MAKES EVERY PROFILE PRIVATE TO ITS OWNER, so
-- today nobody can look anyone up at all. The answer is NOT a blanket select policy on
-- `profiles` - that table carries onboarding state and personal fields. This returns four
-- columns and nothing else, on an EXACT username match only, so it cannot be walked to
-- enumerate the user base the way a prefix search could.
create or replace function public.find_profile_by_username(p_username text)
returns table (user_id uuid, username text, display_name text, visibility text)
language sql
security definer
set search_path = public
as $fn$
  select p.user_id, p.username, p.display_name, p.visibility
    from public.profiles p
   where auth.uid() is not null
     and p.username is not null
     and lower(p.username) = lower(trim(p_username))
   limit 1;
$fn$;

revoke all on function public.find_profile_by_username(text) from public;
grant execute on function public.find_profile_by_username(text) to authenticated;

-- ── UNDO ─────────────────────────────────────────────────────────────────────
-- drop function if exists public.find_profile_by_username(text);
-- drop function if exists public.request_follow(uuid);
-- drop table if exists public.follows;
-- alter table public.profiles drop constraint if exists profiles_visibility_check;
-- alter table public.profiles drop column if exists visibility;
