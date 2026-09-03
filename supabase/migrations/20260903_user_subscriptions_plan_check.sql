-- Make `plan = 'active'` unrepresentable.
-- ============================================================================
-- WHAT WENT WRONG. One row of eleven in `user_subscriptions` carries
-- plan='active' — a STATUS in the PLAN column. Found 2026-09-03.
--
-- It is not a reporting nuisance. `SubscriptionContext.tsx` resolves entitlement
-- as:
--
--     plan === 'premium' && status in ('active','trialing')
--
-- so that row reads as NOT premium. The account was created 2026-05-17 with
-- current_period_end 2027-05-16 — a granted year — and has had FREE-TIER access
-- ever since. Roughly three and a half months of someone not getting what the
-- record says they are owed, and nothing anywhere reported it, because a row
-- that fails an equality check is silent.
--
-- WHERE IT CAME FROM. Not from code, as far as can be established: every write
-- of `plan` in the repo is a literal 'premium' or 'free' (stripe-webhook ×4,
-- revenuecat-webhook ×5); `create-checkout` and `grant-promo-premium` write only
-- user_id + stripe_customer_id; `manage-subscription` writes subscription_status,
-- the correct column. `git log -S` finds no commit that ever assigned a status
-- variable into `plan`. The row has stripe_subscription_id NULL and was last
-- touched an hour after it was created, which reads like a hand-made comp record
-- rather than anything a webhook produced.
--
-- "As far as can be established" is doing real work in that paragraph: absence of
-- a writer in today's code is not proof none existed. Which is the argument FOR
-- this constraint rather than against it — a defect whose origin cannot be
-- pinned is exactly the one worth making impossible instead of merely fixing.
--
-- APPLIED 2026-09-03 19:26 UTC, after the row was corrected. Tre authorised the
-- correction; Sam relayed it.
--
-- ⚠️ THIS MIGRATION WILL FAIL WHILE A BAD ROW EXISTS, ON PURPOSE. Postgres
-- validates a CHECK against existing rows, so applying it is blocked until
-- somebody decides what that account's plan should actually be. That decision is
-- Tre's — writing 'premium' would restore a year of access to a real person, and
-- guessing at a customer's entitlement is not a migration's job. Fix the row,
-- then apply this so it cannot recur.

begin;

alter table public.user_subscriptions
  add constraint user_subscriptions_plan_check
  check (plan in ('free', 'premium'));

comment on constraint user_subscriptions_plan_check on public.user_subscriptions is
  'plan is a PLAN, never a status. A row with plan=''active'' silently fails the entitlement check in SubscriptionContext (plan === ''premium''), so the user loses access with nothing reporting it.';

commit;
