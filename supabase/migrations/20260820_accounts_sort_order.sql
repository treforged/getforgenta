-- Reorderable accounts: where each account sits in the Balances list.
--
-- One column on a table that already exists and already carries RLS + owner policies, so this
-- adds no new attack surface: an added column inherits the table's existing grants and policies
-- (the 2026-06-15 enumeration lesson applies to NEW tables, whose default `public` ACLs make them
-- world-writable the instant they exist).
--
-- Before this, `useAccounts` ordered by `created_at` -- date added -- and there was no way for a
-- user to say "this is the account I look at first". That ordering is PRESERVED, twice over:
--   * the backfill below seats every existing row at its current created_at rank, so nobody's
--     list moves when this deploys;
--   * the query orders by `sort_order, created_at`, so a tie (two rows a client wrote at the same
--     rank, or a row inserted at the default 0) still falls back to date added instead of
--     rendering nondeterministically.
--
-- `not null default 0` rather than a nullable column with NULLS LAST: a nullable column would let
-- untouched rows fall back to created_at for free, but then the FIRST reorder has to write a rank
-- for every row the user owns. One rule, always applied, is cheaper to reason about and cheaper
-- to write.

alter table public.accounts
  add column if not exists sort_order integer not null default 0;

-- Seat existing rows at their current visual order (date added, per user).
-- `- 1` so the first account is 0, matching the column default for a brand-new row -- a fresh
-- account lands at the top of the list ahead of nothing, which is the same place `created_at`
-- ordering put it.
with ranked as (
  select id, (row_number() over (partition by user_id order by created_at, id) - 1) as rn
  from public.accounts
)
update public.accounts a
set sort_order = ranked.rn
from ranked
where ranked.id = a.id
  and a.sort_order = 0;

create index if not exists accounts_user_sort_order_idx
  on public.accounts (user_id, sort_order);

comment on column public.accounts.sort_order is
  'Where this account sits in the Balances list. Ascending, ties broken by created_at (date added), which is what ordered the list before this column existed. Display only -- no engine reads it.';
