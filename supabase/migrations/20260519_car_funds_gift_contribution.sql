alter table public.car_funds
  add column if not exists gift_contribution numeric not null default 0;
