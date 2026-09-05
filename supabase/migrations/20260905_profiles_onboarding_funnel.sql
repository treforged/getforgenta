-- Onboarding: WHERE people stop, not just whether they finished.
--
-- Tre, 2026-09-02: "onboarding = value, not explain every feature", and CONVERSION IS THE METRIC.
-- `profiles.onboarding_completed` is a boolean, so today the only answerable question is "how many
-- finished". The actionable one -- WHICH STEP loses them -- has no data behind it at all, and a
-- metric you cannot compute is not a metric.
--
-- ── WHY THIS IS NOT AN ANALYTICS EVENT STREAM ────────────────────────────────
-- No new table, no per-tap event log, no third party, and nothing that is not already about this
-- user on their own row. Two columns say everything the funnel needs:
--   * the FURTHEST step reached (monotonic -- going Back never lowers it, because the question is
--     how far someone got, not where their cursor is);
--   * when they started, so "started and stopped" can be told from "started and is still going".
-- A person's own progress through their own signup is data they already gave us. An event stream
-- would be a new category of collection needing its own consent, for a question two columns answer.
--
-- The funnel is then one GROUP BY over rows that already exist:
--   select onboarding_furthest_step, count(*) from profiles
--    where onboarding_started_at is not null and not onboarding_completed group by 1;
--
-- NULL on every existing row, and null means "before this was recorded" -- never zero, and never
-- confused with "stopped at the first step".
--
-- REVERSING THIS: drop both columns and the CHECK. Nothing else reads them.

begin;

alter table public.profiles
  add column if not exists onboarding_furthest_step text,
  add column if not exists onboarding_started_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_onboarding_furthest_step_check;
alter table public.profiles
  add constraint profiles_onboarding_furthest_step_check
  check (onboarding_furthest_step is null or onboarding_furthest_step in
    ('welcome', 'bank', 'premium', 'income', 'expenses', 'debts', 'savings', 'goals', 'finish'));

comment on column public.profiles.onboarding_furthest_step is
  'The furthest onboarding step this user reached. MONOTONIC: pressing Back never lowers it, because the question is how far someone got. NULL = predates this column, which is not the same as stopping at the first step.';
comment on column public.profiles.onboarding_started_at is
  'When this user first landed on the onboarding wizard, so "started and stopped" can be told apart from "started and still going".';

commit;
