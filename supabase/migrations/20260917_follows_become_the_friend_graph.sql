-- ─────────────────────────────────────────────────────────────────────────────
-- FRIENDS **ARE** FOLLOWERS AND FOLLOWING.
--
-- Tre, 2026-09-17: "friends should be followers and following just like instagram. it
-- should only be on that tab."
--
-- ⚠️ THIS TOUCHES WHO CAN READ ANOTHER PERSON'S MONEY DATA, which the migration that
-- created `follows` deliberately refused to do and said belonged in its own migration with
-- its own review. This is that migration. The reasoning is below, in full, because a future
-- session must be able to check it rather than trust it.
--
-- ── WHY THIS DOES NOT WIDEN ACCESS ───────────────────────────────────────────
-- The existing gate is BILATERAL CONSENT: `active_friend_ids()` returns the other party of
-- an `accepted`, non-revoked `friend_links` row - one person invited, the other accepted,
-- so BOTH acted deliberately.
--
-- **A MUTUAL FOLLOW HAS EXACTLY THAT PROPERTY.** A follows B *and* B follows A means each
-- side took its own deliberate action. For a PRIVATE account the followee also approved.
-- For a PUBLIC one, A can follow B without approval - but that alone does nothing here,
-- because B must ALSO follow A, and that is B's own act.
--
-- ⚠️ **A ONE-DIRECTIONAL FOLLOW IS THE VERSION THAT WOULD WIDEN IT, AND IT IS REFUSED.**
-- If a single follow were enough, making your account public would hand every stranger who
-- followed you your published buckets. `and f2.follower_id = f1.followee_id` below is the
-- line that prevents that. Do not "simplify" it.
--
-- AND THE SECOND GATE IS UNCHANGED: the policy still requires `is_metric_shared(user_id,
-- metric)`, a per-metric opt-in that DEFAULTS OFF, plus a four-week window. A mutual follow
-- grants nothing on its own; it only makes you eligible for what the other person has
-- already chosen to publish.
--
-- ── ADDITIVE. `friend_links` IS PRESERVED, NOT MIGRATED ──────────────────────
-- Existing friendships keep working - the union below keeps reading them. Nobody loses a
-- connection they already have, and nothing is deleted. Measured before writing: 1 accepted
-- friend link across 33 profiles, so the blast radius either way is small - which is a
-- reason to be careful with the one real relationship, not a reason to drop it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.active_friend_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  -- 1. Legacy friend links. Unchanged, and deliberately still first.
  select case when fl.inviter_id = auth.uid() then fl.accepted_by
              else fl.inviter_id end
    from public.friend_links fl
   where (fl.inviter_id = auth.uid() or fl.accepted_by = auth.uid())
     and fl.accepted_at is not null
     and fl.revoked_at is null

  union

  -- 2. MUTUAL accepted follows. Both rows must exist and both must be accepted.
  select f1.followee_id
    from public.follows f1
    join public.follows f2
      on  f2.follower_id = f1.followee_id      -- ⚠️ the mutuality test. See the note above.
      and f2.followee_id = f1.follower_id
   where f1.follower_id = auth.uid()
     and f1.status = 'accepted'
     and f2.status = 'accepted'
$fn$;

comment on function public.active_friend_ids() is
  'Everyone you have BILATERAL consent with: a legacy accepted friend_link, or a MUTUAL accepted follow. A one-directional follow is deliberately NOT enough - see the migration 20260917_follows_become_the_friend_graph.sql for why.';

revoke all on function public.active_friend_ids() from public, anon;
grant execute on function public.active_friend_ids() to authenticated;

-- ── NAMES FOR THE PEOPLE IN YOUR OWN GRAPH ───────────────────────────────────
-- ⚠️ WITHOUT THIS THE FEATURE IS UNUSABLE, and that is not an overstatement: a `follows`
-- row carries only user ids, so every row in the UI reads "A Forgenta member #3f2a91c4"
-- and the leaderboard has no label to rank by.
--
-- ⚠️ IT CANNOT BE USED TO ENUMERATE ANYBODY. It returns rows ONLY for users the caller
-- already has a `follows` row with - which is precisely the set whose user_ids RLS already
-- lets them read. So it adds a NAME to an id the caller can already see, and reveals the
-- existence of nobody they are not already connected to.
--
-- PENDING rows are included ON PURPOSE, in both directions: a request you RECEIVED has to
-- show who is asking or you cannot decide it, and a request you SENT you made by typing
-- that person's exact username. Neither discloses anything the caller did not already have.
create or replace function public.follow_profiles()
returns table (user_id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.user_id, p.username, p.display_name
    from public.profiles p
   where auth.uid() is not null
     and p.user_id <> auth.uid()
     and exists (
       select 1 from public.follows f
        where (f.follower_id = auth.uid() and f.followee_id = p.user_id)
           or (f.followee_id = auth.uid() and f.follower_id = p.user_id)
     )
$fn$;

comment on function public.follow_profiles() is
  'Display names for the people in YOUR OWN follow graph, and nobody else. Cannot enumerate the user base: it returns only counterparties of a follows row the caller is already a party to.';

-- ⚠️ `anon` IS NAMED EXPLICITLY. Supabase''s ALTER DEFAULT PRIVILEGES grants execute to
-- anon on every new function in `public`, and `revoke ... from public` does NOT remove a
-- direct grant to a named role - measured on 2026-09-17, when both follow RPCs were found
-- reachable by anon for exactly that reason.
revoke all on function public.follow_profiles() from public, anon;
grant execute on function public.follow_profiles() to authenticated;

-- ── UNDO ─────────────────────────────────────────────────────────────────────
-- drop function if exists public.follow_profiles();
-- -- and restore the friend_links-only body of active_friend_ids():
-- create or replace function public.active_friend_ids()
-- returns setof uuid language sql stable security definer set search_path = '' as $undo$
--   select case when fl.inviter_id = auth.uid() then fl.accepted_by else fl.inviter_id end
--     from public.friend_links fl
--    where (fl.inviter_id = auth.uid() or fl.accepted_by = auth.uid())
--      and fl.accepted_at is not null and fl.revoked_at is null
-- $undo$;
