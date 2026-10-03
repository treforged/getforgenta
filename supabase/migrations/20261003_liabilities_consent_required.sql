-- Ask 3248738e: a Plaid item whose liabilities pass answers ADDITIONAL_CONSENT_REQUIRED had no
-- record of it anywhere, so the app could not ask the user to allow statement data. The sync
-- (_shared/sync-handler.ts) now sets this when Plaid says consent is missing and clears it on a
-- liabilities pass that succeeds. Additive and defaulted: every existing row reads false.
-- Undo: alter table public.financial_connections drop column liabilities_consent_required;
--       and re-create plaid_items without the last column.
alter table public.financial_connections
  add column if not exists liabilities_consent_required boolean not null default false;

-- The client reads Plaid connections through this view. security_invoker stays on, so the base
-- table's RLS still decides which rows a user sees. The new column is appended (a view can only
-- grow at the end), and access_token is still left out on purpose.
create or replace view public.plaid_items with (security_invoker = on) as
  select id, user_id, provider_item_id as plaid_item_id, institution_id, institution_name,
         last_synced_at, created_at, updated_at, liabilities_consent_required
    from public.financial_connections
   where provider = 'plaid'::text;
