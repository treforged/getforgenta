-- Extend car_funds to support a two-phase vehicle lifecycle:
-- phase='saving'  → existing down-payment savings behavior (default)
-- phase='loan'    → active auto loan tracking with full amortization support

alter table public.car_funds
  add column if not exists phase text not null default 'saving'
    check (phase in ('saving', 'loan')),
  add column if not exists loan_amount numeric not null default 0,
  add column if not exists loan_start_date date,
  add column if not exists payment_start_date date,
  add column if not exists interest_start_date date,
  add column if not exists actual_monthly_payment numeric not null default 0;

create index if not exists idx_car_funds_user_phase
  on public.car_funds(user_id, phase);
