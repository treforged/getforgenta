-- Badges you earn by USING the product, granted server-side.
-- ============================================================================
-- WHY THIS EXISTS. Tre, 2026-09-17: "There should be an achievement for
-- multiple things ... I want to make an achievement for milestones of
-- followers/following." Measured the same night, and it is a CONTENT gap
-- rather than a plumbing one: the `achievements` table, the resolver, the hooks
-- and the trophy case all work -- 5 live rows across 4 accounts, three distinct
-- ids, including one lesson badge and one social badge that were both written
-- by the client end to end. **The plumbing is proven. There was simply almost
-- nothing to earn**: a lesson badge, a social-link TAP, and `og_founder`.
-- Nothing in that list is earned by using Forgenta to manage money.
--
-- -- WHY SERVER-SIDE, WHEN THE SOCIAL BADGES ARE CLIENT-MINTED ---------------
-- THE TWO CASES LOOK ALIKE AND ARE OPPOSITES, so the distinction is written
-- here rather than left to be re-derived.
--
-- `follow_instagram` and `follow_tiktok` are claim-based BY NECESSITY: neither
-- platform lets a consumer app check whether a follow happened, so the client
-- asserts them and `src/hooks/useSocialAchievements.ts` says so at length. They
-- are allowed to be self-asserted precisely because they unlock nothing.
--
-- A MILESTONE IS NOT LIKE THAT. "You reached 10 followers" is a claim this
-- database can check, so letting a client assert it would be inventing a claim
-- the server could have verified -- the same family as the `og_founder`
-- description that told three real people they had paid when they had not. So
-- every rule below is evaluated HERE, against the caller's own rows, and the
-- client INSERT policy is deliberately NOT widened. After this migration a
-- client still cannot mint a milestone; only this function can.
--
-- -- WHAT THE CLIENT OWNS, AND WHY THE THRESHOLDS COME BACK OUT --------------
-- SQL owns "has this been earned". TypeScript owns "what is it called". That
-- split is on purpose: this desk has twice refused to duplicate a RULE into a
-- second language, and a catalogue of names is not a rule. The thresholds are
-- RETURNED rather than restated in TS, so the progress a person sees is the
-- number this function actually compared against and the two cannot drift.
--
-- -- WHAT A BADGE HERE IS ALLOWED TO CLAIM ----------------------------------
-- Only what the row it counts actually proves. `debt_free` requires that the
-- account has HELD at least one debt and that none of them now carries a
-- balance -- without the first half, somebody who has never entered a debt
-- would be told they cleared one. `bank_linked` says a connection exists, not
-- that it still syncs. Nothing here infers a habit from a count.
--
-- UNDO, in one command:
--     drop function if exists public.claim_milestone_achievements();
-- Badges already granted survive that drop, which is intended -- revoking a
-- visible badge from a real person is a promise broken (Tre, 2026-09-06, on
-- `og_founder`). To undo those too:
--     delete from public.achievements where achievement_id like 'milestone:%';
-- ============================================================================

begin;

create or replace function public.claim_milestone_achievements()
returns table (
  id        text,
  threshold integer,
  progress  integer,
  earned    boolean,
  earned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  -- Refuses an unauthenticated caller outright. SECURITY DEFINER bypasses RLS,
  -- so this is the whole access boundary and it is the first statement.
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- One pass over the caller's own rows. Every count is keyed on v_uid; none of
  -- them can see another account, and none is passed in by the caller.
  return query
  with stats as (
    select
      (select count(*) from public.follows f
         where f.followee_id = v_uid and f.status = 'accepted')      as followers,
      (select count(*) from public.follows f
         where f.follower_id = v_uid and f.status = 'accepted')      as following,
      (select count(*) from public.financial_connections c
         where c.user_id = v_uid)                                    as banks,
      (select count(*) from public.savings_goals g
         where g.user_id = v_uid)                                    as goals_set,
      (select count(*) from public.savings_goals g
         where g.user_id = v_uid
           and coalesce(g.target_amount, 0) > 0
           and coalesce(g.current_amount, 0) >= g.target_amount)     as goals_reached,
      (select count(*) from public.synced_transaction_reviews r
         where r.user_id = v_uid)                                    as reviews,
      -- HELD a debt, and none of them carries a balance now. Both halves, or an
      -- account that never had a debt is told it cleared one.
      (select case
         when exists (select 1 from public.debts d where d.user_id = v_uid)
          and not exists (select 1 from public.debts d
                            where d.user_id = v_uid and coalesce(d.balance, 0) > 0)
         then 1 else 0 end)                                          as debts_cleared
  ),
  catalogue(m_id, m_threshold, m_progress) as (
    select 'milestone:bank_linked'::text,   1,   s.banks::int          from stats s
    union all select 'milestone:goal_set',      1,   s.goals_set::int      from stats s
    union all select 'milestone:goal_reached',  1,   s.goals_reached::int  from stats s
    union all select 'milestone:debt_free',     1,   s.debts_cleared::int  from stats s
    union all select 'milestone:reviewed_25',   25,  s.reviews::int        from stats s
    union all select 'milestone:reviewed_100',  100, s.reviews::int        from stats s
    union all select 'milestone:followers_1',   1,   s.followers::int      from stats s
    union all select 'milestone:followers_5',   5,   s.followers::int      from stats s
    union all select 'milestone:followers_10',  10,  s.followers::int      from stats s
    union all select 'milestone:following_1',   1,   s.following::int      from stats s
    union all select 'milestone:following_5',   5,   s.following::int      from stats s
  ),
  -- Grant anything newly earned. ON CONFLICT DO NOTHING makes the whole call
  -- idempotent, so the client may run it on every visit without a duplicate.
  granted as (
    -- ALIASED, and the RETURNING is qualified. `earned_at` is also an OUT
    -- parameter of this function, so a bare reference here is ambiguous and
    -- Postgres refuses the whole call with 42702 -- found by running it, not by
    -- reading it.
    insert into public.achievements as a (user_id, achievement_id)
    select v_uid, c.m_id from catalogue c where c.m_progress >= c.m_threshold
    on conflict (user_id, achievement_id) do nothing
    returning a.achievement_id, a.earned_at
  ),
  -- Read back AFTER the insert, so a badge earned by this very call reports its
  -- real granted time rather than nothing. `granted` only returns rows this
  -- statement inserted, so badges held from before come from the table.
  held as (
    select a.achievement_id, a.earned_at
      from public.achievements a
     where a.user_id = v_uid and a.achievement_id like 'milestone:%'
    union all
    select g.achievement_id, g.earned_at from granted g
  ),
  held_one as (
    select distinct on (achievement_id) achievement_id, earned_at
      from held order by achievement_id, earned_at
  )
  select
    c.m_id,
    c.m_threshold,
    c.m_progress,
    (h.achievement_id is not null) as earned,
    h.earned_at
  from catalogue c
  left join held_one h on h.achievement_id = c.m_id
  order by c.m_id;
end;
$fn$;

-- Nothing anonymous may call this. It writes rows.
revoke all on function public.claim_milestone_achievements() from public, anon;
grant execute on function public.claim_milestone_achievements() to authenticated;

commit;
