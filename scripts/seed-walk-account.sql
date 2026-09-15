-- seed-walk-account.sql -- clone the reviewer's Decision Deck fixture onto a
-- THROWAWAY test account, so the per-row link undo and the batch panel can be
-- pressed in a real browser without anybody signing in as Tre.
--
-- WHY THIS EXISTS
-- `seed-reviewer-deck.sql` built the fixture, and it is correct, but it lives on
-- `reviewer@treforged.com` -- an account only Tre can sign into. So the walk that
-- fixture was built for has never happened, and ask 5d6dbada has been blocked on a
-- human sign-in for days. Pressing undo in a Chrome signed into Tre's own account
-- writes to his real ledger; that incident already happened once. This file removes
-- the fork by creating a third option that is neither his ledger nor the demo
-- surface (demo mutations `throw new Error('Demo mode')` by construction).
--
-- THE GUARD, AND WHY IT IS STRONGER THAN THE ONE IT GENERALISES
-- `seed-reviewer-deck.sql` resolves one hardcoded address so a wrong uuid cannot be
-- pasted. Parameterising that would have widened the blast radius to any user. So
-- the target here is resolved by email AND filtered on `like '%@forgenta.test'`.
-- `.test` is an IANA-reserved TLD that can never be a real mailbox, so this file
-- CANNOT write to a real person's ledger even if the address is wrong. If the filter
-- matches nothing, every insert writes zero rows -- it does not fall through to
-- somebody.
--
-- NO HAND-NAMED COLUMN LISTS. `accounts` alone has 39 columns, and a list typed by
-- hand silently drops whatever was added after it was typed -- the same defect shape
-- as a hand-named dependency inventory. Every clone below goes through
-- `jsonb_populate_record(null::<table>, to_jsonb(src) || overrides)`, so the column
-- set is DERIVED from the table and a new column comes along automatically.
--
-- IDS ARE DERIVED, NOT RANDOM: `md5(source_id || 'walk')::uuid`. That makes the
-- teardown exact rather than heuristic, and makes a re-run idempotent.
--
-- WHAT IS DELIBERATELY NOT COPIED
--   * `connection_id`, `plaid_account_id`, `plaid_item_id` on cloned accounts are
--     NULLED. A cloned plaid id would point at a connection this file does not own,
--     and a sync job must never find a live-looking handle on a throwaway account.
--   * The cloned `financial_connections` row keeps `connection_status = 'revoked'`
--     from the source, which is the one value `plaid-sync-all` excludes.
--
-- RUN:  the SEED section. UNDO: the TEARDOWN at the bottom.

-- =============================== SEED ===============================
begin;

create temporary view walk_target as
  select id from auth.users
   where email = 'deck-walk@forgenta.test' and email like '%@forgenta.test';

create temporary view walk_source as
  select id from auth.users where email = 'reviewer@treforged.com';

-- 1. the fixture's connection (FK target for the charges; carries no token)
insert into financial_connections
select (jsonb_populate_record(null::financial_connections,
         to_jsonb(f) || jsonb_build_object(
           'id',      md5(f.id::text || 'walk'),
           'user_id', (select id from walk_target)))).*
from financial_connections f
where f.user_id = (select id from walk_source)
  and f.id = '5eed0000-0000-4000-8000-00000000c0de'
  and (select count(*) from walk_target) = 1
on conflict (id) do nothing;

-- 2. accounts -- every column derived; the three provider handles nulled
insert into accounts
select (jsonb_populate_record(null::accounts,
         to_jsonb(a) || jsonb_build_object(
           'id',                md5(a.id::text || 'walk'),
           'user_id',           (select id from walk_target),
           'connection_id',     null,
           'plaid_account_id',  null,
           'plaid_item_id',     null))).*
from accounts a
where a.user_id = (select id from walk_source)
  and (select count(*) from walk_target) = 1
on conflict (id) do nothing;

-- 3. recurring rules -- the deck's link targets, including 'Utilities'
insert into recurring_rules
select (jsonb_populate_record(null::recurring_rules,
         to_jsonb(r) || jsonb_build_object(
           'id',      md5(r.id::text || 'walk'),
           'user_id', (select id from walk_target)))).*
from recurring_rules r
where r.user_id = (select id from walk_source)
  and (select count(*) from walk_target) = 1
on conflict (id) do nothing;

-- 4. the seeded charges, with account_id and connection_id remapped to the clones
insert into synced_transactions
select (jsonb_populate_record(null::synced_transactions,
         to_jsonb(t) || jsonb_build_object(
           'id',            md5(t.id::text || 'walk'),
           'user_id',       (select id from walk_target),
           'connection_id', md5(t.connection_id::text || 'walk'),
           'account_id',    md5(t.account_id::text || 'walk'),
           'provider_transaction_id', t.provider_transaction_id || '-WALK'))).*
from synced_transactions t
where t.user_id = (select id from walk_source)
  and t.connection_id = '5eed0000-0000-4000-8000-00000000c0de'
  and (select count(*) from walk_target) = 1
on conflict (id) do nothing;

-- 5. the accepted link history merchant-link-memory reads
insert into synced_transaction_reviews
select (jsonb_populate_record(null::synced_transaction_reviews,
         to_jsonb(v) || jsonb_build_object(
           'id',                   md5(v.id::text || 'walk'),
           'user_id',              (select id from walk_target),
           'synced_transaction_id',md5(v.synced_transaction_id::text || 'walk'),
           'rule_id', case when v.rule_id is null then null
                           else md5(v.rule_id::text || 'walk') end))).*
from synced_transaction_reviews v
join synced_transactions t on t.id = v.synced_transaction_id
where v.user_id = (select id from walk_source)
  and t.connection_id = '5eed0000-0000-4000-8000-00000000c0de'
  and (select count(*) from walk_target) = 1
on conflict (id) do nothing;

commit;

-- ============================ TEARDOWN ============================
-- Exact, not heuristic: every id is derived from the source id the same way.
-- Deleting the auth user would also do it (all 11 tables now cascade), but this
-- leaves the account signed-in-able for the next walk.
--
-- begin;
-- delete from synced_transaction_reviews where user_id = (select id from auth.users where email='deck-walk@forgenta.test');
-- delete from synced_transactions        where user_id = (select id from auth.users where email='deck-walk@forgenta.test');
-- delete from recurring_rules            where user_id = (select id from auth.users where email='deck-walk@forgenta.test');
-- delete from accounts                   where user_id = (select id from auth.users where email='deck-walk@forgenta.test');
-- delete from financial_connections      where user_id = (select id from auth.users where email='deck-walk@forgenta.test');
-- commit;
