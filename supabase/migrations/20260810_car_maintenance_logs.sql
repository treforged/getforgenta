-- car_maintenance_logs: service history per build (oil changes, tire rotations, …)
--
-- `next_due_date` / `next_due_odometer` are the SOURCE OF TRUTH for "when is this
-- due again". `interval_months` / `interval_miles` are kept only so the form can
-- pre-fill the next due values and so the next entry of the same service can
-- inherit the schedule — the UI never derives the due badge from them, because two
-- sources of truth for one number is how a due date and its badge end up disagreeing.
create table public.car_maintenance_logs (
  id uuid default gen_random_uuid() primary key,
  build_id uuid references public.car_builds(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  service text not null,
  service_date date not null,
  odometer integer,
  cost numeric,
  vendor text,
  notes text,
  interval_months integer,
  interval_miles integer,
  next_due_date date,
  next_due_odometer integer,
  created_at timestamptz default now() not null
);

create index idx_car_maintenance_logs_build on public.car_maintenance_logs(build_id);
create index idx_car_maintenance_logs_user on public.car_maintenance_logs(user_id);

alter table public.car_maintenance_logs enable row level security;

create policy "users manage own maintenance logs"
  on public.car_maintenance_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Link transactions to a maintenance entry, mirroring car_build_item_id exactly.
-- Multiple transactions can reference one entry (parts on one card, labour on another).
-- on delete set null: deleting a log entry must never destroy the money record.
alter table public.transactions
  add column if not exists car_maintenance_log_id uuid
    references public.car_maintenance_logs(id)
    on delete set null;

create index if not exists idx_transactions_car_maintenance_log
  on public.transactions(car_maintenance_log_id)
  where car_maintenance_log_id is not null;
