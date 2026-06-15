-- Link car build items to payment plans.
-- Multiple items can share the same payment plan (e.g. one plan finances several parts).
-- on delete set null: deleting a plan doesn't destroy the part.

alter table public.car_build_items
  add column if not exists payment_plan_id uuid
    references public.payment_plans(id)
    on delete set null;

create index if not exists idx_car_build_items_payment_plan
  on public.car_build_items(payment_plan_id)
  where payment_plan_id is not null;
