-- Link transactions to car build items (parts).
-- A transaction can optionally point to the car part it paid for.
-- Multiple transactions can reference the same item (e.g. partial payments).
-- on delete set null: deleting a part doesn't destroy the transaction.

alter table public.transactions
  add column if not exists car_build_item_id uuid
    references public.car_build_items(id)
    on delete set null;

create index if not exists idx_transactions_car_build_item
  on public.transactions(car_build_item_id)
  where car_build_item_id is not null;
