-- business_user_funnel() v3 - UNEDITED STARTER RULES ARE NOT USER DATA.
--
-- Until 2026-09-29 the Budget page inserted 9 sample rules (BudgetControl.tsx DEFAULT_STARTER_RULES)
-- into any account that opened it with 0 rules. 13 real users carry 291 of them, and 5 have nothing
-- else, so v2 counted those 5 as "data, no bank". A rule still at its exact sample name AND amount
-- is not counted here. A user who kept a sample because it happened to be right is miscounted as
-- not having that rule; that residue is accepted and named.
-- The (name, amount) pairs are copied from DEFAULT_STARTER_RULES; if that list changes, change this.
-- Undo: re-apply 20260929b_business_user_funnel_wizard_tables.sql.

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
      + (select count(*) from public.recurring_rules r where r.user_id = b.id
           and (r.name, r.amount) not in (('Weekly Paycheck', 1875), ('Rent', 1400), ('Utilities', 150),
             ('Groceries', 400), ('Gas / Transport', 200), ('Dining Out', 150), ('Insurance', 280),
             ('Subscriptions', 50), ('Miscellaneous', 100)))
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
