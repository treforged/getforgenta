-- Ranked automatic extra payments, slice (a). APPLIED to project mdtosrbfkextcaezuclh 2026-08-19.
-- Kept here so the schema is reviewable in the repo, not only in the dashboard.
--
-- Columns only, on two tables that already exist and already carry RLS + owner policies (verified
-- after applying: rls = true, 4 policies each), so this adds no new attack surface. The `public`
-- default ACLs that make a NEW table world-writable the instant it exists -- the 2026-06-15
-- enumeration lesson in this same database -- do not apply to added columns, which inherit the
-- table's existing grants and policies.
--
-- `auto_extra` defaults to FALSE on purpose. Defaulting it true would divert deployable surplus
-- away from credit cards for every existing user the moment this deploys, silently moving their
-- payoff date. Opting in is the user's decision, not the migration's.
--
-- `sort_order` matches the established ordering pattern exactly (car_builds, car_build_phases,
-- car_build_items are all `integer not null default 0`). Deliberately NOT a `priority` enum:
-- ranking is a reorder, and an enum cannot express "this one, then that one".

alter table public.savings_goals
  add column if not exists sort_order integer not null default 0,
  add column if not exists auto_extra boolean not null default false;

alter table public.car_funds
  add column if not exists sort_order integer not null default 0,
  add column if not exists auto_extra boolean not null default false;

comment on column public.savings_goals.sort_order is
  'Rank for automatic extra payments, ascending. Ties break on id. Ranks the SURPLUS only -- it can never reorder a credit card minimum (see src/lib/ranked-surplus-allocation.ts).';
comment on column public.savings_goals.auto_extra is
  'Whether this goal draws automatic extra payments from the month''s deployable surplus.';
comment on column public.car_funds.sort_order is
  'Rank for automatic extra payments, ascending. Ties break on id.';
comment on column public.car_funds.auto_extra is
  'Whether this car fund draws automatic extra payments from the month''s deployable surplus.';
