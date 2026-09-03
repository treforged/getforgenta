-- og_anniversary_runs.consent_required — the people who are OWED and UNASKED.
-- ============================================================================
-- The consent gate (docs/og-cohort.md: "nothing grants without a confirmed
-- row") introduced a fourth way a due member can end a run: eligible, due, and
-- nobody has asked them yet. Without a column of its own that outcome would
-- have to hide inside `action_required`, which means something different — a
-- member who HAS been asked and owes us the second half — or inside `notes`,
-- where no monitor reads it.
--
-- The distinction is the whole point. "We asked and heard nothing" and "we
-- never asked" carry different obligations, and only one of them is our fault.
-- A run that folded them together would report an obligation as being handled
-- on a day when nothing in the system was trying to handle it.
--
-- Defaults to 0 so existing rows stay readable and mean what they meant: they
-- were written before a consent ask existed, and zero is the truth for them.

begin;

alter table public.og_anniversary_runs
  add column if not exists consent_required integer not null default 0;

comment on column public.og_anniversary_runs.consent_required is
  'Members due and eligible whose consent ask has never been sent. Distinct from action_required, which means they WERE asked and the obligation is half-settled. Nothing grants without a confirmed og_billing_consent row.';

commit;
