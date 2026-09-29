-- business_user_funnel() - where real users stopped, as COUNTS ONLY.
--
-- Sam asked 2026-09-29 for a funnel that can be re-measured weekly. The same read,
-- run by hand that day, found 30 real users: 14 saved nothing, 14 saved data but
-- linked no bank, 2 linked a bank, and 16 last acted on their signup day.
--
-- ⚠️ STAGE COMES FROM SAVED ROWS, NOT profiles.onboarding_completed. Measured
-- 2026-09-29: that flag is false for 12 users who have data or a bank, and
-- onboarding_furthest_step is null for 24 because the column is newer than the users.
-- A funnel built on the flag reports 25 of 30 as "never onboarded", which is false.
--
-- ⚠️ NOT PUBLIC. Execute is revoked from public, anon and authenticated and granted to
-- service_role only. A user count reachable by anyone is a disclosure about the business.
--
-- ⚠️ COUNTS, NEVER ROWS. No id, no email, no date leaves this function.
--
-- TEST ACCOUNTS use the same RFC-reserved predicate as business_user_counts(). The row
-- stage = '0 control' carries the count EXCLUDED by that predicate: it is the positive
-- control. A predicate that matched nothing would report 0 there, and without the row a
-- broken filter and a clean one cannot be told apart. The owner account IS included,
-- because it is not reserved; the hand-run figures above excluded it (31 vs 30).
--
-- last_act = greatest(last_sign_in_at, max(updated_at) on accounts, recurring_rules,
-- savings_goals). A read-only visit with a live session leaves no trace, so recency is a
-- floor, not an exact figure.
--
-- Does NOT survive per-user RLS, and cannot: it is a business aggregate across all users.
-- Undo: drop function public.business_user_funnel();

create or replace function public.business_user_funnel()
returns table (
  stage text,
  recency text,
  users bigint,
  same_day bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      au.id,
      au.created_at,
      au.last_sign_in_at,
      (au.email ~* '(\.test|\.example|\.invalid|\.localhost)$'
        or au.email ~* '@example\.(com|net|org)$') as reserved
    from auth.users au
    where au.email is not null
  ),
  u as (
    select
      b.created_at,
      (select count(*) from public.financial_connections fc where fc.user_id = b.id) as n_fc,
        (select count(*) from public.accounts a where a.user_id = b.id)
      + (select count(*) from public.recurring_rules r where r.user_id = b.id)
      + (select count(*) from public.savings_goals g where g.user_id = b.id)
      + (select count(*) from public.transactions t where t.user_id = b.id) as n_data,
      greatest(
        b.last_sign_in_at,
        (select max(a.updated_at) from public.accounts a where a.user_id = b.id),
        (select max(r.updated_at) from public.recurring_rules r where r.user_id = b.id),
        (select max(g.updated_at) from public.savings_goals g where g.user_id = b.id)
      ) as last_act
    from base b
    where not b.reserved
  ),
  staged as (
    select
      case
        when n_fc > 0 then '3 bank linked'
        when n_data > 0 then '2 data, no bank'
        else '1 saved nothing'
      end as stage,
      case
        when last_act is null then 'never'
        when last_act > now() - interval '7 days' then '<7d'
        when last_act > now() - interval '30 days' then '7-30d'
        else '>30d'
      end as recency,
      (last_act < created_at + interval '1 day') as is_same_day
    from u
  )
  select '0 control' as stage, 'reserved excluded' as recency,
         count(*) filter (where reserved) as users, 0::bigint as same_day
  from base
  union all
  select s.stage, s.recency, count(*), count(*) filter (where s.is_same_day)
  from staged s
  group by s.stage, s.recency
  order by 1, 2;
$$;

revoke all on function public.business_user_funnel() from public, anon, authenticated;
grant execute on function public.business_user_funnel() to service_role;
