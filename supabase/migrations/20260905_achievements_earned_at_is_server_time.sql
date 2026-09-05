-- A streak has to be earned, so the clock that records it cannot belong to the claimant.
-- ============================================================================
--
-- ⚠️ THE EXPLOIT THIS CLOSES, FOUND WHILE SCOPING THE 30-DAY STREAK REWARD (item 9).
--
-- `achievements` lets a signed-in user INSERT their own rows -- deliberately, and correctly: a
-- lesson read and a social follow are things the client is the only witness to. The INSERT policy
-- constrains WHICH achievement_id may be written (`lesson:%`, `follow_instagram`, `follow_tiktok`)
-- and WHOSE row it is. It constrains NOTHING about `earned_at`, which merely DEFAULTS to now().
-- A default is not a guard: any client may supply its own value.
--
-- The login streak is computed by bucketing `earned_at` into local calendar days. So a user could
-- insert thirty rows carrying thirty consecutive backdated `earned_at` values and hold a thirty-day
-- streak one second after signing up. Today that buys nothing, because the streak grants nothing.
-- The moment it grants 30 days of Premium it is a free-subscription exploit, and it would be a
-- FEATURE SHIPPING ON TOP OF A HOLE rather than a bug found later.
--
-- `docs/og-cohort.md` already states the rule this enforces: a client may only claim what it cannot
-- profit by faking. The claim is fine. The TIMESTAMP is what it must not choose.
--
-- ── WHAT THE TRIGGER DOES, AND WHY IT IS NOT JUST A CHECK CONSTRAINT ─────────
-- A CHECK cannot say "unless the writer is the server". `earned_at` has a legitimate non-now()
-- writer: the service role, backfilling or correcting a record. So the rule is:
--   * a client (`authenticated`/`anon`) NEVER sets `earned_at` -- it is overwritten with now();
--   * the service role MAY set it, but never to the future, because a future timestamp would let
--     one row satisfy a day that has not happened.
-- `created_at` is pinned the same way for the same reason: it is the only independent record of
-- when the row actually arrived.
--
-- ── AND THE UNIQUE INDEX THE APP ALREADY BELIEVES IN ────────────────────────
-- `useLearnProgress.ts` reads: "23505 is the unique violation: the lesson was already read. That is
-- a success from the reader's point of view". There is NO unique index on (user_id,
-- achievement_id), so that branch has never once run and re-reading a lesson has been quietly
-- writing duplicate rows the whole time. The code documents a constraint the database does not
-- have. Adding it makes the handler true, and it caps a second uncounted axis: without it a client
-- can insert the same lesson a thousand times, which is thirty days of distinct timestamps by
-- another route once the clock is pinned.
--
-- Measured before applying: 6 rows, 6 distinct (user_id, achievement_id) pairs, 0 backdated, 0
-- future-dated. Nothing has been exploited and no existing row conflicts.
--
-- REVERSING THIS: drop the trigger, the function and the index. No data is altered by any of it.

begin;

-- ⚠️ DELIBERATELY NOT `security definer`. The first version of this was, and that made
-- `current_user` the FUNCTION OWNER rather than the caller, so the role test could never be true
-- and every writer took the client path. Safe in effect and wrong as written — a trigger whose
-- rule is "who is writing this" cannot be SECURITY DEFINER. A BEFORE trigger that only rewrites
-- NEW needs no elevated rights at all.
create or replace function public.achievements_pin_server_time()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- The client roles are named EXPLICITLY rather than excluded, so an unrecognised role gets the
  -- strict path rather than the permissive one.
  if current_user in ('authenticated', 'anon') then
    new.earned_at := now();
  elsif new.earned_at is null or new.earned_at > now() then
    -- The server may record an EARLIER time (a correction, a backfill). Never a later one: a
    -- future timestamp would satisfy a calendar day that has not happened yet.
    new.earned_at := now();
  end if;

  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists achievements_pin_server_time on public.achievements;
create trigger achievements_pin_server_time
  before insert or update on public.achievements
  for each row execute function public.achievements_pin_server_time();

-- One row per achievement per user. The app has always handled the violation; now it can happen.
create unique index if not exists achievements_user_achievement_key
  on public.achievements (user_id, achievement_id);

comment on function public.achievements_pin_server_time() is
  'Forces achievements.earned_at to server time for authenticated/anon writers, and clamps any '
  'future timestamp for everyone. A client may claim an achievement but must not choose when it '
  'was earned: the login streak buckets earned_at into calendar days, and a backdated row would '
  'manufacture a streak that pays out real Premium. Deliberately NOT security definer -- that made '
  'current_user the function owner and the role test meaningless.';

-- ── PROVED AGAINST THE LIVE DATABASE, AS THE CLIENT ROLE ────────────────────
-- `set local role authenticated` + an insert carrying `earned_at = now() - interval '40 days'`:
-- the stored row came back at now(). A privileged insert carrying `now() + interval '10 days'`
-- came back clamped to now(). A second row for the same (user_id, achievement_id) raised
-- unique_violation. All three probes were deleted; the table is back to its original 6 rows.
-- Running the probe as `postgres` alone would have proved nothing — that is the role the first,
-- broken version also satisfied.

commit;
