create table public.payment_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  provider text,
  total_amount numeric not null,
  payment_amount numeric not null,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  start_date date not null,
  total_payments integer not null check (total_payments > 0),
  category text not null default 'Shopping',
  payment_source text,
  notes text,
  active boolean not null default true,
  created_at timestamptz default now() not null
);

create index idx_payment_plans_user on public.payment_plans(user_id);

alter table public.payment_plans enable row level security;

create policy "users manage own payment plans"
  on public.payment_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
