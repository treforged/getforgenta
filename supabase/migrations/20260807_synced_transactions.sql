-- §1A Stage A — settled/pending transaction evidence from account aggregators.
--
-- WHY A NEW TABLE, not public.transactions: that table is the user's HAND-ENTERED ledger.
-- useSupabaseData.ts gives it full CRUD with "Transaction added" / "Transaction deleted" toasts.
-- Writing hundreds of aggregator rows into a table the user believes they own reads as the app
-- inventing transactions they never entered. These two datasets stay separate permanently.
--
-- WHY USERS CANNOT WRITE THIS TABLE: there is deliberately no insert/update/delete policy and no
-- DML grant to `authenticated`. The rows are provider facts, reconciled against a Plaid cursor;
-- a user edit would be silently reverted on the next sync, so the honest design is to forbid it
-- at the grant layer rather than let PostgREST accept a write that cannot survive.

create table if not exists public.synced_transactions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  connection_id           uuid not null references public.financial_connections(id) on delete cascade,
  -- set null, not cascade: an account row can be re-created by a later sync, and losing the
  -- transaction history because the account row churned would be a silent data loss.
  account_id              uuid references public.accounts(id) on delete set null,

  provider_transaction_id text not null,
  -- Plaid stamps the POSTED transaction with the id of the pending row it replaces. This column
  -- is what lets the upsert retire that pending row instead of double-counting the same charge.
  pending_transaction_id  text,

  -- Normalised so a positive amount is ALWAYS money leaving the user. Plaid's own sign convention
  -- is the opposite for credit accounts, so normalisation happens once at ingest and every reader
  -- downstream can stop thinking about it.
  amount                  numeric not null,
  -- authorized_date when the provider supplies it, else date. Authorisation is when the money is
  -- committed, which is what "has this bill been paid" actually asks.
  date                    date not null,
  pending                 boolean not null default false,

  name                    text,
  merchant_name           text,
  category                text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- The idempotency key. Cursor replay after a failed write MUST be a no-op, so the upsert targets
-- this pair. Scoped per connection because provider ids are only unique within an item.
create unique index if not exists synced_transactions_provider_uniq
  on public.synced_transactions (connection_id, provider_transaction_id);

-- The exact shape the matcher queries on: one account, one date window, one user.
create index if not exists synced_transactions_lookup
  on public.synced_transactions (user_id, account_id, date desc);

-- Retiring a pending row on its posted successor looks the row up by this column.
create index if not exists synced_transactions_pending_lookup
  on public.synced_transactions (connection_id, pending_transaction_id)
  where pending_transaction_id is not null;

alter table public.synced_transactions enable row level security;

-- Read-only for the owner. No other policy exists on purpose (see header).
drop policy if exists synced_transactions_select_own on public.synced_transactions;
create policy synced_transactions_select_own
  on public.synced_transactions
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.synced_transactions from anon, authenticated;
-- Column-level and NOT table-level: keeps the grant an explicit list, so a future column is
-- unreadable until someone decides it should be. The service role bypasses this entirely.
grant select (
  id, user_id, connection_id, account_id,
  provider_transaction_id, pending_transaction_id,
  amount, date, pending,
  name, merchant_name, category,
  created_at, updated_at
) on public.synced_transactions to authenticated;
