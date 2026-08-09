-- §1B Stage 3 — provenance on the ledger.
--
-- Until now `public.transactions` was purely hand-entered, a premise stated in three places across
-- the §1A migration and plan. Stage 3's "Add to my ledger" breaks that premise, so the distinction
-- gets recorded in the row itself rather than inferred later from the review table (which a user can
-- delete, and which says nothing about the 22 rows that predate it).
--
-- `manual` is the correct value for every existing row, which is why the default is not `synced`:
-- an unstamped row is a hand-entered one, and backfilling is a no-op by construction.
alter table public.transactions
  add column if not exists origin text not null default 'manual';

alter table public.transactions
  drop constraint if exists transactions_origin_check;

alter table public.transactions
  add constraint transactions_origin_check check (origin in ('manual', 'synced'));

comment on column public.transactions.origin is
  '§1B: ''manual'' = the user typed it; ''synced'' = imported from a synced bank transaction via the Bank Activity tab. Imported rows stay fully editable.';
