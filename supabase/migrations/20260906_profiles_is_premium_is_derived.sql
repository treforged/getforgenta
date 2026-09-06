-- profiles.is_premium DISAGREED WITH user_subscriptions, AND THE REASON IS THAT NOTHING OWNS IT.
--
-- Found 2026-09-06 while reading revenue numbers: 5 distinct users are premium according to
-- `user_subscriptions`, and only 3 according to `profiles.is_premium`. The obvious reading is
-- "two systems disagree and one is wrong". That reading is WRONG, and the evidence matters more
-- than the fix:
--
--   * NOTHING READS THIS COLUMN. `useSubscription` is `SubscriptionContext`, which selects from
--     `user_subscriptions` (`SubscriptionContext.tsx:56`). Every premium gate in the app and in
--     the edge functions goes through `plan = 'premium' AND subscription_status IN
--     ('active','trialing')`. `grep -rn is_premium src/ supabase/` returns five hits and not one
--     of them consults this column: three build an in-memory demo/default profile object, one is
--     a TypeScript field, and one is a LOCAL VARIABLE inside `track_og_premium_state` that merely
--     shares the name.
--   * NOTHING WRITES IT EITHER. No policy, routine or view in this database mentions it --
--     checked against `pg_policies`, `pg_proc` and `pg_views`.
--
-- So this is not a competing source of truth. It is an ABANDONED column, frozen at whatever its
-- last writer left, and the "disagreement" is the drift you get for free when a value has no
-- owner. Nobody is seeing the wrong app because of it.
--
-- WHY BACKFILL RATHER THAN DROP. Dropping is the better long-term answer and is NOT done here:
-- it is irreversible against real user rows, and it belongs to a person, not to this migration.
-- Backfilling plus a comment plus an assertion makes the column honest today and makes the next
-- divergence loud, which is what a column awaiting a decision should do.
--
-- TO UNDO: exactly two rows change, both false -> true, both recorded here.
--   update public.profiles set is_premium = false
--    where user_id in ('5bc979fe-86db-4347-ba53-6a627dce5902',
--                      'a72f416e-433a-4055-9ab0-9feae4e60edf');

begin;

-- 1. Make the column agree with the authority.
update public.profiles p
   set is_premium = exists (
         select 1 from public.user_subscriptions s
          where s.user_id = p.user_id
            and s.plan = 'premium'
            and s.subscription_status in ('active', 'trialing'))
 where p.is_premium is distinct from exists (
         select 1 from public.user_subscriptions s
          where s.user_id = p.user_id
            and s.plan = 'premium'
            and s.subscription_status in ('active', 'trialing'));

-- 2. Say in the schema itself which table is authoritative, so the next person reading this
--    column does not have to run the same three greps to find out that it is not.
comment on column public.profiles.is_premium is
  'DERIVED AND DEPRECATED, 2026-09-06. NOT a source of truth and read by nothing: every premium '
  'gate in the app and the edge functions uses user_subscriptions.plan = ''premium'' AND '
  'subscription_status IN (''active'',''trialing''). Kept only until a decision is taken to drop '
  'it. Do not add a reader.';

-- 3. THE MIGRATION VERIFIES ITSELF. This exact predicate returned 2 rows before the update
--    above; if it returns any row after it, the backfill did not do what it claims and the
--    transaction is rolled back rather than reporting a success it did not achieve.
do $$
declare
  n integer;
begin
  select count(*) into n
    from public.profiles p
   where p.is_premium is distinct from exists (
           select 1 from public.user_subscriptions s
            where s.user_id = p.user_id
              and s.plan = 'premium'
              and s.subscription_status in ('active', 'trialing'));
  if n <> 0 then
    raise exception
      'profiles.is_premium still disagrees with user_subscriptions on % row(s) after backfill', n;
  end if;
end $$;

commit;
