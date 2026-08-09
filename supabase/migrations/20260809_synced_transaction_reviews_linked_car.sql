-- §1B Stage 4B — a seventh status: 'linked_car'. A bank charge can name the VEHICLE CHARGE it paid.
--
-- WHY. Tre, 2026-08-09 (N3, named twice): "allow users to link a loan account to an active loan…
-- link to car insurance and car payment." A car fund's obligations are projected from `car_funds`,
-- never from `recurring_rules` and never from `payment_plans`, so before this the only honest thing
-- a user could do with a car-loan or car-insurance charge was ignore it.
--
-- ⚠️ TWO CHARGES, ONE FUND — which is why `car_charge_kind` exists and `car_fund_id` alone is not
-- enough. Every `phase='loan'` car fund bills a loan payment AND a monthly insurance premium, from
-- (usually) the same account in the same month, and BOTH are gated independently — the loan payment
-- at `forecast-engine.ts:307` / `useCardProjection.ts:587`, the insurance at `forecast-engine.ts:356`
-- / `useCardProjection.ts:1338`. A link that named only the fund could not tell the number-moving
-- half which of the two obligations the user just declared settled, and the only way to guess would
-- be to compare amounts — the exact heuristic §1A demoted everywhere else. Tre's own phrasing names
-- them as two things, so the picker offers two destinations and the row records which.
--
-- ⚠️ THIS MIGRATION MOVES NO MONEY, and neither does the code shipping with it. A `'linked_car'`
-- review is an ANNOTATION, exactly as `'linked_rule'` was in Stage 2 and `'linked_plan'` in 4C.
-- Feeding `matched: true` into the two `carChargeEvidence` gates is the number-moving half and ships
-- separately, because it errs in the UNSAFE direction — dropping an obligation raises projected
-- available cash — and every §1B stage that moves a number gets live-verified alone.
--
-- ⚠️ NO "status='linked_car' implies car_fund_id is not null" CHECK. Same trap the whole table is
-- built around: `car_fund_id` is ON DELETE SET NULL, SET NULL fires an UPDATE on this row, and
-- Postgres evaluates CHECKs on UPDATE — so such a constraint would make DELETING A VEHICLE fail with
-- a constraint violation instead of doing what the user asked. The degraded state (`linked_car`,
-- `car_fund_id` null) is legitimate and means "handled, but the vehicle is gone". Creation-time
-- presence is enforced in `validateReviewInput` and pinned by test, exactly like `rule_id` and
-- `payment_plan_id`. Mirror those, never `transaction_id` (which CASCADEs and can carry its CHECK).

alter table public.synced_transaction_reviews
  add column if not exists car_fund_id uuid references public.car_funds(id) on delete set null;

-- WHICH of the fund's two monthly obligations this charge settled. Nullable for the same
-- ON DELETE SET NULL reason above is NOT the argument here — this column is never nulled by a
-- cascade — but it stays nullable because every pre-existing row has no vehicle link at all.
-- The value space is closed and small, so it is a CHECK rather than a lookup table: adding a third
-- vehicle obligation would be an engine change, not a data entry.
alter table public.synced_transaction_reviews
  add column if not exists car_charge_kind text;

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_car_charge_kind_check;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_car_charge_kind_check
  check (car_charge_kind is null or car_charge_kind in ('loan_payment', 'insurance'));

alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_status_check;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_status_check
  check (status in ('linked_rule', 'linked_txn', 'imported', 'ignored', 'categorized', 'linked_plan', 'linked_car'));

-- A VEHICLE CHARGE RECURS TOO — a loan payment and an insurance premium both bill every month — so a
-- car link is as meaningless without its occurrence as a rule or plan link is. Extends the existing
-- combined constraint rather than adding a sibling, keeping one place to read what "a link needs a
-- month" means.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_link_needs_month;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_link_needs_month
  check (status not in ('linked_rule', 'linked_plan', 'linked_car') or occurrence_month is not null);

-- Same cleanliness rule as before, now covering the new pointer AND its kind: a status that asserts
-- no connection must not keep one, or any query reading the FKs without the status sees an ignored
-- row as linked. `car_charge_kind` is included because a kind without a fund is a claim about a
-- vehicle obligation with no vehicle.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_ignored_is_clean;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_ignored_is_clean
  check (
    status not in ('ignored', 'categorized')
    or (
      rule_id is null and transaction_id is null and payment_plan_id is null
      and car_fund_id is null and car_charge_kind is null
    )
  );

-- The shape the (separate) number-moving half will read: "is there a confirmed link for THIS fund's
-- THIS obligation in this month?" — mirroring `synced_transaction_reviews_rule_month` and
-- `..._plan_month`, with the kind in the key because the two charges are gated independently.
create index if not exists synced_transaction_reviews_car_month
  on public.synced_transaction_reviews (user_id, car_fund_id, car_charge_kind, occurrence_month)
  where car_fund_id is not null;
