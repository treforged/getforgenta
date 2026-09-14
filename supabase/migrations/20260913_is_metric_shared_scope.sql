-- `is_metric_shared` answered about ANYBODY. Now it answers about you and your friends.
--
-- ⚠️ FOUND WHILE AUDITING MY OWN WORK, AND NAMED IN THAT COMMIT AS NOT FIXED THERE. The global
-- leaderboard commit's security pass recorded this: `public.is_metric_shared(uuid, text)` is
-- SECURITY DEFINER and EXECUTE-able by `authenticated`, so any signed-in user could ask
-- "does user X share metric Y?" about any user id in the system. It is a preference boolean rather
-- than anyone's money, and you need the target's uuid to ask — which is why it was recorded as low
-- severity rather than held as a blocker. It is still an oracle about a stranger's settings, and
-- leaving it open because it is small is how a small thing becomes the one nobody re-reads.
--
-- ⚠️ REVOKING EXECUTE WAS THE WRONG FIX AND I CHECKED BEFORE REACHING FOR IT. This function is
-- called from `leaderboard_snapshots_select_friend`, and an RLS policy expression is evaluated with
-- the privileges of the QUERYING user — so revoking from `authenticated` would not tighten the
-- oracle, it would break the friends leaderboard for everybody. The fix has to be in the body.
--
-- TWO CALLERS, ENUMERATED RATHER THAN ASSUMED (pg_policies for policies, pg_proc.prosrc for
-- functions):
--   1. `leaderboard_snapshots_select_friend` — already ANDs with `user_id IN active_friend_ids()`,
--      so it only ever asks about friends and is UNAFFECTED by the new guard.
--   2. `leaderboard_global_stats` — legitimately needs to count STRANGERS, because a global cohort
--      is made of people you do not know. It is SECURITY DEFINER and owns the read, so it stops
--      calling this function and asks `leaderboard_shares` directly. That is not a widening: the
--      function still returns only counts and percentages, and still refuses below the cohort floor.
--
-- UNDO, in this order:
--   1. restore the previous `is_metric_shared` body (the guard removed);
--   2. restore `leaderboard_global_stats` to call `public.is_metric_shared(s.user_id, p_metric)`.
--   Neither table is touched and no row is written by this migration.

-- ── 1. The aggregate stops depending on the per-user predicate ───────────────
create or replace function public.leaderboard_global_stats(
  p_metric text,
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
as $$
declare
  v_min_cohort constant integer := 20;
  v_uid uuid := auth.uid();
  v_week date := (date_trunc('week', now()))::date;
  v_size integer;
  v_mine integer;
begin
  if v_uid is null then
    return;
  end if;

  if p_scope is distinct from 'global' then
    raise exception 'unsupported leaderboard scope: %', p_scope using errcode = '22023';
  end if;

  -- ⚠️ THE OPT-IN TEST IS INLINED RATHER THAN DELEGATED. `is_metric_shared` is now scoped to the
  -- caller and their friends, which is right for a policy and wrong here: a GLOBAL cohort is made
  -- of people you do not know. This function owns the read as its definer, counts only, and never
  -- emits a user id — so asking the table directly is the honest way to say "everyone who opted in"
  -- without re-opening a per-user oracle for the client.
  select count(*)
    into v_size
    from public.leaderboard_snapshots s
   where s.metric = p_metric
     and s.week = v_week
     and exists (
       select 1 from public.leaderboard_shares ls
        where ls.user_id = s.user_id and ls.metric = p_metric and ls.enabled
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
    ) end,
    (
      select (percentile_disc(0.5) within group (order by s.bucket_value))::integer
        from public.leaderboard_snapshots s
       where s.metric = p_metric and s.week = v_week
         and exists (
           select 1 from public.leaderboard_shares ls
            where ls.user_id = s.user_id and ls.metric = p_metric and ls.enabled
         )
    );
end;
$$;

revoke all on function public.leaderboard_global_stats(text, text) from public;
revoke execute on function public.leaderboard_global_stats(text, text) from anon;
grant execute on function public.leaderboard_global_stats(text, text) to authenticated;

-- ── 2. The predicate is scoped to the caller and their friends ───────────────
create or replace function public.is_metric_shared(p_user_id uuid, p_metric text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.leaderboard_shares ls
    where ls.user_id = p_user_id
      and ls.metric = p_metric
      and ls.enabled
  )
  -- ⚠️ THE SCOPE GUARD. Answering about a stranger is the oracle; answering about yourself tells you
  -- nothing you do not have, and answering about a friend is exactly what the leaderboard policy
  -- needs. `false` for everyone else — indistinguishable from "they have it switched off", which is
  -- the right shape: a refusal that announces itself is still an answer.
  and (
    p_user_id = auth.uid()
    or p_user_id in (select public.active_friend_ids())
  )
$function$;
