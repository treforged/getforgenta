-- Staged emergency goal: two thresholds over ONE balance.
--
-- Tre, 2026-08-26: fill the move fund, then three months of expenses, then STOP and throw
-- everything at the cards, then come back for months four to six.
--
-- WHY THIS IS NOT TWO GOALS. That sequence looks expressible as two goals ranked either side of
-- the credit-card block, because the waterfall already funds one rank at a time and the card block
-- is already a rankable row. It is a trap: a goal linked to a savings ACCOUNT resolves
-- `current_amount` FROM that account, so two goals pointing at one account both report the same
-- balance and both read as funded. Splitting it in the data would silently double-count the very
-- savings the feature exists to build. One goal, two thresholds, one balance.
--
-- WHY MONTHS AND NOT DOLLARS. The dollar figure moves, and every way it moves matters:
-- the car loan is in it and disappears when the loan is paid off; Tre's rent rule is $1,915 today
-- and $1,480 after the move; a rule added tomorrow is part of the runway tomorrow. A stored
-- "$10,160" would be silently wrong within months. The MULTIPLIER is stored and the dollars are
-- recomputed by `src/lib/essential-monthly-expenses.ts` on every read — which is also the only
-- version of this feature that works for a customer who is not Tre.
--
-- Both thresholds are measured UPWARDS FROM `target_amount`, which stays the base the stages
-- extend. On Tre's row that base is $5,730 (lease break + deposit, the MOVE half of "Move fund,
-- then emergency fund"), so stage 1 = 5,730 + 3E and stage 2 = 5,730 + 6E.
--
-- NULLABLE, no backfill, no default. NULL means "this row has said nothing", which is what every
-- existing row means today and exactly the pre-feature behaviour: `goalStages` returns
-- `staged: false` and the goal chases `target_amount` as it always has. No user's allocation moves
-- when this deploys. Added columns inherit the table's existing RLS and owner policies, so this
-- adds no attack surface (the 2026-06-15 enumeration lesson is about NEW tables, whose default
-- `public` ACLs make them world-writable the instant they exist).

alter table public.savings_goals
  add column if not exists emergency_months_stage1 numeric;

alter table public.savings_goals
  add column if not exists emergency_months_stage2 numeric;

comment on column public.savings_goals.emergency_months_stage1 is
  'Stage 1 of a staged emergency goal, in MONTHS of essential expenses, on top of target_amount. NULL (the default and every pre-2026-08-26 row) means the goal is not staged and chases target_amount exactly as before. Dollars are derived from computeEssentialMonthlyExpenses at read time, never stored, because the basis moves when the car loan is paid off or the rent changes.';

comment on column public.savings_goals.emergency_months_stage2 is
  'Stage 2 of a staged emergency goal, in MONTHS, also on top of target_amount. Funding pauses at stage 1 while any revolving card balance remains, and resumes toward stage 2 once the cards are clear. NULL with stage 1 set means "and then stop": stage 2 collapses onto stage 1.';

-- Non-negative or nothing, and stage 2 cannot exist without stage 1 — a stage 2 on its own is
-- silently ignored by `goalStages`, and a state the engine ignores should not be storable.
-- Wrapped so the file stays replayable: `add constraint` has no `if not exists` form.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'savings_goals_emergency_months_non_negative'
  ) then
    alter table public.savings_goals
      add constraint savings_goals_emergency_months_non_negative
      check (
        (emergency_months_stage1 is null or emergency_months_stage1 >= 0)
        and (emergency_months_stage2 is null or emergency_months_stage2 >= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'savings_goals_emergency_stage2_needs_stage1'
  ) then
    alter table public.savings_goals
      add constraint savings_goals_emergency_stage2_needs_stage1
      check (emergency_months_stage2 is null or emergency_months_stage1 is not null);
  end if;
end $$;
