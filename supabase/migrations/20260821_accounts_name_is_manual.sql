-- A user-chosen name for a Plaid-linked account, that the sync will not clobber.
--
-- Tre, 2026-08-21: "allow user account rename, to prevent further problems identifying. still block
-- institution change."
--
-- WHY IT WAS BLOCKED, AND WHY THAT WAS WRONG. `persistAccount` writes `name: account.name` on every
-- single sync, so a rename would survive until the next run and then silently revert. The UI
-- disabled the field rather than let a user watch their edit disappear — the honest choice given
-- the sync, but it left the app unable to tell two accounts apart when the provider gives them the
-- SAME name. That is not hypothetical: re-linking Robinhood on 2026-08-21 produced two rows both
-- called "Robinhood individual", one a personal account and one traded by an agent, and nothing in
-- the app could distinguish them. A name is the one field whose whole job is identification.
--
-- THE SAME SHAPE AS `min_payment_is_manual` AND `apr_plaid_synced`, deliberately. This codebase
-- already has a settled answer for "the provider owns this field until the user takes it over", and
-- inventing a second one would leave two policies to keep in step. The flag is set by the edit form
-- at the moment of the rename, and `persistAccount` omits `name` from its update payload whenever
-- it is true.
--
-- INSTITUTION STAYS PROVIDER-OWNED. It is not a label, it is what the row IS — the connection it
-- belongs to, which the user cannot change by typing. It stays disabled in the form and keeps being
-- written from `connection.institution_name` on every sync.
--
-- `not null default false` is safe here where the ranked-allocation columns were nullable: FALSE is
-- the correct reading of every existing row (nobody has renamed anything yet, because they could
-- not), so there is no third state to represent and no backfill to get wrong.

alter table public.accounts
  add column if not exists name_is_manual boolean not null default false;

comment on column public.accounts.name_is_manual is
  'TRUE once the user has renamed this account themselves. While true the provider sync leaves `name` alone entirely — see persistAccount in supabase/functions/_shared/sync-handler.ts. Institution is NOT covered by this and stays provider-owned. Same pattern as min_payment_is_manual.';
