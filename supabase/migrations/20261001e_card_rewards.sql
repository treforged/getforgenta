-- Rewards rates and a welcome offer on each credit card, for "which card for this purchase?"
-- (ask 1f3217bb, plan docs/plans/2026-10-01_card-for-purchase-advisor.md).
-- ============================================================================
-- WHY USER-ENTERED. Plaid does not supply rewards rates, and a built-in catalogue goes stale and
-- would put a wrong rate in front of a user as fact. So the user types their own; with none
-- entered the advisor ranks on interest and utilization alone and never invents a rate.
--
-- SHAPES (validated in the client, src/lib/card-for-purchase.ts; both columns nullable):
--   card_rewards  {"base_pct": 2, "categories": {"groceries": 4, "dining": 3}}   percents
--   welcome_offer {"required_spend": 4000, "spent": 1200, "bonus_value": 750, "deadline": "2027-09-01"}
--
-- ACCESS. Additive, nullable columns on public.accounts, which already carries table-level grants
-- and owner-only RLS, so nobody can read or write another user's rates. Nothing is backfilled.
-- UNDO: alter table public.accounts drop column card_rewards, drop column welcome_offer;

begin;

alter table public.accounts
  add column if not exists card_rewards jsonb,
  add column if not exists welcome_offer jsonb;

alter table public.accounts
  add constraint accounts_card_rewards_is_object
    check (card_rewards is null or jsonb_typeof(card_rewards) = 'object'),
  add constraint accounts_welcome_offer_is_object
    check (welcome_offer is null or jsonb_typeof(welcome_offer) = 'object');

commit;
