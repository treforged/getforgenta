-- The anniversary run: what it decided, and the record that it ran at all.
-- ============================================================================
-- `og_members` records who is OWED the free year. This adds what HAPPENED at the
-- anniversary, and it exists because of the specific way this job will fail.
--
-- THIS CODE PATH GETS ITS FIRST REAL EXECUTION A YEAR AFTER IT IS WRITTEN, on a
-- date nobody will be watching, for a promise made to the hundred people most
-- invested in the product. Every failure mode this repo has hit today applies to
-- it and is worse here:
--
--   - A run that grants nothing looks identical to a run with nothing to do.
--     That is `LastTaskResult 0` on a backup that had not run since August, and
--     here it would go unnoticed for a YEAR. So every run writes a row, and
--     "0 members due" is a POSITIVE STATEMENT on the record rather than silence.
--   - A half-completed run that gets retried is the natural way to grant a free
--     year twice, which costs real money. Hence per-member outcome columns and a
--     claim that is checked before every grant.
--   - A member who is skipped must say WHY, in a column, at the time. "Why did
--     this person not get it?" has to be answerable in a year without replaying
--     a subscription history that no longer exists.

begin;

-- ── Per-member outcome ─────────────────────────────────────────────────────
alter table public.og_members
  add column if not exists reward_declined_at timestamptz,
  add column if not exists reward_declined_reason text,
  -- The mobile case, and it is not a failure. See docs/og-cohort.md: a
  -- RevenueCat subscriber CANNOT be moved to Stripe billing without the user
  -- acting, because only they can cancel an App Store or Play subscription and
  -- only they can enter payment details. So the job's honest output for them is
  -- "this person needs to be asked", recorded here, never a silent no-op.
  add column if not exists reward_action_required_at timestamptz;

comment on column public.og_members.reward_declined_reason is
  'Why the free year was not granted, recorded AT THE TIME. A year later the subscription history that justified it may no longer exist.';

-- ── Per-run record ─────────────────────────────────────────────────────────
create table if not exists public.og_anniversary_runs (
  id                uuid primary key default gen_random_uuid(),
  ran_at            timestamptz not null default now(),

  -- False for a real run. True when a due date was simulated to exercise the
  -- path before the first genuine anniversary — the only way this code is
  -- tested at all before it matters.
  dry_run           boolean not null default false,
  simulated_due_before timestamptz,

  members_due       integer not null default 0,
  granted           integer not null default 0,
  action_required   integer not null default 0,
  declined          integer not null default 0,
  failed            integer not null default 0,

  -- Anything the run wants a human to read later. Errors go here in full;
  -- a swallowed error is how a job like this dies quietly.
  notes             text,

  created_at        timestamptz not null default now()
);

revoke all on public.og_anniversary_runs from anon, authenticated;
alter table public.og_anniversary_runs enable row level security;

-- No policy and no grant for either client role: this is operational history,
-- not user data. It is read with the service role.

create index if not exists og_anniversary_runs_ran_at_idx
  on public.og_anniversary_runs (ran_at desc);

/**
 * The health check a human (or another job) can ask: has this run recently, and
 * did it do anything?
 *
 * A job that stops running is invisible unless something asks. This is the
 * question to ask.
 */
create or replace function public.og_anniversary_last_run()
returns table (ran_at timestamptz, dry_run boolean, members_due integer, granted integer, failed integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select r.ran_at, r.dry_run, r.members_due, r.granted, r.failed
    from public.og_anniversary_runs r
   order by r.ran_at desc
   limit 1;
$$;

commit;
