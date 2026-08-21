-- Ranked allocation, part 2: cards that can be ranked apart, and ranks that can be SPLIT.
--
-- Tre, 2026-08-21: "chase card first. move fund split with discover. the savings split with extra
-- car payments." Neither half of that sentence could be stored before this migration.
--
--   * The cards were ONE row in the ranked list, seated at `profiles.cards_sort_order`, and every
--     card target was placed at `cardsSortOrder + i/(n+1)` so the block stayed contiguous. There
--     was therefore no rank a goal could occupy that put it BETWEEN two cards.
--   * `sort_order` was a strict sequence. Two targets dividing one rank had nowhere to record the
--     division.
--
-- Four nullable columns on four tables that already exist and already carry RLS + owner policies,
-- so this adds no new attack surface: an added column inherits the table's grants and policies.
-- (The 2026-06-15 enumeration lesson is about NEW tables, whose default `public` ACLs make them
-- world-writable the instant they exist.)
--
-- NULLABLE, not `not null default`, and that is the whole safety story. NULL means "this row has
-- said nothing", which is what every existing row means today, and the client code reads NULL as
-- exactly the pre-feature behaviour: a card with no `surplus_sort_order` stays inside the block,
-- and a rank where nothing declares a `surplus_share` fills strictly in sequence. So no backfill
-- is needed and no user's allocation moves when this deploys.

-- ── Cards ranked individually ────────────────────────────────────────────────
-- NULL  = this card stays in the block, at `profiles.cards_sort_order` (today's behaviour).
-- 0,1,2 = this card has been pulled out and sits at that rank in its own right.
alter table public.accounts
  add column if not exists surplus_sort_order integer;

comment on column public.accounts.surplus_sort_order is
  'Rank of THIS card in "Where the extra money goes", when the user has pulled it out of the credit-card block. NULL (the default and every pre-2026-08-21 row) means it stays in the block at profiles.cards_sort_order. Distinct from accounts.sort_order, which is the Balances display order and is read by no engine.';

-- ── Split shares ─────────────────────────────────────────────────────────────
-- A weight, not a percentage that must total 100: only the RATIO between the rows sharing a rank
-- is read, so 50/50, 70/30 and 7/3 all mean what they look like and no invariant can be violated
-- by a pair that does not add up.
alter table public.accounts       add column if not exists surplus_share numeric;
alter table public.savings_goals  add column if not exists surplus_share numeric;
alter table public.car_funds      add column if not exists surplus_share numeric;
alter table public.profiles       add column if not exists cards_surplus_share numeric;

comment on column public.accounts.surplus_share is
  'Weight for a SPLIT rank in "Where the extra money goes". Only the ratio between rows sharing one rank is read. NULL means this row wants no split, and a rank where nothing declares a share fills strictly in sequence exactly as it did before splits existed.';
comment on column public.savings_goals.surplus_share is
  'Weight for a SPLIT rank in "Where the extra money goes". See accounts.surplus_share.';
comment on column public.car_funds.surplus_share is
  'Weight for a SPLIT rank in "Where the extra money goes". See accounts.surplus_share. On a row in its LOAN phase this weights extra principal on the vehicle loan, not a down-payment fund.';
comment on column public.profiles.cards_surplus_share is
  'Weight for a SPLIT rank shared by the credit-card block. See accounts.surplus_share.';

-- Non-negative or nothing. A negative weight has no meaning and the allocator ignores it anyway;
-- rejecting it at the boundary is cheaper than explaining it later. Wrapped so the file stays
-- replayable: `add constraint` has no `if not exists` form.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('accounts',      'surplus_share',       'accounts_surplus_share_non_negative'),
      ('savings_goals', 'surplus_share',       'savings_goals_surplus_share_non_negative'),
      ('car_funds',     'surplus_share',       'car_funds_surplus_share_non_negative'),
      ('profiles',      'cards_surplus_share', 'profiles_cards_surplus_share_non_negative')
    ) as v(tbl, col, con)
  loop
    if not exists (select 1 from pg_constraint where conname = t.con) then
      execute format(
        'alter table public.%I add constraint %I check (%I is null or %I >= 0)',
        t.tbl, t.con, t.col, t.col);
    end if;
  end loop;
end $$;
