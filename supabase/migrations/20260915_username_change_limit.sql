-- TWO USERNAME CHANGES PER ROLLING SEVEN DAYS.
--
-- Tre, 2026-09-15: "allowing users to edit their username twice every seven days."
--
-- ⚠️ IT IS ENFORCED HERE BECAUSE THE CLIENT CANNOT ENFORCE IT. `20260913_profile_usernames.sql`
-- ends with `grant update (username) on public.profiles to authenticated`, so ANY signed-in user
-- can PATCH their own handle straight through PostgREST without the app ever running. A counter in
-- `UsernameClaim.tsx` would be a speed bump in front of an open door. This is the same argument
-- that put uniqueness in an index rather than in a pre-check, and it is the reason both live in
-- the database.
--
-- ⚠️ THE FIRST CLAIM IS NOT A CHANGE. Going from NULL to a handle is CLAIMING one; a new user must
-- not spend one of two weekly allowances on the first username they ever pick. Only an update
-- where the old value was non-null and genuinely different is counted. A no-op PATCH - the same
-- handle sent twice by a retry or a double press - costs nothing, which matters because the client
-- has no way to know whether its first request landed.
--
-- ⚠️ THIS FILE IS THE FIRST VERSION AND IT WAS WRONG TWICE. `20260915_username_change_limit_fixes.sql`
-- corrects both, and the sequence is kept rather than rewritten: clearing a handle threw 23502, and
-- clear-and-reclaim defeated the limit entirely because of the "first claim is free" rule below.
-- READ THAT FILE for the function as it actually runs. Both were found by the acceptance probe,
-- before either reached a user.
--
-- ⚠️ THE REFUSAL SAYS WHEN IT UNLOCKS, and that is the whole point of recording timestamps rather
-- than a counter. "You have changed it twice" leaves a person retrying blindly; naming the instant
-- turns a wall into a wait. The time is computed from the OLDEST of the changes still inside the
-- window, so it is the moment that change ages out.

-- The history. A row per accepted change - never a mutable counter, because a counter cannot
-- answer "when does this unlock" and cannot be audited after the fact.
create table if not exists public.username_changes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Both sides kept: a support question about a handle is almost always "who had it before".
  old_username text,
  new_username text not null,
  changed_at  timestamptz not null default now()
);

-- The only access pattern is "this user's changes inside the window", so the index matches it.
create index if not exists username_changes_user_time_idx
  on public.username_changes (user_id, changed_at desc);

alter table public.username_changes enable row level security;

-- ⚠️ READ-ONLY TO THE OWNER, AND WRITABLE BY NOBODY. The trigger below is SECURITY DEFINER, so it
-- inserts regardless of these policies; granting INSERT to `authenticated` would let a user forge
-- their own history and is precisely how the limit would be defeated. There is deliberately no
-- insert, update or delete policy - their absence IS the control.
drop policy if exists "own username changes are readable" on public.username_changes;
create policy "own username changes are readable"
  on public.username_changes for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.username_changes to authenticated;

/**
 * The gate itself.
 *
 * SECURITY DEFINER so it can write the history row that the caller is forbidden to write, and
 * `set search_path = public, pg_temp` so a caller cannot shadow `now()` or the table with
 * something of their own - a definer function without a pinned search_path is a privilege
 * escalation waiting to be found.
 */
create or replace function public.enforce_username_change_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  window_start constant timestamptz := now() - interval '7 days';
  changes_in_window int;
  oldest_in_window timestamptz;
begin
  -- Claiming a handle for the first time, or a no-op PATCH. Neither is a change.
  if old.username is null or old.username is not distinct from new.username then
    return new;
  end if;

  select count(*), min(changed_at)
    into changes_in_window, oldest_in_window
    from public.username_changes
   where user_id = new.user_id
     and changed_at > window_start;

  if changes_in_window >= 2 then
    -- The message is user-facing: `UsernameClaim.tsx` shows it verbatim rather than replacing it
    -- with a generic string, so the unlock time reaches the person who is waiting for it.
    raise exception using
      errcode = 'check_violation',
      message = 'USERNAME_CHANGE_LIMIT',
      detail  = to_char(oldest_in_window + interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      hint    = 'A username can change twice every seven days.';
  end if;

  insert into public.username_changes (user_id, old_username, new_username)
  values (new.user_id, old.username, new.username);

  return new;
end;
$$;

-- BEFORE, so a refused change never reaches the row, and `of username` so an unrelated profile
-- update - a display name, a tour flag, the weekly leaderboard publisher - never enters this
-- function at all.
drop trigger if exists profiles_username_change_limit on public.profiles;
create trigger profiles_username_change_limit
  before update of username on public.profiles
  for each row
  execute function public.enforce_username_change_limit();

-- ── UNDO ──────────────────────────────────────────────────────────────────────
-- Reversible in full. Dropping the trigger alone lifts the limit and keeps the history:
--   drop trigger if exists profiles_username_change_limit on public.profiles;
-- To remove it entirely (this DOES destroy the change history):
--   drop function if exists public.enforce_username_change_limit();
--   drop table if exists public.username_changes;
