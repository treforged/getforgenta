-- ec48da25: Plaid's last_statement_balance may now fill accounts.statement_balance.
-- This flag records WHO wrote it, exactly as apr_plaid_synced does for apr:
--   true  = the stored statement_balance came from Plaid; a later sync may replace or clear it.
--   null/false = a person typed it (or it is empty); a sync never overwrites a typed value.
-- Nullable, no default, no backfill: every existing statement_balance was typed by a person.
-- Undo: alter table public.accounts drop column statement_balance_plaid_synced;
alter table public.accounts
  add column if not exists statement_balance_plaid_synced boolean;

comment on column public.accounts.statement_balance_plaid_synced is
  'true = statement_balance came from Plaid /liabilities/get (ec48da25). null/false = user-owned.';
