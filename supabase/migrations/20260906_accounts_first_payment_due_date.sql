-- A new card's FIRST payment due date, which is not its steady due day.
-- ============================================================================
-- THE ASK (Tre, 2026-09-05): "maybe make it a feature for cards to set there
-- first due date." His Robinhood Gold opened in September and its first payment
-- is due 10 October; from November onward it is the 10th of every month.
--
-- WHAT WAS WRONG. `accounts.payment_due_day` is a DAY OF MONTH, and a day of
-- month describes a steady state. Month one is not a steady state: the first
-- statement closes late, so the first payment can land a month after the card
-- opened, or on a different day of the month, or both. With only a day of month
-- to read, the forecast places the first payment in whichever of month 0 or
-- month 1 that bare day falls into -- which for a card opened on the 5th with a
-- first payment on the 10th of NEXT month is the wrong month entirely.
--
-- WHY THIS IS NOT `card_start_date`. That column already exists and answers a
-- different question: when the card OPENS. A card can be open and owe nothing
-- yet. Overloading it would make a card that exists disappear from utilization.
--
-- NULL ON EVERY EXISTING ROW, AND THAT IS THE WHOLE SAFETY STORY. Null means
-- "use payment_due_day exactly as before". Not one account in this database
-- changes a forecast number as a result of this migration.
--
-- WHY IT MAY NOT PRECEDE card_start_date. A first payment due before the card
-- exists is not a schedule, it is a typo, and it would reach the projection as a
-- month offset the simulation cannot honour. The database refuses to hold it.
--
-- REVERSING THIS: `alter table public.accounts drop column first_payment_due_date;`
-- -- additive and nullable, so dropping it restores the previous behaviour
-- exactly, with no data to migrate back.

begin;

alter table public.accounts
  add column if not exists first_payment_due_date date;

alter table public.accounts
  drop constraint if exists accounts_first_payment_due_after_start;
alter table public.accounts
  add constraint accounts_first_payment_due_after_start
  check (
    first_payment_due_date is null
    or card_start_date is null
    or first_payment_due_date >= card_start_date
  );

comment on column public.accounts.first_payment_due_date is
  'The FIRST payment due date on a newly opened card, when it differs from the steady payment_due_day. NULL = use payment_due_day for every month, unchanged. Once its month has passed the value is inert.';

commit;
