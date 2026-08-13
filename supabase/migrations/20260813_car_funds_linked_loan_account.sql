-- Add linked_loan_account_id to car_funds: an explicit link from a car_funds
-- loan to the accounts row (account_type = 'auto_loan') that IS the same
-- liability, so net worth can dedupe by identity instead of guessing from
-- names. See src/lib/net-worth.ts (sharesDistinctiveToken) for the fallback
-- token heuristic this takes priority over.
alter table public.car_funds
  add column if not exists linked_loan_account_id uuid references public.accounts(id) on delete set null;
