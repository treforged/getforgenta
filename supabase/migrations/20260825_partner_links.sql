-- Partner linking — Phase 0 schema (docs/partner-linking-design.md §1, §2, §4).
-- ============================================================================
-- One table, one helper function, one additive SELECT policy per shared table.
-- Nothing here is user-visible yet: no link can exist until the partner-link
-- Edge Function is deployed and somebody both invites AND accepts, so the
-- partner policies at the bottom grant exactly nothing on the day they ship.
--
-- WHY THE FIRST STATEMENT AFTER `create table` IS A REVOKE. Verified on this
-- project 2026-08-19 (20260819_slice6_crowd_merchant_category_learning.sql):
-- the default ACLs on schema `public` grant ALL (`arwdDxtm`) to BOTH `anon` and
-- `authenticated` for every new table, so a table created here is world-
-- writable the instant it exists. `rate_limits` and `oauth_states` start the
-- same way. There is no window in this file where the table is reachable.
--
-- WHY THE INVITE CODE IS NEVER STORED. `share_token` was a readable column and
-- that was the 2026-06-15 enumeration hole (20260615_fix_public_rls.sql). Here
-- the code exists in exactly two places: the invitee's mailbox, and a SHA-256
-- hash in a column with NO client-readable grant. Not even the inviter can read
-- it back.
--
-- MIGRATION ORDER IS LOAD-BEARING: the partner policies call
-- active_partner_id(), which reads partner_links. table → function → policies,
-- wrapped begin/commit like 20260806_financial_connections.sql.

begin;

-- ── The link row ───────────────────────────────────────────────────────────
-- Both consents live in this one row. `inviter_id` wrote it (from their JWT,
-- via the Edge Function); `accepted_by` accepted it (from THEIR JWT, with the
-- exact code, from the invited mailbox). A link is active if and only if
-- `accepted_at is not null and revoked_at is null` — there is deliberately no
-- `status` column, because a status can drift out of sync with the two
-- timestamps the RLS predicates below actually test.
create table if not exists public.partner_links (
  id               uuid primary key default gen_random_uuid(),

  -- Consent #1: creating the invite IS the inviter's consent.
  inviter_id       uuid not null references auth.users(id) on delete cascade,

  -- The invite is BOUND to a mailbox; only its owner can accept. Stored
  -- lowercased, and the CHECK enforces that rather than trusting the caller:
  -- the accept path compares lower(jwt email) against this value, so a row
  -- stored with any uppercase would be permanently unacceptable.
  invitee_email    text not null
                     constraint partner_links_email_lowercase
                       check (invitee_email = lower(invitee_email)),

  -- 128 bits of randomness, SHA-256, hex. NEVER granted to a client role.
  invite_code_hash text not null,

  expires_at       timestamptz not null default (now() + interval '7 days'),

  -- Consent #2: accepting with the exact code IS the invitee's consent.
  accepted_by      uuid references auth.users(id) on delete cascade,
  accepted_at      timestamptz,

  -- Either side, any time, without the other's agreement.
  revoked_at       timestamptz,
  revoked_by       uuid,

  created_at       timestamptz not null default now(),

  -- You cannot link to yourself.
  constraint partner_links_no_self check (accepted_by is distinct from inviter_id),
  -- accepted_by and accepted_at travel together — one without the other is a
  -- half-recorded consent.
  constraint partner_links_accept_pair
    check ((accepted_by is null) = (accepted_at is null))
);

-- ⚠️ NON-NEGOTIABLE FIRST LINE (see the header). Everything the client may do
-- is re-granted explicitly further down; anything not listed there is denied.
revoke all on public.partner_links from anon, authenticated;

alter table public.partner_links enable row level security;

-- ── Uniqueness: one link per person, one outstanding invite per inviter ────
-- One ACTIVE link per person, on either side of the pair.
create unique index if not exists partner_links_one_active_inviter
  on public.partner_links (inviter_id)
  where accepted_at is not null and revoked_at is null;
create unique index if not exists partner_links_one_active_acceptor
  on public.partner_links (accepted_by)
  where accepted_at is not null and revoked_at is null;

-- One OUTSTANDING invite per inviter — stops invite-spraying. NOTE for the
-- Edge Function (it already does this): an expired-but-unrevoked invite still
-- occupies this slot, so `invite` supersedes any outstanding row of its own
-- inviter before inserting. Returning "sent" without sending would be the
-- alternative, and a success the user cannot distinguish from a failure is not
-- an option.
create unique index if not exists partner_links_one_pending
  on public.partner_links (inviter_id)
  where accepted_at is null and revoked_at is null;

-- The accept path's only lookup: exact hash match. Not unique — a SHA-256
-- collision is not the thing being defended against, and `.maybeSingle()`
-- surfaces a duplicate as an error the function reports as its generic 404.
create index if not exists partner_links_invite_code_hash_idx
  on public.partner_links (invite_code_hash);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Members can SEE their own link rows. The code hash is excluded at the GRANT
-- layer below, not here: a policy grants rows, a column grant grants columns.
drop policy if exists partner_links_select_own on public.partner_links;
create policy partner_links_select_own
  on public.partner_links for select to authenticated
  using (auth.uid() = inviter_id or auth.uid() = accepted_by);

-- Either member can REVOKE directly. No function dependency on purpose:
-- leaving must work even if Edge Functions are down.
--
-- ⚠️ REVOCATION IS ONE-WAY, and that is what the `revoked_at` tests in USING
-- and WITH CHECK are for. Membership alone (the design's predicate) would let
-- the OTHER member update `revoked_at` back to null and resurrect a link the
-- first member had severed — re-granting them access to the whole allowlist
-- below without a fresh consent. USING refuses to match an already-revoked
-- row; WITH CHECK refuses to write a null. The only reachable transition is
-- null → not-null, which is the entire feature.
--
-- `revoked_by` is left unconstrained deliberately: it is a label, not a gate,
-- and a mislabelled revocation still severs the link. A WITH CHECK on it would
-- let revocation FAIL for a cosmetic reason, and revocation must never fail
-- (design §5).
drop policy if exists partner_links_revoke_own on public.partner_links;
create policy partner_links_revoke_own
  on public.partner_links for update to authenticated
  using (
    (auth.uid() = inviter_id or auth.uid() = accepted_by)
    and revoked_at is null
  )
  with check (
    (auth.uid() = inviter_id or auth.uid() = accepted_by)
    and revoked_at is not null
  );

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Column allowlist, and the omission is the point: `invite_code_hash` has no
-- client-readable path at all. NO insert and NO delete for authenticated —
-- invite and accept run through the Edge Function with the service role, which
-- is the only way both consents can be attributed to a verified JWT.
grant select (id, inviter_id, invitee_email, expires_at,
              accepted_by, accepted_at, revoked_at, created_at)
  on public.partner_links to authenticated;
grant update (revoked_at, revoked_by) on public.partner_links to authenticated;

-- ── The partner of the current user, if an ACTIVE link exists ──────────────
-- SECURITY DEFINER so it reads partner_links regardless of future policy
-- changes; STABLE so the planner runs it once per statement (InitPlan) rather
-- than once per row; `set search_path = ''` per
-- 20260621_harden_definer_functions_and_storage.sql, hence every reference
-- below is schema-qualified.
--
-- Returns NULL when there is no active link, and `user_id = NULL` is NULL, not
-- true — every policy below therefore fails CLOSED for an unlinked user.
--
-- The ORDER BY is not decoration. The two partial unique indexes above stop a
-- user holding two active links *on the same side*, but nothing stops them
-- being the inviter of one and the acceptor of another (see the report filed
-- with this migration). A bare `limit 1` would be free to return a different
-- row per statement, which in an RLS predicate means the visible dataset could
-- flip between queries. Oldest-consent-wins, deterministically.
create or replace function public.active_partner_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when pl.inviter_id = auth.uid() then pl.accepted_by
              else pl.inviter_id end
  from public.partner_links pl
  where (pl.inviter_id = auth.uid() or pl.accepted_by = auth.uid())
    and pl.accepted_at is not null
    and pl.revoked_at is null
  order by pl.accepted_at asc, pl.id asc
  limit 1
$$;

-- New functions grant EXECUTE to PUBLIC by default, which anon and
-- authenticated inherit regardless of any grant on those roles specifically —
-- the revoke has to target PUBLIC, not just anon (20260621 §1).
revoke all on function public.active_partner_id() from public, anon;
grant execute on function public.active_partner_id() to authenticated;

-- ── Partner SELECT policies (design §2 allowlist) ──────────────────────────
-- ADDITIVE ONLY. Postgres ORs permissive policies, so every existing
-- `*_select_own` keeps working untouched, and every INSERT/UPDATE/DELETE
-- policy still demands `auth.uid() = user_id` — a partner physically cannot
-- write in Phase 1 no matter what the client does. A botched additive
-- migration can only fail to grant partner access; a botched combined-policy
-- one could weaken single-user RLS.
--
-- `(select public.active_partner_id())` — the subselect is what makes the
-- STABLE function an InitPlan evaluated once per statement, leaving each row
-- check as an equality against a constant.
--
-- Every table below was verified present with a `user_id` column in
-- src/integrations/supabase/types.ts before its policy was written. Nothing on
-- the design's allowlist was missing.
--
-- NOT on this list, and each absence is a decision recorded in design §2/§5:
-- `profiles` (carries trusted_devices, tax detail, consent state),
-- `financial_connections` / `plaid_items` (aggregator tokens),
-- `user_subscriptions`, `subscriptions`, `ai_advisor_history`,
-- `ai_usage_events`, `email_nudges`, `oauth_states`, `rate_limits`.
-- They are protected the same way `access_token` is: no policy + no grant =
-- no path, regardless of client bugs.

drop policy if exists accounts_select_partner on public.accounts;
create policy accounts_select_partner on public.accounts
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists transactions_select_partner on public.transactions;
create policy transactions_select_partner on public.transactions
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists recurring_rules_select_partner on public.recurring_rules;
create policy recurring_rules_select_partner on public.recurring_rules
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists budget_items_select_partner on public.budget_items;
create policy budget_items_select_partner on public.budget_items
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists debts_select_partner on public.debts;
create policy debts_select_partner on public.debts
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists assets_select_partner on public.assets;
create policy assets_select_partner on public.assets
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists liabilities_select_partner on public.liabilities;
create policy liabilities_select_partner on public.liabilities
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists savings_goals_select_partner on public.savings_goals;
create policy savings_goals_select_partner on public.savings_goals
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists car_funds_select_partner on public.car_funds;
create policy car_funds_select_partner on public.car_funds
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists net_worth_snapshots_select_partner on public.net_worth_snapshots;
create policy net_worth_snapshots_select_partner on public.net_worth_snapshots
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists payment_plans_select_partner on public.payment_plans;
create policy payment_plans_select_partner on public.payment_plans
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists account_reconciliations_select_partner on public.account_reconciliations;
create policy account_reconciliations_select_partner on public.account_reconciliations
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists synced_transactions_select_partner on public.synced_transactions;
create policy synced_transactions_select_partner on public.synced_transactions
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists synced_transaction_reviews_select_partner on public.synced_transaction_reviews;
create policy synced_transaction_reviews_select_partner on public.synced_transaction_reviews
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists lump_sum_transfers_select_partner on public.lump_sum_transfers;
create policy lump_sum_transfers_select_partner on public.lump_sum_transfers
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

-- The car build family. Each of the three child tables carries its own
-- `user_id` (verified in types.ts), so each is scoped directly rather than
-- through a join to car_builds — a join would make the policy depend on the
-- parent's own visibility and quietly change meaning if that ever moves.
drop policy if exists car_builds_select_partner on public.car_builds;
create policy car_builds_select_partner on public.car_builds
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists car_build_phases_select_partner on public.car_build_phases;
create policy car_build_phases_select_partner on public.car_build_phases
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists car_build_items_select_partner on public.car_build_items;
create policy car_build_items_select_partner on public.car_build_items
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

drop policy if exists car_maintenance_logs_select_partner on public.car_maintenance_logs;
create policy car_maintenance_logs_select_partner on public.car_maintenance_logs
  for select to authenticated
  using (user_id = (select public.active_partner_id()));

commit;
