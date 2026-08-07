-- Fix: the plaid_items compatibility view was unreadable by authenticated users
-- ============================================================================
-- 20260806_financial_connections.sql created `plaid_items` as a compatibility
-- view with `security_invoker = on`, and granted `authenticated` SELECT on a
-- NAMED SUBSET of financial_connections columns (deliberately excluding
-- access_token).
--
-- Those two decisions interact badly. A security_invoker view executes its whole
-- body as the CALLER, so the caller needs privileges on every column the view
-- REFERENCES — not merely the ones the caller projects. The view referenced
-- `sync_cursor`, which was never in the grant list, so *any* read of the view as
-- `authenticated` failed outright:
--
--   ERROR: 42501: permission denied for table financial_connections
--
-- That was true even for `select id from plaid_items`. Verified live 2026-08-07
-- immediately after the migration was applied.
--
-- No user-facing breakage resulted, because the frontend had already migrated
-- off this view: src/hooks/usePlaidItems.ts is now a pure client-side shim over
-- useFinancialConnections, which queries financial_connections directly with
-- exactly the granted columns. The view was left broken but unused — a trap for
-- the next caller rather than a live outage.
--
-- Fix: drop `sync_cursor` from the view instead of granting it. It is internal
-- sync bookkeeping (a Plaid pagination cursor); edge functions read it from the
-- base table with the service role, and no client has a reason to see it. This
-- keeps the grant surface as narrow as the original migration intended.

begin;

-- DROP + CREATE rather than CREATE OR REPLACE: replacing a view cannot remove a
-- column from its output list, and sync_cursor is exactly what has to go.
drop view if exists public.plaid_items;

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
    created_at,
    updated_at
  from public.financial_connections
  where provider = 'plaid';

grant select on public.plaid_items to authenticated;

commit;
