-- §1B Stage 4C — a sixth status: 'linked_plan'. A bank charge can name the PAYMENT PLAN it paid.
--
-- WHY. Tre, 2026-08-09: "also allow items to be linked to payment plans." The two existing link
-- targets are a recurring rule and a ledger entry, but a large class of real charges is neither: a
-- BNPL / Plan-It instalment is projected from `payment_plans`, not from `recurring_rules`, so today
-- the only honest thing a user can do with one is ignore it.
--
-- ⚠️ THIS MIGRATION MOVES NO MONEY, and neither does the code shipping with it. A `'linked_plan'`
-- review is an ANNOTATION, exactly as `'linked_rule'` was when it landed in Stage 2. Retiring the
-- plan's month-0 cash outflow (the `getMonthlyPlanCashExpenses` suppression) is the number-moving
-- half and ships separately, because it errs in the UNSAFE direction — dropping an obligation raises
-- projected available cash — and every §1B stage that moves a number gets live-verified alone.
--
-- ⚠️ NO "status='linked_plan' implies payment_plan_id is not null" CHECK. Same trap the whole table
-- is built around: `payment_plan_id` is ON DELETE SET NULL, SET NULL fires an UPDATE on this row,
-- and Postgres evaluates CHECKs on UPDATE — so such a constraint would make DELETING A PAYMENT PLAN
-- fail with a constraint violation instead of doing what the user asked. The degraded state
-- (`linked_plan`, `payment_plan_id` null) is legitimate and means "handled, but the plan is gone".
-- Creation-time presence is enforced in `validateReviewInput` and pinned by test, exactly like
-- `rule_id`. Mirror `rule_id` here, never `transaction_id` (which CASCADEs and therefore can carry
-- its CHECK).

alter table public.synced_transaction_reviews
  add column if not exists payment_plan_id uuid references public.payment_plans(id) on delete set null;

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_status_check;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_status_check
  check (status in ('linked_rule', 'linked_txn', 'imported', 'ignored', 'categorized', 'linked_plan'));

-- A PLAN RECURS TOO, so a plan link is as meaningless without its occurrence as a rule link is: an
-- instalment plan bills every month and the charge settles exactly one of those months. The old
-- `..._rule_needs_month` constraint is replaced by one covering both link types rather than a
-- sibling, so there is a single place to read what "a link needs a month" means.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_rule_needs_month;

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_link_needs_month;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_link_needs_month
  check (status not in ('linked_rule', 'linked_plan') or occurrence_month is not null);

-- Same cleanliness rule as before, now covering the new pointer: a status that asserts no connection
-- must not keep one, or any query reading the FKs without the status sees an ignored row as linked.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_ignored_is_clean;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_ignored_is_clean
  check (
    status not in ('ignored', 'categorized')
    or (rule_id is null and transaction_id is null and payment_plan_id is null)
  );

-- The shape the (separate) number-moving half will read: "is there a confirmed link for this plan in
-- this month?" — mirroring `synced_transaction_reviews_rule_month`.
create index if not exists synced_transaction_reviews_plan_month
  on public.synced_transaction_reviews (user_id, payment_plan_id, occurrence_month)
  where payment_plan_id is not null;
