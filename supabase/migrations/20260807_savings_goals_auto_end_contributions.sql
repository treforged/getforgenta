-- 97.3 — per-goal "auto-end contributions once the goal is hit".
--
-- Two columns, both additive and defaulted, so existing rows keep today's behavior exactly
-- (toggle off, nothing stamped):
--
--   auto_end_contributions  the user-facing toggle. When on, saving the goal stamps the
--                           projected completion date onto every recurring_rules row the goal
--                           links, so the stop date is visible in Budget Control like any
--                           other end-dated rule.
--
--   auto_end_stamped_rules  PROVENANCE: ruleId -> the end_date this feature wrote there. This
--                           is what makes "never clobber a date the user set by hand" and
--                           "toggle-off clears exactly what we wrote" decidable at all — a
--                           rule carrying any other date is treated as manual and left alone.
--                           Stored as a jsonb side-column, matching lump_sum_payments.
--
-- Deliberately its OWN migration: do NOT bundle or co-apply with
-- 20260806_financial_connections.sql, which is intentionally unapplied and coupled to an
-- edge-function deploy. These columns are independent of that hazard and safe to apply alone.

alter table public.savings_goals
  add column if not exists auto_end_contributions boolean not null default false,
  add column if not exists auto_end_stamped_rules jsonb not null default '{}'::jsonb;

comment on column public.savings_goals.auto_end_contributions is
  'When true, saving this goal stamps its projected completion date onto the end_date of every recurring rule it links.';
comment on column public.savings_goals.auto_end_stamped_rules is
  'ruleId -> end_date written by the auto-end feature. Provenance only: a linked rule whose end_date is not listed here was set by the user and is never overwritten or cleared.';
