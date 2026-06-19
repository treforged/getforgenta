-- Add loan_payment_account to car_funds — the account the ongoing monthly loan
-- payment is paid from, independent of linked_account (down-payment savings only).
alter table public.car_funds
  add column if not exists loan_payment_account uuid references public.accounts(id) on delete set null;
