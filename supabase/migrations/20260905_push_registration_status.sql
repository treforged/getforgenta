-- push_registration_status — why a person has no device token.
--
-- ⚠️ THE NUMBER THIS EXISTS TO REPLACE. On 2026-09-05 the sender ran and reported
-- `candidates: 48, sent: 0, unreachable: 48`. Forty-eight people the decider would have
-- notified, and not one reachable. The only 7 rows in `device_tokens` belonged to
-- `reviewer@treforged.com` from testing the build that morning.
--
-- And nothing in the system could say WHY, because `registerForPush` returned `null` for NINE
-- different situations that need opposite fixes:
--
--   web / not a native platform          nothing to fix
--   the switch was never opened          a PRODUCT problem — nobody was ever asked
--   the person declined                  their choice; leave them alone
--   APNs or FCM never answered in 10s    a NETWORK problem, retry later
--   the OS reported a registration error a BUILD problem — entitlements, google-services.json
--   granted, but the token came back ''  a PLATFORM problem
--   the token saved into a failed write  a BACKEND problem, and the worst of them: a real
--                                        token was minted and then thrown away
--   the plugin threw                     a PACKAGING problem
--   it worked                            nothing to fix
--
-- "Nobody has been asked" and "everybody was asked and it failed" produced the identical empty
-- table. This table is what tells them apart, and it is the difference between a product
-- decision and a bug hunt.
--
-- ── ONE ROW PER PERSON PER PLATFORM, NOT AN EVENT LOG ──────────────────────
-- `registerForPush` runs on every sign-in, so an append-only log would grow without bound and
-- say nothing a counter does not. The row carries the LATEST outcome plus how many attempts it
-- took and when it was first and last seen, which answers "is this working this week" directly.
--
-- ⚠️ IT STORES NO TOKEN AND NO DEVICE IDENTIFIER. An outcome word, a platform and two
-- timestamps. There is nothing here that identifies a handset, and nothing that could be used
-- to reach one — `device_tokens` remains the only place a token is written.

create table if not exists public.push_registration_status (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  platform      text        not null check (platform in ('ios', 'android')),
  outcome       text        not null check (outcome in (
                              'registered', 'undecided_not_asked', 'denied', 'timeout',
                              'registration_error', 'empty_token', 'save_failed', 'plugin_error'
                            )),
  -- Whether this attempt was allowed to raise the OS prompt. Separates "we asked and they said
  -- no" from "we never asked", which are the two the funnel most needs apart.
  prompted      boolean     not null default false,
  attempts      integer     not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, platform)
);

comment on table public.push_registration_status is
  'Latest push-registration outcome per user per platform. No token, no device id — see the '
  'header of 20260905_push_registration_status.sql for why the nine null paths needed naming.';

-- Same posture as `device_tokens`: nothing reaches this table without going through the
-- function below, which takes its `user_id` from the session rather than from the caller.
revoke all on public.push_registration_status from anon, authenticated;
alter table public.push_registration_status enable row level security;

-- A person may read their own row. Nobody may write one directly.
drop policy if exists push_registration_status_select_own on public.push_registration_status;
create policy push_registration_status_select_own
  on public.push_registration_status for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.push_registration_status to authenticated;

/**
 * Record this device's registration outcome.
 *
 * ⚠️ `SECURITY DEFINER` AND `auth.uid()`, NOT A CLIENT-SUPPLIED user_id. A client that could
 * name its own user id could write a false "registered" against somebody else's account and
 * make an unreachable person look reachable — which would poison the exact number this table
 * exists to produce. Same reasoning as `push-store.ts` not passing `user_id` for `device_tokens`.
 *
 * The upsert INCREMENTS `attempts` rather than replacing it, because "failed once" and "failed
 * on every launch for a week" are different problems and the Supabase client's own `upsert`
 * cannot express an increment.
 */
create or replace function public.record_push_registration(
  p_platform text,
  p_outcome  text,
  p_prompted boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return; -- Signed out. Nothing to attribute this to, and nothing worth failing over.
  end if;

  insert into public.push_registration_status (user_id, platform, outcome, prompted)
  values (v_user, p_platform, p_outcome, coalesce(p_prompted, false))
  on conflict (user_id, platform) do update
    set outcome      = excluded.outcome,
        -- Once a person has been prompted, they have been prompted. A later silent attempt must
        -- not erase the fact that they were asked.
        prompted     = public.push_registration_status.prompted or excluded.prompted,
        attempts     = public.push_registration_status.attempts + 1,
        last_seen_at = now();
end;
$$;

revoke all on function public.record_push_registration(text, text, boolean) from public, anon;
grant execute on function public.record_push_registration(text, text, boolean) to authenticated;

/**
 * THE FUNNEL, IN ONE PLACE, so nobody has to infer it from an empty table again.
 *
 * ⚠️ THE QUESTION THIS ANSWERS. On 2026-09-05 the only available reading was "`device_tokens` is
 * empty", which is consistent with three completely different worlds: nobody has been asked,
 * everybody was asked and refused, or everybody was asked and the BUILD could not register. It
 * turned out to be the third — `App.entitlements` had no `aps-environment` key — and no query
 * could have distinguished it. This view is what makes the next one distinguishable.
 *
 * `security_invoker` so it is subject to the caller's own RLS rather than the definer's: a
 * signed-in person reading this sees their own row and nothing else, exactly as the table's
 * policy says. Without it a view over an RLS table quietly becomes a way around the policy.
 */
create or replace view public.push_registration_funnel
with (security_invoker = true) as
select
  platform,
  outcome,
  count(*)                                   as people,
  count(*) filter (where prompted)           as of_whom_were_asked,
  sum(attempts)                              as total_attempts,
  min(first_seen_at)                         as first_seen,
  max(last_seen_at)                          as last_seen
from public.push_registration_status
group by platform, outcome
order by platform, people desc;

comment on view public.push_registration_funnel is
  'Push registration outcomes per platform. "people" is distinct users; "of_whom_were_asked" '
  'separates a product problem (never prompted) from a bug (prompted and failed).';

-- ⚠️ REVOKED FROM `anon` EXPLICITLY, not left to `security_invoker` alone. A view created here
-- is granted to `anon` by default, and `security_invoker` means anon reading it hits the table's
-- RLS and gets nothing — today. That is one mechanism deep. If a permissive policy is ever added
-- to the table, or the invoker flag is dropped in a later edit, the grant is what decides. Same
-- posture as `device_tokens` and the table above: revoke, then grant only what is needed.
revoke all on public.push_registration_funnel from anon;
grant select on public.push_registration_funnel to authenticated;
