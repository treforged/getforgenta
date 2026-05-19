-- Add linked_account and linked_rule_id to car_funds for savings-phase account linking
alter table public.car_funds
  add column if not exists linked_account uuid references public.accounts(id) on delete set null,
  add column if not exists linked_rule_id uuid references public.recurring_rules(id) on delete set null;
