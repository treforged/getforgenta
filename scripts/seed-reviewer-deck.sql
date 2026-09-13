-- seed-reviewer-deck.sql — give the REVIEWER account enough bank history for the
-- Decision Deck, so auto-apply and the durable undo banners can be walked in a browser.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
-- Auto-apply, the durable undo banners and the per-row link undo shipped 2026-09-13
-- verified in jsdom ONLY. They cannot be exercised on the demo surface, because demo
-- mutations `throw new Error('Demo mode')` by construction, and they must never be
-- exercised against Tre's real ledger — that is a write he is not watching, on real
-- money. The reviewer account is the third option, and it had **0 synced_transactions**,
-- so the deck had nothing to decide. This seeds that gap and nothing else.
--
-- ── THE THREE SAFETY PROPERTIES, AND HOW EACH IS ENFORCED ───────────────────────
-- 1. REVIEWER ONLY. No user id is ever written as a literal. Every statement resolves
--    the id through `(select id from auth.users where email = 'reviewer@treforged.com')`,
--    so a copy-paste of the wrong uuid is not a failure mode that exists here. If that
--    address matches no row, every insert writes ZERO rows rather than writing to
--    somebody — a null user_id violates NOT NULL and the statement errors.
-- 2. NO CREDENTIAL. The seeded `financial_connections` row carries **no access_token
--    and no refresh token**. It is not a bank connection; it is a foreign key target,
--    because `synced_transactions.connection_id` is NOT NULL.
-- 3. NO SYNC JOB WILL TOUCH IT. `connection_status = 'revoked'` is deliberate and is
--    the one value `plaid-sync-all` excludes (`.neq("connection_status","revoked")`,
--    index.ts:57). An 'active' row with no token would be picked up by the nightly
--    sync and fail against Tre's own infrastructure. The CHECK constraint on that
--    column allows exactly active | reauth_required | revoked | error.
--
-- ── WHY SIX HISTORICAL CHARGES AND NOT THREE ────────────────────────────────────
-- `MIN_LINKS_TO_AUTO_APPLY` is 3, but `MIN_HISTORY_FOR_OUTLIER` is 5 — and since
-- 2026-09-13 an ABSTAINING outlier gate must not produce `auto`: `linkMemoryVerdict`
-- returns `ask` / `insufficient-amount-history` below that floor. Three links would
-- therefore reproduce the "still asks" state and prove nothing about auto-apply. Six
-- clears both thresholds with room, so a walk that still sees a prompt has found a
-- real defect rather than a thin fixture.
--
-- Amounts cluster tightly around the £/$200 Utilities rule (CV ~1.7%), so the charge
-- offered for auto-apply sits far inside `UNUSUAL_SD` 2.5 and far above
-- `LINK_MEMORY_MIN_AMOUNT_RATIO` 0.05. A variable utility is deliberate: it is one of
-- the two cases Tre named as still prompting.
--
-- ── RUN / UNDO ──────────────────────────────────────────────────────────────────
--   seed:   run the SEED section below
--   undo:   run the TEARDOWN section at the bottom — it removes exactly what this
--           wrote, by the same fixed ids, and nothing else.
-- Fixed uuids (the `5eed…` prefix) make the teardown exact instead of heuristic.

-- ═══════════════════════════ SEED ═══════════════════════════

begin;

-- A foreign-key target. NOT a bank connection: no token of any kind.
insert into financial_connections
  (id, user_id, provider, provider_item_id, institution_name, connection_status, access_token)
select
  '5eed0000-0000-4000-8000-00000000c0de',
  u.id,
  'plaid',
  'REVIEWER-SEED-NOT-A-REAL-ITEM',
  'Seeded Utility (reviewer test data)',
  'revoked',      -- see safety property 3
  null            -- see safety property 2
from auth.users u
where u.email = 'reviewer@treforged.com'
on conflict (id) do nothing;

-- Six settled charges from one merchant, monthly, tightly clustered around $200.
insert into synced_transactions
  (id, user_id, connection_id, account_id, provider_transaction_id, amount, date, pending, name, merchant_name, category)
select v.id, u.id, '5eed0000-0000-4000-8000-00000000c0de',
       'de100008-0000-0000-0000-000000000008',   -- reviewer's active Discover It
       v.ptid, v.amount, v.dt, false, 'CITY POWER & LIGHT', 'City Power & Light', 'Utilities'
from auth.users u
cross join (values
  ('5eed0000-0000-4000-8000-000000000001'::uuid, 'REVIEWER-SEED-TXN-1', 195.40, date '2026-03-10'),
  ('5eed0000-0000-4000-8000-000000000002'::uuid, 'REVIEWER-SEED-TXN-2', 202.15, date '2026-04-10'),
  ('5eed0000-0000-4000-8000-000000000003'::uuid, 'REVIEWER-SEED-TXN-3', 198.80, date '2026-05-10'),
  ('5eed0000-0000-4000-8000-000000000004'::uuid, 'REVIEWER-SEED-TXN-4', 205.60, date '2026-06-10'),
  ('5eed0000-0000-4000-8000-000000000005'::uuid, 'REVIEWER-SEED-TXN-5', 199.25, date '2026-07-10'),
  ('5eed0000-0000-4000-8000-000000000006'::uuid, 'REVIEWER-SEED-TXN-6', 203.10, date '2026-08-10')
) as v(id, ptid, amount, dt)
where u.email = 'reviewer@treforged.com'
on conflict (id) do nothing;

-- Each of those six is an ACCEPTED link to the Utilities rule. This is the history
-- merchant-link-memory reads; without it the six charges are just noise.
insert into synced_transaction_reviews
  (id, user_id, synced_transaction_id, status, rule_id, occurrence_month)
select
  ('5eed0000-0000-4000-8000-0000000001' || lpad((row_number() over (order by t.date))::text, 2, '0'))::uuid,
  u.id, t.id, 'linked_rule',
  (select r.id from recurring_rules r
    where r.user_id = u.id and r.name = 'Utilities' limit 1),
  to_char(t.date, 'YYYY-MM')
from auth.users u
join synced_transactions t
  on t.user_id = u.id
 and t.connection_id = '5eed0000-0000-4000-8000-00000000c0de'
 and t.date < date '2026-09-01'
where u.email = 'reviewer@treforged.com'
on conflict (id) do nothing;

-- THE ONE THE DECK MUST DECIDE. Same merchant, in band, and deliberately carrying
-- NO review row — this is the charge auto-apply should take without asking.
insert into synced_transactions
  (id, user_id, connection_id, account_id, provider_transaction_id, amount, date, pending, name, merchant_name, category)
select '5eed0000-0000-4000-8000-00000000000f', u.id,
       '5eed0000-0000-4000-8000-00000000c0de',
       'de100008-0000-0000-0000-000000000008',
       'REVIEWER-SEED-TXN-NEW', 201.75, date '2026-09-10', false,
       'CITY POWER & LIGHT', 'City Power & Light', 'Utilities'
from auth.users u
where u.email = 'reviewer@treforged.com'
on conflict (id) do nothing;

commit;

-- ═══════════════════════ TEARDOWN (run to undo) ═══════════════════════
-- Exact, not heuristic: it deletes the fixed ids this file wrote and nothing else.
-- Reviews first — they carry the FK onto the charges.
--
-- begin;
-- delete from synced_transaction_reviews
--  where synced_transaction_id in (
--    select id from synced_transactions
--     where connection_id = '5eed0000-0000-4000-8000-00000000c0de');
-- delete from applied_actions
--  where user_id = (select id from auth.users where email = 'reviewer@treforged.com');
-- delete from synced_transactions
--  where connection_id = '5eed0000-0000-4000-8000-00000000c0de';
-- delete from financial_connections
--  where id = '5eed0000-0000-4000-8000-00000000c0de';
-- commit;
