-- Ranked automatic extra payments, slice (d): storage for the card block's own rank.
-- APPLIED to project mdtosrbfkextcaezuclh 2026-08-19.
--
-- One column on a table that already exists and already carries RLS + owner policies, so this
-- adds no new attack surface: an added column inherits the table's existing grants and policies
-- (the 2026-06-15 enumeration lesson applies to NEW tables, whose default `public` ACLs make them
-- world-writable the instant they exist).
--
-- `savings_goals.sort_order` and `car_funds.sort_order` (20260819_ranked_automatic_extra_payments)
-- rank the goals and the car funds against each other. Nothing ranked the CARDS, so every caller
-- was passing the hardcoded default of 0 -- cards first -- and a user had no way to say "this goal
-- matters more than my debt", which is the whole point of the feature. This is where that answer
-- lives.
--
-- Default 0 is today's behaviour exactly: cards first, ahead of every goal at rank 0 or above
-- (`computeAutoExtraReserve` seats the card block half a rank ahead of its nominal position so an
-- exact tie resolves in favour of the debt). Nobody's payoff date moves when this deploys.

alter table public.profiles
  add column if not exists cards_sort_order integer not null default 0;

comment on column public.profiles.cards_sort_order is
  'Where the credit-card block sits in the automatic-extra-payment ranking, against savings_goals.sort_order and car_funds.sort_order. Ascending; 0 = cards first, which is the pre-feature behaviour. Ranks the SURPLUS only -- it can never reorder a card minimum (see src/lib/ranked-surplus-allocation.ts).';
