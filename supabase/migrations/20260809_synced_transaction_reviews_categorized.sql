-- §1B Stage 2 follow-up — a fifth status: 'categorized'.
--
-- WHY THIS EXISTS. Tre's ask includes "users should be able to categorize if the auto cat is
-- wrong", and the auto-category is wrong often BY CONSTRUCTION: `GENERAL_MERCHANDISE` is 32% of the
-- rows and means no more than "a store" (see src/lib/plaid-category-map.ts). But the original four
-- statuses all assert something the user may not want to assert:
--
--   linked_rule / linked_txn / imported → "this charge is handled"
--   ignored                             → "I have dismissed this"
--
-- Correcting a label is none of those. Without a fifth value the UI would have to force a decision
-- out of someone who only wanted to fix a word, and forcing a decision to change a label is exactly
-- the "queue demanding decisions" this feature was designed not to be.
--
-- WHAT IT DOES NOT MEAN. 'categorized' asserts NOTHING about whether the charge was handled, and
-- nothing may read it as handled. It carries no FKs, for the same reason 'ignored' carries none: a
-- stale pointer would make the row look linked to any query that reads the FKs without the status.
--
-- Absence of a row still means unreviewed. This adds a value; it changes no existing row (the table
-- is empty of anything but Stage 2 writes and no 'categorized' row can predate this migration).

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_status_check;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_status_check
  check (status in ('linked_rule', 'linked_txn', 'imported', 'ignored', 'categorized'));

-- Same cleanliness rule as 'ignored', and for the same reason.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_ignored_is_clean;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_ignored_is_clean
  check (status not in ('ignored', 'categorized') or (rule_id is null and transaction_id is null));
