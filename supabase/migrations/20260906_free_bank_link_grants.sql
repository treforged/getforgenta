-- One free linked bank connection per ACCOUNT, and a durable record that it was used.
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON `profiles`. `profiles_update_own` lets any
-- signed-in user UPDATE their own profile row. A marker stored there could be cleared
-- by the account it is meant to constrain, using nothing but the anon key that ships
-- inside the app bundle - and every clear mints another Plaid item, which Tre is billed
-- for. This table is written by the SERVICE ROLE only.
--
-- WHY A DURABLE MARKER RATHER THAN `count(financial_connections)`. Unlinking HARD-DELETES
-- the row (there is no soft-delete column), so a count-based gate is a retry loop wearing
-- a gate's clothes: link free, unlink, link free again, forever, one paid item each time.
-- The grant is consumed once and unlinking does NOT return it.
--
-- WHY IT IS CONSUMED AT TOKEN EXCHANGE, NOT AT LINK-TOKEN CREATION. Plaid bills on the
-- ITEM, not on the link token, and a person who opens Link and backs out has cost nothing.
-- Burning their one free link on an abandoned flow would be charging them for our own
-- modal. `provider_item_id` records which item actually consumed it.

create table if not exists public.free_bank_link_grants (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  consumed_at      timestamptz not null default now(),
  provider         text        not null,
  provider_item_id text        not null
);

comment on table public.free_bank_link_grants is
  'One row per account that has used its single free bank link. Service role only; see 20260906 migration header.';

alter table public.free_bank_link_grants enable row level security;

-- The default public-schema ACL grants ALL to anon and authenticated, so a table created
-- without this is readable - and writable - by anyone holding the anon key. Same class of
-- mistake as the `revenue_summary_lines` leak.
revoke all on public.free_bank_link_grants from anon, authenticated;

-- No policies are declared on purpose. RLS is on and nothing is granted, so anon and
-- authenticated can do nothing at all here; the service role bypasses RLS and is the only
-- writer. A read policy would let a client see the marker, and a client that can see it is
-- a client that will be tempted to act on it instead of on the server's answer.
