-- §1B SPLIT LINK — one bank charge may settle SEVERAL obligations.
--
-- WHY. Tre, 2026-08-09 (authorising it in 126b): "for split links i think yes since it can integrate
-- the variable items into cost… forecast can get a better month 0 picture." His rent debit is one
-- charge that pays Rent, Internet and Smart Home for THIS month plus the Water/Sewer/Trash rider for
-- the PREVIOUS one, billed in arrears. Under one-row-per-charge the rider is invisible inside the
-- bundle, so month 0 is wrong by exactly the amount nobody can see.
--
-- WHY N ROWS AND NOT A CHILD TABLE. The month must be PER-LINK — that arrears rider settles a
-- different `occurrence_month` from the rest of the same debit. Every review row already carries its
-- own `occurrence_month`/`occurrence_date`, so multi-row gets that for free; a child table would
-- have to duplicate both columns and leave the parent's meaningless. It also keeps the read side
-- unchanged: `buildConfirmedOccurrences` already iterates reviews and keys per rule.
--
-- ⚠️ THE ORDERING WAS NOT A PREFERENCE. `UNIQUE (synced_transaction_id)` was doing THREE jobs, and
-- the second is why this file could not land first:
--   1. import idempotency — "a row already imported cannot be imported twice" (20260808:24). It is
--      preserved exactly, by the first index below.
--   2. the `ON CONFLICT` arbiter for three write paths in `useSupabaseData.ts`. Dropping the
--      constraint under the old code would have failed every one of them immediately with "no unique
--      or exclusion constraint matching the ON CONFLICT specification" — and a partial unique index
--      does NOT rescue them, because Postgres can only infer a partial index when the statement
--      repeats its predicate, and supabase-js `onConflict` takes a bare column list with no WHERE.
--      Slice B (`43d807be`) removed all three, replacing them with SELECT-then-UPDATE-or-INSERT.
--   3. "one decision per charge" in the UI — the only job split link actually relaxes.
--
-- BACKED UP FIRST. Free tier means no PITR (see the 2026-08-07 precedent), so the whole table was
-- snapshotted to `backup.synced_transaction_reviews_20260810` — verified identical in both
-- directions with EXCEPT ALL, and with zero `anon`/`authenticated` grants — before this ran.

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_synced_transaction_id_key;

-- JOB 1, PRESERVED EXACTLY: at most one EXCLUSIVE decision per charge.
--
-- The exclusive row is the charge's decision about ITSELF rather than about one of the things it
-- paid: imported (idempotency), ignored (dismissal), linked_txn (a ledger pointer), categorized (a
-- label correction) — and, by Tre's 2026-08-09 decision, `category_override`, which lives on this
-- row and nowhere else. A category describes the CHARGE, not one of the several things it settled: a
-- rent debit split across Rent and Water has one merchant and one label, not two.
--
-- ⚠️ THIS PREDICATE IS `LINK_STATUSES` IN src/lib/synced-transaction-review.ts. They are ONE RULE
-- WRITTEN TWICE. If a status is added to that Set it must be added here in the same change, or the
-- app and the database disagree about how many decisions a charge may hold — the app would offer a
-- second link the database then rejects with a constraint name the user cannot act on.
create unique index if not exists synced_transaction_reviews_one_exclusive
  on public.synced_transaction_reviews (synced_transaction_id)
  where status not in ('linked_rule', 'linked_plan', 'linked_car');

-- JOB 3, RELAXED — but only as far as "the same thing cannot be linked twice".
--
-- Each link row occupies a slot in EXACTLY ONE of the three indexes below, which is what makes
-- `validateReviewInput`'s "one row names one thing" rule load-bearing rather than merely tidy: a row
-- carrying two ids would occupy two slots and "linked twice" would stop being detectable.
--
-- The month is deliberately NOT part of any key. One charge settling two occurrences of the SAME
-- rule is a claim nothing downstream can read — `buildConfirmedOccurrences` keys on `rule_id` alone,
-- so it would suppress both with no way for the user to say which is which. Two DIFFERENT rules in
-- two different months is the arrears case, and that is permitted.
create unique index if not exists synced_transaction_reviews_one_rule_link
  on public.synced_transaction_reviews (synced_transaction_id, rule_id)
  where rule_id is not null;

create unique index if not exists synced_transaction_reviews_one_plan_link
  on public.synced_transaction_reviews (synced_transaction_id, payment_plan_id)
  where payment_plan_id is not null;

-- The vehicle key includes `car_charge_kind` because one car fund bills a loan payment AND an
-- insurance premium every month, usually from the same account, and the engines gate them
-- independently. Both on one charge is legitimate; the same one twice is not.
create unique index if not exists synced_transaction_reviews_one_car_link
  on public.synced_transaction_reviews (synced_transaction_id, car_fund_id, car_charge_kind)
  where car_fund_id is not null;
