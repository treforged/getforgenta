-- The bank's own minimum, kept even when the user typed their own (ask ec48da25, 2026-10-03).
-- sync-handler never overwrites a MANUAL min_payment, which is right (it is the user's decision),
-- but it also threw the bank's newer figure away, so a stale manual minimum stayed stale for ever
-- with nothing on screen saying so. Measured on Tre's Discover: manual 150.40, bank took 198.17.
-- These two columns hold what the provider last reported, so the card row can show both.
-- Undo: alter table public.accounts drop column bank_min_payment, drop column bank_min_seen_at;
alter table public.accounts
  add column if not exists bank_min_payment numeric(12,2),
  add column if not exists bank_min_seen_at timestamptz;

comment on column public.accounts.bank_min_payment is
  'Minimum the provider last reported (still due on the current statement). Written on every sync, even when min_payment is manual.';
