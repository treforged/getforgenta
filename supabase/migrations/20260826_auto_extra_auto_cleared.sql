-- Persisted provenance for the auto-extra waterfall's deselect guard (ebac8ecc, 2026-08-25).
-- Kept here so the schema is reviewable in the repo, not only in the dashboard.
--
-- ROOT CAUSE this closes: `planAutoExtraDeselect` (src/lib/surplus-ranking.ts) switches a target's
-- `auto_extra` off once it is met, and a module-scoped `Set` (`autoExtraDeselected`,
-- src/hooks/useSurplusRanking.ts) remembered that it had already done so -- the ONLY thing standing
-- between a user's deliberate re-tick of a finished target and the guard silently fighting them
-- back off it on the very next pass. That Set lives in JS memory for the tab's lifetime and is
-- rebuilt empty on every page reload, so the fight it was built to prevent came straight back the
-- moment the page reloaded. This column is that memory, moved into the row it is about, so it
-- survives past the tab.
--
-- Columns only, on two tables that already exist and already carry RLS + owner policies -- the same
-- shape as 20260819_ranked_automatic_extra_payments.sql, whose own note is reproduced here because
-- it is still the reason no GRANT statement follows: the `public` default ACLs that make a NEW
-- table world-writable the instant it exists (the 2026-06-15 enumeration lesson) do not apply to
-- added columns, which inherit the table's existing grants and policies. Checked directly: neither
-- `savings_goals` nor `car_funds` carries any column-level grant anywhere in this repo's migration
-- history (grep for "on public.savings_goals to" / "on public.car_funds to" returns nothing) --
-- both rely on the table-level grant every Supabase project ships with, so this column is reachable
-- the same way `auto_extra` itself already is.
--
-- Defaults to FALSE, like `auto_extra` before it: every existing row has never been auto-cleared,
-- and a default of true would silently pre-empt a legitimate first deselect.
--
-- APPLIED 2026-08-26 via MCP `apply_migration` (success), and `src/integrations/supabase/types.ts`
-- regenerated from the live schema in the same commit that ships this file, per the
-- applied-migration+types rule. Client code that reads/writes the column:
-- src/lib/surplus-ranking.ts, src/hooks/useSurplusRanking.ts.

alter table public.savings_goals
  add column if not exists auto_extra_auto_cleared boolean not null default false;

alter table public.car_funds
  add column if not exists auto_extra_auto_cleared boolean not null default false;

comment on column public.savings_goals.auto_extra_auto_cleared is
  'True once planAutoExtraDeselect has switched this goal''s auto_extra off because it was met. Persists the guard''s exactly-once decision across a page reload -- see ebac8ecc and src/lib/surplus-ranking.ts.';
comment on column public.car_funds.auto_extra_auto_cleared is
  'True once planAutoExtraDeselect has switched this car fund''s (or loan''s) auto_extra off because it was met. Persists the guard''s exactly-once decision across a page reload -- see ebac8ecc and src/lib/surplus-ranking.ts.';
