-- User-chosen repeat intervals for planned items in Budget Control.
-- ============================================================================
-- THE ASK (Tre, 2026-09-05): a planned item must be able to repeat every other
-- month, every three weeks, every five weeks — not only on the fixed set the
-- `frequency` column names.
--
-- WHY TWO COLUMNS AND NOT MORE ENUM VALUES. `frequency` is a closed vocabulary
-- ('weekly', 'biweekly', 'semi_monthly', 'monthly', 'yearly'). Answering the ask
-- by adding 'triweekly', then 'every_5_weeks', then 'bimonthly' grows that list
-- forever and every switch statement in the app grows with it — there are more
-- than twenty files that branch on `frequency` today. A COUNT and a UNIT express
-- every one of those cases, and every case nobody has asked for yet, in two
-- columns that no switch statement has to enumerate.
--
-- BOTH COLUMNS ARE NULL ON EVERY EXISTING ROW, AND THAT IS THE WHOLE SAFETY
-- STORY. Null means "use `frequency` exactly as before". Not one of the rules in
-- this database changes shape, changes schedule, or changes a forecast number as
-- a result of this migration. The app's own acceptance test is Tre's Supplements
-- rule (monthly, due_day 28): it carries nulls here and must produce the identical
-- occurrences it produced yesterday.
--
-- WHY BOTH-OR-NEITHER. A count with no unit is not a schedule, and a unit with no
-- count is ambiguous between 1 and "unset". Either state would reach the
-- occurrence generator as a question it cannot answer, so the database refuses to
-- hold one at all rather than leaving the engine to guess.
--
-- WHY THE UPPER BOUND ON THE COUNT. `interval_count` drives a loop that walks the
-- projection horizon. There is no legitimate "every 4000 months" bill, and an
-- unbounded integer arriving from a client is an input to a loop — 60 covers five
-- years of monthly, well past anything a person plans, and keeps the value in a
-- range the generator is tested over.
--
-- REVERSING THIS: `alter table public.recurring_rules drop column interval_unit,
-- drop column interval_count;` — additive and nullable, so dropping them restores
-- the previous behaviour exactly, with no data to migrate back.

begin;

alter table public.recurring_rules
  add column if not exists interval_unit text,
  add column if not exists interval_count integer;

alter table public.recurring_rules
  drop constraint if exists recurring_rules_interval_unit_check;
alter table public.recurring_rules
  add constraint recurring_rules_interval_unit_check
  check (interval_unit is null or interval_unit in ('day', 'week', 'month', 'year'));

alter table public.recurring_rules
  drop constraint if exists recurring_rules_interval_count_check;
alter table public.recurring_rules
  add constraint recurring_rules_interval_count_check
  check (interval_count is null or (interval_count >= 1 and interval_count <= 60));

alter table public.recurring_rules
  drop constraint if exists recurring_rules_interval_both_or_neither;
alter table public.recurring_rules
  add constraint recurring_rules_interval_both_or_neither
  check ((interval_unit is null) = (interval_count is null));

comment on column public.recurring_rules.interval_unit is
  'day/week/month/year. NULL = fall back to `frequency` unchanged. Set together with interval_count.';
comment on column public.recurring_rules.interval_count is
  'How many interval_units between occurrences (1-60). NULL = fall back to `frequency` unchanged.';

commit;
