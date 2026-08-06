-- Multi-provider account aggregation
-- ==================================
-- Generalises the Plaid-only `plaid_items` table into `financial_connections`,
-- which carries a `provider` discriminator so Akoya can act as a fallback
-- aggregator when Plaid cannot reach an institution.
--
-- The existing table is RENAMED rather than replaced: rows, primary key, the
-- user_id foreign key and all live Plaid access tokens stay exactly where they
-- are. Nothing is dropped and nothing is copied.
--
-- Backwards compatibility: `plaid_items` comes back as a view over
-- financial_connections filtered to provider='plaid', so existing frontend
-- reads (src/hooks/usePlaidItems.ts) keep working unchanged.
--
-- SECURITY CHANGE: the old `plaid_items` RLS policy was FOR ALL TO public with
-- USING (auth.uid() = user_id), which let an authenticated user SELECT their own
-- access_token straight from PostgREST. After this migration, SELECT is granted
-- only on non-secret columns; token columns are reachable by the service role
-- alone, and the compatibility view does not expose them at all.

begin;

-- ── Rename the table in place ──────────────────────────────────────────────
alter table public.plaid_items rename to financial_connections;
alter table public.financial_connections rename column plaid_item_id to provider_item_id;

alter index if exists plaid_items_pkey rename to financial_connections_pkey;

-- ── Provider discriminator + Akoya token columns ───────────────────────────
alter table public.financial_connections
  add column if not exists provider text not null default 'plaid',
  -- Akoya: rotating refresh token, AES-256-GCM via _shared/token-crypto.ts.
  add column if not exists refresh_token_encrypted text,
  -- Akoya: cached short-lived id_token (the bearer for data calls).
  add column if not exists id_token_encrypted text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists connection_status text not null default 'active',
  -- Sync mutex. Akoya invalidates a refresh token the moment it is exchanged,
  -- so two workers refreshing the same connection concurrently would destroy
  -- each other's credentials. A worker must claim this before touching tokens.
  add column if not exists sync_locked_until timestamptz;

alter table public.financial_connections
  add constraint financial_connections_provider_check
    check (provider in ('plaid', 'akoya')),
  add constraint financial_connections_status_check
    check (connection_status in ('active', 'reauth_required', 'revoked', 'error'));

-- Plaid rows carry a long-lived access_token; Akoya rows leave it null and use
-- the encrypted refresh/id token pair instead.
alter table public.financial_connections alter column access_token drop not null;

-- Uniqueness now has to include the provider: the same institution may be
-- connected through both Plaid and Akoya.
alter table public.financial_connections
  drop constraint if exists plaid_items_user_id_plaid_item_id_key;
alter table public.financial_connections
  add constraint financial_connections_user_provider_item_key
    unique (user_id, provider, provider_item_id);

create index if not exists financial_connections_user_provider_idx
  on public.financial_connections (user_id, provider);

-- ── Compatibility view ─────────────────────────────────────────────────────
-- security_invoker so the underlying financial_connections RLS still applies.
-- access_token is deliberately absent: edge functions read the base table with
-- the service role instead.
create view public.plaid_items
  with (security_invoker = on)
as
  select
    id,
    user_id,
    provider_item_id as plaid_item_id,
    institution_id,
    institution_name,
    last_synced_at,
    sync_cursor,
    created_at,
    updated_at
  from public.financial_connections
  where provider = 'plaid';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- The rename carried the old "Users own plaid items" FOR ALL policy across.
-- Replace it with read-only access: every write path (link, sync, delink) runs
-- through an edge function using the service role.
drop policy if exists "Users own plaid items" on public.financial_connections;

alter table public.financial_connections enable row level security;

create policy financial_connections_select_own
  on public.financial_connections
  for select
  to authenticated
  using (auth.uid() = user_id);

-- The reviewer-account reset in AuthContext stamps last_synced_at from the
-- client. Narrow column grant rather than a blanket UPDATE: this is still a
-- tightening, since the old FOR ALL policy let a user write access_token.
create policy financial_connections_update_own
  on public.financial_connections
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.financial_connections from anon, authenticated;
grant select (
  id, user_id, provider, provider_item_id, institution_id, institution_name,
  connection_status, last_synced_at, created_at, updated_at
) on public.financial_connections to authenticated;
grant update (last_synced_at) on public.financial_connections to authenticated;

grant select on public.plaid_items to authenticated;

-- ── OAuth state (CSRF) ─────────────────────────────────────────────────────
-- Server-generated, single-use, short TTL. A state value echoed back by the
-- client is only trusted once it matches an unconsumed row here.
create table if not exists public.oauth_states (
  state        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  provider     text not null,
  connector    text,
  redirect_uri text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '10 minutes'),
  consumed_at  timestamptz
);

create index if not exists oauth_states_expires_at_idx
  on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;
-- No policies at all: service role only.
revoke all on public.oauth_states from anon, authenticated;

-- ── accounts: provider attribution ─────────────────────────────────────────
-- plaid_account_id / plaid_item_id keep their names. They hold opaque provider
-- identifiers and are referenced across ~35 files; renaming buys nothing
-- functional. `provider` is what distinguishes them from here on.
alter table public.accounts
  add column if not exists provider text not null default 'plaid',
  add column if not exists connection_id uuid
    references public.financial_connections(id) on delete set null;

alter table public.accounts
  add constraint accounts_provider_check
    check (provider in ('plaid', 'akoya', 'manual'));

update public.accounts a
   set connection_id = fc.id
  from public.financial_connections fc
 where fc.user_id = a.user_id
   and fc.provider = 'plaid'
   and fc.provider_item_id = a.plaid_item_id
   and a.connection_id is null;

-- Accounts that were never linked to an aggregator are manual entries.
update public.accounts
   set provider = 'manual'
 where plaid_item_id is null
   and connection_id is null;

create index if not exists accounts_connection_id_idx
  on public.accounts (connection_id) where connection_id is not null;

commit;
