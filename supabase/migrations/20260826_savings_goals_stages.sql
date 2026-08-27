-- N-STAGE SAVINGS GOALS (Tre, 2026-08-26)
--
-- Supersedes the two-column `emergency_months_stage1/2` design shipped earlier the same day.
-- His words: "the original $5,730 should show as the first stage since its only for the move fund
-- part (that stage should immediately stop/drop once its done) ... and the original fund goal date
-- should show per stage instead ... also be able to add multiple planned stops with target amounts."
--
-- So a goal now carries an ORDERED LIST of stops. Each stop is either a fixed dollar amount or a
-- months-of-essential-expenses multiplier, and each may carry its own date. Thresholds are
-- CUMULATIVE: stop N is reached at the sum of stops 1..N.
--
-- ⚠️ STILL ONE GOAL ROW. A goal linked to a savings account resolves `current_amount` FROM that
-- account, so splitting the sequence into several goal rows would have every one of them report the
-- same balance and read as funded. One row, one balance, N thresholds over it.
--
-- ⚠️ `emergency_months_stage1/2` ARE KEPT, NOT DROPPED. A live goal (Tre's own) already stores its
-- stages there, and the reader prefers `stages` only when it is non-empty — so a row that this
-- backfill somehow misses keeps working on the legacy columns instead of silently losing its plan.
-- They come out in a later release, once every row has been through a save.

-- An object per entry, sized by exactly one of amount/months, and non-negative. Checked in the
-- database as well as the form because the engine multiplies these by a live expense figure: a
-- negative months would hand a goal a NEGATIVE threshold and quietly retire it.
--
-- ⚠️ IT HAS TO BE A FUNCTION. Postgres refuses a subquery inside a CHECK ("0A000: cannot use
-- subquery in check constraint"), and `jsonb_array_elements` over the array is a subquery however it
-- is written. `immutable` is what makes the function usable in a constraint at all; the empty
-- `search_path` plus pg_catalog qualification is the standard hardening this repo applies to every
-- function it adds.
create or replace function public.savings_goal_stages_valid(stages jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(stages) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(stages) as s
      where pg_catalog.jsonb_typeof(s) <> 'object'
         or (s ? 'amount') = (s ? 'months')          -- exactly one sizing key
         or (s ? 'amount' and (pg_catalog.jsonb_typeof(s -> 'amount') <> 'number' or (s ->> 'amount')::numeric < 0))
         or (s ? 'months' and (pg_catalog.jsonb_typeof(s -> 'months') <> 'number' or (s ->> 'months')::numeric <= 0))
    );
$$;

alter table public.savings_goals
  add column if not exists stages jsonb not null default '[]'::jsonb;

comment on column public.savings_goals.stages is
  'Ordered list of planned stops. Each: {id, name?, amount?, months?, target_date?, after_cards?}. '
  'Exactly one of amount/months sizes a stop; thresholds are cumulative. after_cards marks the stop '
  'that waits until revolving credit-card debt is clear. Empty array = an ordinary one-target goal.';

alter table public.savings_goals
  drop constraint if exists savings_goals_stages_shape;

alter table public.savings_goals
  add constraint savings_goals_stages_shape check (public.savings_goal_stages_valid(stages));

-- ── BACKFILL ────────────────────────────────────────────────────────────────
--
-- The two-column rows become three stops at most, and the thresholds they produce are identical to
-- what `goalStages` produced from the columns:
--   stop 1  target_amount           (the MOVE half — dropped when target_amount is 0)
--   stop 2  stage1 months
--   stop 3  (stage2 - stage1) months, after_cards            (dropped when stage2 <= stage1)
--
-- `target_amount` is deliberately LEFT ALONE. It is what every other surface on the app reads for a
-- goal's headline target, and rewriting it here would need the live essential-expense figure, which
-- SQL cannot see. The form refreshes it to the stops' total on the next save.
update public.savings_goals g
set stages = (
  select coalesce(jsonb_agg(s order by ord), '[]'::jsonb)
  from (
    -- The goal's single date belongs to the FIRST stop, not to the plan as a whole: on Tre's row it
    -- is the move date (Jul 2027) and says nothing about the six-month runway. Dropping it would
    -- have thrown away a date the user set.
    select 1 as ord, jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', 'First target',
      'amount', g.target_amount
    ) || (case when g.target_date is null then '{}'::jsonb
               else jsonb_build_object('target_date', g.target_date::text) end) as s
    where coalesce(g.target_amount, 0) > 0
    union all
    select 2, jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', 'Emergency runway',
      'months', g.emergency_months_stage1
    )
    union all
    select 3, jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', 'Full runway',
      'months', g.emergency_months_stage2 - g.emergency_months_stage1,
      'after_cards', true
    )
    where g.emergency_months_stage2 is not null
      and g.emergency_months_stage2 > g.emergency_months_stage1
  ) parts
)
where g.emergency_months_stage1 is not null
  and g.emergency_months_stage1 > 0
  and g.stages = '[]'::jsonb;
