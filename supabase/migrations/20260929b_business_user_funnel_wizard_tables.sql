-- business_user_funnel() v2 - also count the tables the ONBOARDING WIZARD writes.
--
-- v1 (20260929_business_user_funnel.sql) counted accounts, recurring_rules, savings_goals and
-- transactions. The wizard's final save writes budget_items, debts and car_funds as well
-- (src/pages/Onboarding.tsx), so a user who finished it with only expenses read as
-- "saved nothing". Measured 2026-09-29: 1 of the 12 users in that stage had budget_items.
-- Everything else about v1 stands; read its header for the grants and the control row.
-- Undo: re-apply 20260929_business_user_funnel.sql.

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
      + (select count(*) from public.transactions t where t.user_id = b.id)
      + (select count(*) from public.budget_items bi where bi.user_id = b.id)
      + (select count(*) from public.debts d where d.user_id = b.id)
      + (select count(*) from public.car_funds cf where cf.user_id = b.id) as n_data,
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
