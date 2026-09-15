-- TWO CORRECTIONS TO `20260915_username_change_limit.sql`, BOTH FOUND BY ITS OWN ACCEPTANCE PROBE
-- BEFORE EITHER REACHED A USER. Kept as a separate file so the sequence is honest: the first
-- version shipped with a crash and a bypass, and a reader deserves to see that rather than a
-- migration that looks like it was right first time.

-- (1) CLEARING A HANDLE THREW 23502. `new_username` was `not null`, so setting profiles.username
-- back to NULL raised from inside the trigger and a person removing their handle got a database
-- error instead of an empty field. The format constraint has always permitted NULL; the history
-- table was the only thing forbidding it. Clearing still COUNTS - it releases the handle for
-- anyone else, so clear/reclaim churn is exactly what the limit is meant to bound.
alter table public.username_changes alter column new_username drop not null;

comment on column public.username_changes.new_username is
  'NULL means the handle was CLEARED. Nullable deliberately - see the 2026-09-15 fixes migration.';

-- (2) CLEAR-AND-RECLAIM DEFEATED THE LIMIT ENTIRELY, and the "a first claim is free" rule is what
-- opened it. The function returned early whenever `old.username is null`, so
--     handle -> null (counted) -> handle (FREE) -> null (counted) -> handle (FREE) ...
-- allowed unbounded changes. The probe caught it at the step that matters: a change ALLOWED after
-- two were already recorded inside the window.
--
-- THE DISTINCTION IS NOT "is the old value null" BUT "has this person ever had a handle". A
-- genuinely new user has no history and must not spend an allowance on their first username;
-- anyone with history is changing, whatever they are changing from.
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
  ever_changed boolean;
begin
  -- A no-op PATCH costs nothing: the client cannot always tell whether its first request landed,
  -- so a retry must not be punished.
  if old.username is not distinct from new.username then
    return new;
  end if;

  select exists (select 1 from public.username_changes where user_id = new.user_id)
    into ever_changed;

  -- The one free act: picking a handle for the very first time, by someone who never had one.
  if old.username is null and not ever_changed then
    return new;
  end if;

  select count(*), min(changed_at)
    into changes_in_window, oldest_in_window
    from public.username_changes
   where user_id = new.user_id
     and changed_at > window_start;

  if changes_in_window >= 2 then
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

-- (3) THE UNLOCK TIME CROSSED THE BOUNDARY IN A FORMAT THE BROWSER REJECTS. `to_char(..., 'OF')`
-- renders `+00`; ECMA-262 accepts `Z` or a full `+HH:MM` and nothing else, so `new Date(detail)`
-- returned Invalid Date and the refusal degraded to "try again in a few days" - losing exactly the
-- half Tre asked for. Postgres was happy with the string and the browser silently was not, which
-- is why only a test that spans both could find it.
--
-- Emitted in UTC with a literal Z; the browser renders it in the reader's own zone, which is where
-- that conversion belongs - the database does not know where the person is.
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
  ever_changed boolean;
begin
  if old.username is not distinct from new.username then
    return new;
  end if;

  select exists (select 1 from public.username_changes where user_id = new.user_id)
    into ever_changed;

  if old.username is null and not ever_changed then
    return new;
  end if;

  select count(*), min(changed_at)
    into changes_in_window, oldest_in_window
    from public.username_changes
   where user_id = new.user_id
     and changed_at > window_start;

  if changes_in_window >= 2 then
    raise exception using
      errcode = 'check_violation',
      message = 'USERNAME_CHANGE_LIMIT',
      detail  = to_char((oldest_in_window + interval '7 days') at time zone 'utc',
                        'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      hint    = 'A username can change twice every seven days.';
  end if;

  insert into public.username_changes (user_id, old_username, new_username)
  values (new.user_id, old.username, new.username);

  return new;
end;
$$;

-- ── UNDO ──────────────────────────────────────────────────────────────────────
--   drop trigger if exists profiles_username_change_limit on public.profiles;   -- lifts the limit
