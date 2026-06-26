alter table public.payment_plans
  add column if not exists plan_type text not null default 'upfront'
    check (plan_type in ('upfront', 'monthly_charge'));
