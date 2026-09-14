-- The country leaderboard. Tre, 2026-09-14, via Sam: "do what you need to do... I just want it done."
--
-- The 2026-09-13 migration deliberately did NOT ship this, and said why: `profiles` had no country
-- column, and adding one meant collecting a new piece of personal data to fill a per-country cohort
-- while the GLOBAL cohort was 1. Tre has since unblocked it and delegated the privacy call, which
-- Sam made: DERIVE the country, do not ask for it, and never use IP geolocation. `p_scope` was
-- reserved for exactly this, so nothing here reshapes what already exists.
--
-- ⚠️ THE COUNTRY IS DERIVED CLIENT-SIDE, FROM SIGNALS THE BROWSER GIVES EVERY SITE ANYWAY -- the
-- locale and the IANA time zone. See `src/lib/derive-country.ts`. Nothing new is asked of anybody
-- and no address, no IP and no coordinate is involved. A derived column can also be dropped; a
-- question, once asked, cannot be un-asked.
--
-- ⚠️ THE PLAN WAS TO DERIVE FROM `profiles.timezone`, WHICH IS ALREADY COLLECTED, AND MEASURING IT
-- KILLED THAT PLAN. It is NULL for 45 of 49 profiles. A backfill would have covered FOUR PEOPLE
-- while looking like full coverage -- the shape where a migration reports success and the feature
-- is empty. So the column starts empty on purpose and fills as people open the app.
--
-- ⚠️ OPTING OUT REMOVES YOU FROM THE BOARD, IT DOES NOT HIDE YOU ON IT. Clearing `country_code`
-- takes the row out of every country cohort by construction -- the join simply does not match --
-- rather than filtering a row that is still being counted. A cohort size that silently includes
-- people who opted out is the failure this avoids, and it is invisible from the outside.
--
-- ⚠️ NO RLS WORK IS NEEDED, AND I CHECKED RATHER THAN ASSUMED. `profiles` carries exactly three
-- policies -- select/update/insert, all `auth.uid() = user_id`. There is no friend-visible or
-- public policy on that table, so a new column is readable by its owner and by SECURITY DEFINER
-- functions, and by nobody else. Had a friends policy existed, this column would have leaked each
-- user's country to their friends as a side effect of being added.
--
-- ⚠️ WHAT THIS WILL LOOK LIKE ON DAY ONE, said plainly rather than discovered later: the cohort
-- floor is 20 and no country has anywhere near 20 people sharing a metric, so every country board
-- will render the below-floor state for the foreseeable future. That is the honest state and the
-- card already has a shape for it. It is not a defect, and the floor must not be lowered to make
-- the screen look populated -- the floor is what stops one person's bucket being read back out of
-- a median.
--
-- UNDO, in this order:
--   1. restore `leaderboard_global_stats` to the 20260913_is_metric_shared_scope.sql body
--      (which refuses any scope that is not 'global');
--   2. alter table public.profiles drop constraint profiles_country_code_alpha2;
--      alter table public.profiles drop column country_code;
--   Nothing else is created. No existing row is written or altered by this migration.

-- -- 1. The column ------------------------------------------------------------
alter table public.profiles
  add column if not exists country_code text;

-- The CHECK is the guarantee the rest of this file relies on: exactly two upper-case ASCII letters,
-- or NULL. `null` is "not on a country board", which is the default and stays the default. Without
-- this, a client bug could write 'en-US' or '' and quietly create a cohort of one.
do $checkguard$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_country_code_alpha2'
  ) then
    alter table public.profiles
      add constraint profiles_country_code_alpha2
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end
$checkguard$;

comment on column public.profiles.country_code is
  'Coarse ISO-3166-1 alpha-2, DERIVED from browser locale/time zone (src/lib/derive-country.ts). '
  'Never from an IP address. NULL means the user is on no country leaderboard; clearing it is the '
  'opt-out, and it removes them from every country cohort rather than hiding them within one.';

-- -- 2. The scope -------------------------------------------------------------
create or replace function public.leaderboard_global_stats(
  p_metric text,
  -- 'global' or 'country'. Anything else is still REFUSED outright rather than silently treated as
  -- global -- a scope that quietly widens would publish a person against a cohort they did not ask
  -- to be measured against.
  p_scope text default 'global'
)
returns table (
  cohort_size integer,
  min_cohort integer,
  your_bucket integer,
  better_than_pct integer,
  median_bucket integer
)
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  v_min_cohort constant integer := 20;
  v_uid uuid := auth.uid();
  v_week date := (date_trunc('week', now()))::date;
  v_size integer;
  v_mine integer;
  v_country text;
  -- TRUE only for a country scope that can actually resolve a cohort. Held as one flag so the three
  -- population queries below cannot drift apart -- the cohort count, the percentile and the median
  -- must all be taken over EXACTLY the same population, and three copies of a condition is three
  -- chances for one of them to be edited alone.
  v_country_scope boolean;
begin
  if v_uid is null then
    return;
  end if;

  if p_scope is null or p_scope not in ('global', 'country') then
    raise exception 'unsupported leaderboard scope: %', p_scope using errcode = '22023';
  end if;

  if p_scope = 'country' then
    select p.country_code into v_country
      from public.profiles p
     where p.user_id = v_uid;

    -- ⚠️ A CALLER WITH NO COUNTRY GETS AN EMPTY COHORT, NOT THE GLOBAL ONE. Falling back to global
    -- here would be the worst kind of wrong: the card would say "country" over a number that is
    -- not about their country, and nothing would ever reveal the substitution.
    if v_country is null then
      select s.bucket_value into v_mine
        from public.leaderboard_snapshots s
       where s.user_id = v_uid and s.metric = p_metric and s.week = v_week;
      return query select 0, v_min_cohort, v_mine, null::integer, null::integer;
      return;
    end if;
  end if;

  v_country_scope := (p_scope = 'country');

  -- The opt-in test is asked of `leaderboard_shares` directly rather than through
  -- `is_metric_shared`, which is scoped to the caller and their friends -- see
  -- 20260913_is_metric_shared_scope.sql. A cohort is made of people you do not know.
  select count(*)
    into v_size
    from public.leaderboard_snapshots s
   where s.metric = p_metric
     and s.week = v_week
     and exists (
       select 1 from public.leaderboard_shares ls
        where ls.user_id = s.user_id and ls.metric = p_metric and ls.enabled
     )
     and (
       not v_country_scope
       or exists (
         select 1 from public.profiles p
          where p.user_id = s.user_id and p.country_code = v_country
       )
     );

  select s.bucket_value
    into v_mine
    from public.leaderboard_snapshots s
   where s.user_id = v_uid
     and s.metric = p_metric
     and s.week = v_week;

  if v_size < v_min_cohort then
    return query select v_size, v_min_cohort, v_mine, null::integer, null::integer;
    return;
  end if;

  return query
  select
    v_size,
    v_min_cohort,
    v_mine,
    case when v_mine is null then null::integer else (
      select (100.0 * count(*) filter (where s.bucket_value < v_mine) / nullif(count(*), 0))::integer
        from public.leaderboard_snapshots s
       where s.metric = p_metric and s.week = v_week
         and exists (
           select 1 from public.leaderboard_shares ls
            where ls.user_id = s.user_id and ls.metric = p_metric and ls.enabled
         )
         and (
           not v_country_scope
           or exists (
             select 1 from public.profiles p
              where p.user_id = s.user_id and p.country_code = v_country
           )
         )
    ) end,
    (
      select (percentile_disc(0.5) within group (order by s.bucket_value))::integer
        from public.leaderboard_snapshots s
       where s.metric = p_metric and s.week = v_week
         and exists (
           select 1 from public.leaderboard_shares ls
            where ls.user_id = s.user_id and ls.metric = p_metric and ls.enabled
         )
         and (
           not v_country_scope
           or exists (
             select 1 from public.profiles p
              where p.user_id = s.user_id and p.country_code = v_country
           )
         )
    );
end;
$fn$;

-- Same signature, so the same grants. Restated rather than assumed: Supabase's default privileges
-- grant every new function to `anon` directly, and `revoke ... from public` does NOT remove a
-- direct grant. `create or replace` preserves existing grants, but this file must still be correct
-- when replayed into an empty database.
revoke all on function public.leaderboard_global_stats(text, text) from public;
revoke execute on function public.leaderboard_global_stats(text, text) from anon;
grant execute on function public.leaderboard_global_stats(text, text) to authenticated;
