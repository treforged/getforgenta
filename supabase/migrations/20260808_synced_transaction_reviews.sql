-- §1B Stage 2 — the USER'S decision about a synced transaction.
--
-- WHY A SEPARATE TABLE FROM `synced_transactions`: that table is provider facts, reconciled against
-- a Plaid cursor, and is deliberately unwritable by the user at the grant layer
-- (20260807_synced_transactions.sql:8-11) because any user edit would be silently reverted by the
-- next sync. A decision is the opposite kind of object — it is an assertion by the person, it is
-- not derived from provider data, and it must survive both a sync and a rule edit. So the facts
-- stay read-only and the decisions live here, with full owner CRUD.
--
-- WHY THIS DOES NOT CONTRADICT §1A's "never persist a match": §1A refuses to persist the MATCHER'S
-- inference, because rules are edited constantly and a stored inference would need invalidating on
-- every edit. That still holds — `matchCharge` stays derived and uncached. What is stored here is
-- the user's confirmation, which is a different and stronger claim.
--
-- ABSENCE MEANS UNREVIEWED. There is deliberately no 'unreviewed' status to write, so the table
-- only ever holds rows someone acted on. With all history in scope (Tre, 2026-08-08) the vast
-- majority of synced rows are permanently unreviewed BY DESIGN — which is why nothing anywhere may
-- read "no review row" as "this did not happen".

create table if not exists public.synced_transaction_reviews (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,

  -- One decision per synced transaction. The unique constraint is also what makes import
  -- idempotent: a row already imported cannot be imported twice.
  synced_transaction_id  uuid not null unique
                           references public.synced_transactions(id) on delete cascade,

  status                 text not null
                           check (status in ('linked_rule', 'linked_txn', 'imported', 'ignored')),

  -- SET NULL, not cascade: deleting a rule must not erase the record that this bank charge was
  -- already dealt with, or the charge silently reappears in the inbox as brand new.
  rule_id                uuid references public.recurring_rules(id) on delete set null,

  -- CASCADE, unlike rule_id, and the asymmetry is deliberate. If the user deletes the ledger row
  -- this review produced, the honest state is "not imported" — dropping the review returns the
  -- synced transaction to unreviewed so it can be imported again. Setting null instead would leave
  -- an 'imported' row pointing at nothing while the unique constraint above blocked any retry.
  transaction_id         uuid references public.transactions(id) on delete cascade,

  -- 'YYYY-MM'. WHICH occurrence of a monthly rule this charge settles; a rule recurs, a charge does
  -- not, so the link is meaningless without it.
  occurrence_month       text check (occurrence_month is null or occurrence_month ~ '^\d{4}-\d{2}$'),

  category_override      text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- A link to a rule is only interpretable with the occurrence it settles.
  constraint synced_transaction_reviews_rule_needs_month
    check (status <> 'linked_rule' or occurrence_month is not null),

  -- Both statuses that name a ledger row must actually have one. Safe to enforce as a CHECK only
  -- because transaction_id CASCADEs: an ON DELETE SET NULL would fire an UPDATE on this row, and
  -- Postgres evaluates CHECKs on UPDATE, so the user's delete would fail with a constraint
  -- violation instead of doing what they asked.
  constraint synced_transaction_reviews_txn_present
    check (status not in ('linked_txn', 'imported') or transaction_id is not null),

  -- 'ignored' means "no connection to anything" — a stale pointer here would make an ignored row
  -- look linked in any query that reads the FKs without also reading the status.
  constraint synced_transaction_reviews_ignored_is_clean
    check (status <> 'ignored' or (rule_id is null and transaction_id is null))

  -- NOT ENFORCED HERE, on purpose: "status='linked_rule' implies rule_id is not null". rule_id is
  -- ON DELETE SET NULL, so such a CHECK would make deleting a rule fail. The degraded state
  -- (linked_rule, rule_id null) is legitimate and means "handled, but the rule is gone"; the UI
  -- renders it as handled and must not assume rule_id is present. Creation-time presence is
  -- enforced in the hook and pinned by test.
);

-- The inbox's own query: one user's decisions, joined back to the transactions being listed.
create index if not exists synced_transaction_reviews_user_lookup
  on public.synced_transaction_reviews (user_id, synced_transaction_id);

-- Stage 4 reads this shape: "is there a confirmed link for this rule in this month?"
create index if not exists synced_transaction_reviews_rule_month
  on public.synced_transaction_reviews (user_id, rule_id, occurrence_month)
  where rule_id is not null;

alter table public.synced_transaction_reviews enable row level security;

-- Full owner CRUD, unlike synced_transactions: these rows ARE the user's.
drop policy if exists synced_transaction_reviews_select_own on public.synced_transaction_reviews;
create policy synced_transaction_reviews_select_own
  on public.synced_transaction_reviews for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists synced_transaction_reviews_insert_own on public.synced_transaction_reviews;
create policy synced_transaction_reviews_insert_own
  on public.synced_transaction_reviews for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists synced_transaction_reviews_update_own on public.synced_transaction_reviews;
create policy synced_transaction_reviews_update_own
  on public.synced_transaction_reviews for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists synced_transaction_reviews_delete_own on public.synced_transaction_reviews;
create policy synced_transaction_reviews_delete_own
  on public.synced_transaction_reviews for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.synced_transaction_reviews to authenticated;
