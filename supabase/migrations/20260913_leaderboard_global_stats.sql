-- Global leaderboard standing, as an AGGREGATE and never as a list of people.
--
-- Tre, 2026-09-13: "I did talk to Sam about a global slash, uh, country based leaderboard and all
-- that... I did want that processed again whenever you get the chance." And, in the same breath,
-- the constraint: "Make sure it's secure, and nobody else can just really gonna be accessed
-- anybody's else as, like, information or universal status."
--
-- ⚠️ THE FRIEND BOARD'S MODEL CANNOT BE REUSED HERE, AND THAT IS THE WHOLE DESIGN PROBLEM.
-- `leaderboard_snapshots_select_friend` lets you read a ROW belonging to a named person you are
-- actually friends with. A global board has no friendship to gate on, so the same shape would mean
-- every user reading every other user's row — which is precisely the thing he asked to be sure
-- could not happen. So nothing here grants a single extra row. This function reads the table as its
-- owner and returns ONLY counts and percentages computed across the cohort. There is no code path
-- in it that can emit a user id, a display name, a username or an individual bucket other than the
-- caller's own — which they already have.
--
-- ⚠️ A COHORT OF ONE IS NOT AN AGGREGATE, IT IS THAT PERSON'S DATA WITH A PERCENTAGE SIGN ON IT.
-- Measured 2026-09-13: 49 profiles exist and exactly ONE has enabled any metric. With n = 1 the
-- median IS the single participant's bucket, and "you are better than 0%" identifies them exactly.
-- Any n below a handful leaks by arithmetic no matter how careful the SQL is. So the statistics are
-- withheld entirely below `min_cohort`, and the function says how many are participating so the app
-- can be honest about why it is empty rather than silently drawing nothing.
--
-- ⚠️ COUNTRY SCOPE IS DELIBERATELY NOT SHIPPED HERE. `profiles` has no country column, and adding
-- one means collecting a new piece of personal data from every user. Doing that to populate a board
-- that needs a per-country cohort — when the GLOBAL cohort is currently 1 — would be collecting
-- data before it can possibly be used. The scope parameter exists so country slots in without
-- reshaping any of this; see `p_scope`.
--
-- UNDO: drop function public.leaderboard_global_stats(text, text);
--       (Two arguments. `drop function ...(text)` matches nothing and fails — an undo written from
--       memory rather than from the signature, which is the kind that is discovered in an incident.)
--       Nothing else is created and no row is written or altered by this migration.

create or replace function public.leaderboard_global_stats(
  p_metric text,
  -- Reserved so a country scope is an argument rather than a second function that drifts from this
  -- one. 'global' is the only accepted value today and anything else is refused outright rather
  -- than silently treated as global — a scope that quietly widens is the failure to avoid here.
  p_scope text default 'global'
)
returns table (
  cohort_size integer,
  min_cohort integer,
  your_bucket integer,
  -- The share of the cohort strictly below the caller's bucket, 0-100. A PERCENTAGE, never a rank
  -- and never a position, because "4th of 6" plus a small cohort is most of the way to a name.
  better_than_pct integer,
  -- ⚠️ `percentile_disc`, NOT `percentile_cont`, AND THE DIFFERENCE IS VISIBLE TO THE USER.
  -- `cont` INTERPOLATES: over an even spread of 0,5,...,95 it returns 48, which is not a bucket at
  -- all, on a feature whose every other number is promised "to the nearest 5%". `disc` returns an
  -- actual member of the set (45), so the median is always a real band. Measured both ways before
  -- choosing rather than picked from the docs.
  median_bucket integer
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  -- ⚠️ CHOSEN, NOT MEASURED, AND STATED AS SUCH. There is no participation data to tune against
  -- yet — the cohort is 1. 20 is the smallest round number at which a single person's bucket cannot
  -- be read back out of a median or a percentile, and it is deliberately easier to LOWER later on
  -- evidence than to raise after people have seen numbers.
  v_min_cohort constant integer := 20;
  v_uid uuid := auth.uid();
  v_week date := (date_trunc('week', now()))::date;
  v_size integer;
  v_mine integer;
begin
  -- Anonymous callers get nothing. The function is granted to `authenticated` only, but a guard
  -- here as well means a future grant cannot quietly open it.
  if v_uid is null then
    return;
  end if;

  if p_scope is distinct from 'global' then
    raise exception 'unsupported leaderboard scope: %', p_scope using errcode = '22023';
  end if;

  -- The cohort: everyone who opted THIS metric in and has a bucket for the CURRENT week. Both
  -- conditions matter. Opting in without a snapshot is not participation, and counting old weeks
  -- would let somebody who has since opted out keep contributing.
  select count(*)
    into v_size
    from public.leaderboard_snapshots s
   where s.metric = p_metric
     and s.week = v_week
     and public.is_metric_shared(s.user_id, p_metric);

  select s.bucket_value
    into v_mine
    from public.leaderboard_snapshots s
   where s.user_id = v_uid
     and s.metric = p_metric
     and s.week = v_week;

  -- Below the floor: the size and the floor, and nothing else. The caller's own bucket is returned
  -- because it is already theirs, and it lets the app show "here is you" beside "not enough people
  -- yet" instead of an empty card.
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
         and public.is_metric_shared(s.user_id, p_metric)
    ) end,
    (
      select (percentile_disc(0.5) within group (order by s.bucket_value))::integer
        from public.leaderboard_snapshots s
       where s.metric = p_metric and s.week = v_week
         and public.is_metric_shared(s.user_id, p_metric)
    );
end;
$$;

-- `authenticated` only. An unauthenticated caller has no standing to measure and no bucket of their
-- own, and a public aggregate endpoint is a scraping surface for nothing.
--
-- ⚠️ `REVOKE ... FROM PUBLIC` IS NOT ENOUGH HERE, AND I ONLY FOUND THAT BY READING THE GRANT BACK.
-- Supabase ships `alter default privileges in schema public grant all on functions to anon,
-- authenticated, service_role`, so every new function is born with a DIRECT grant to `anon`.
-- Revoking from PUBLIC does not remove a direct grant, so after the first two lines below
-- `has_function_privilege('anon', ...)` still read TRUE. The explicit revoke is the line that
-- matters; the first one alone would have shipped an anonymously-callable function that only the
-- `auth.uid() is null` guard inside the body was stopping. Defence in depth is why that guard
-- exists, but it must not be the only thing standing there.
revoke all on function public.leaderboard_global_stats(text, text) from public;
revoke execute on function public.leaderboard_global_stats(text, text) from anon;
grant execute on function public.leaderboard_global_stats(text, text) to authenticated;
