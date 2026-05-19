alter table public.car_funds
  add column if not exists planned_purchase_date date;
