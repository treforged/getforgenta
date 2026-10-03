-- Ask 3248738e, follow-up. financial_connections uses COLUMN-LEVEL grants (access_token is never
-- readable by a user), so the column added in 20261003_liabilities_consent_required.sql was
-- unreadable by authenticated - has_column_privilege read false - and the security_invoker view
-- plaid_items would have errored for any user selecting it. Read-only: users can see the flag,
-- only the sync (service role) writes it. RLS still limits rows to the user's own.
-- Undo: revoke select (liabilities_consent_required) on public.financial_connections from authenticated;
grant select (liabilities_consent_required) on public.financial_connections to authenticated;
