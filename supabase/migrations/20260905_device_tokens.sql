-- device_tokens + push_send_runs — the storage half of push notifications.
-- ============================================================================
--
-- WHY THIS EXISTS. Everything the app has today is a LOCAL notification: scheduled ON the
-- device BY the app, and it only ever fires for someone who has already opened it. Measured
-- 2026-09-05: 31 accounts, 2 active in seven days, 23 dormant beyond thirty days, and no new
-- signup since 2026-08-07. A local notification cannot reach a single one of those 23 people.
-- Push can. This table is the precondition for all of it.
--
-- WHAT IS NOT HERE, deliberately: no policy or judgement. `notification-policy.ts` already
-- decides WHAT to send, WHEN, and how often, and it is transport-agnostic — no Capacitor
-- import, no scheduling call. The sender calls it as-is. This migration only stores where to
-- send and what was sent.

begin;

create table if not exists public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('ios','android')),
  token        text not null,

  -- ⚠️ APNs SANDBOX AND PRODUCTION ARE DIFFERENT TOKEN POOLS, and a token minted in one is
  -- SILENTLY REJECTED by the other — no error a user would see, no error the sender can
  -- distinguish from a dead device. A TestFlight build and an App Store build of the same
  -- binary produce tokens that are not interchangeable, so the environment has to travel with
  -- the row rather than be assumed from a deploy flag.
  environment  text not null check (environment in ('sandbox','production')),

  -- Moves on every registration. A token the OS has quietly rotated stops being refreshed, so
  -- this is how a stale row becomes visible instead of just failing forever.
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  -- Set on sign-out, and on a provider rejection. NOT a delete: a revoked token is evidence
  -- about a device that existed, and deleting it makes "we never had a token" and "we had one
  -- and lost it" look identical from the outside.
  revoked_at   timestamptz
);

comment on table public.device_tokens is
  'Push tokens per device. The sender runs service-role and bypasses RLS; the four policies '
  'below exist because the CLIENT legitimately writes here - a token rotates and last_seen_at '
  'moves - unlike og_members, which no client touches at all.';

-- ⚠️ LOAD-BEARING, NOT DECORATIVE. The default public-schema ACL grants ALL to anon and
-- authenticated, so a table created without this line is readable by anyone holding the anon
-- key — which ships inside the app bundle. That is exactly the mistake found and closed in
-- `revenue_summary_lines` on 2026-09-05, on the same day this was written. The grants below
-- then hand back only what is actually needed, to only the role that needs it.
revoke all on public.device_tokens from anon, authenticated;
alter table public.device_tokens enable row level security;

-- One row per physical device. A re-registration of the same token must UPDATE rather than
-- accumulate duplicates, or a user with one phone is sent one notification several times.
create unique index if not exists device_tokens_platform_token_uniq
  on public.device_tokens (platform, token);

-- The sender's only query shape: live tokens for one user. Partial, because a revoked row is
-- never a send target and there is no reason to carry it in the index.
create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id) where revoked_at is null;

-- Own-row only, all four verbs, and `with check` on both write paths so a client cannot move a
-- row onto someone else's user_id after inserting it legitimately.
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated using (user_id = auth.uid());
create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated with check (user_id = auth.uid());
create policy device_tokens_update_own on public.device_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.device_tokens to authenticated;

-- ── WHAT WAS ACTUALLY SENT ───────────────────────────────────────────────────
--
-- The idempotency record, and the reason a retry is safe. `notification-policy.ts` already
-- emits a stable key per decision — `bill_due:2026-09-05:Rent`, `learn_lesson:<id>`,
-- `streak_risk:2026-09-05` — so the sender does not invent one. The unique index below is what
-- makes a duplicate send impossible rather than unlikely: two overlapping runs both try to
-- insert, and exactly one succeeds.
create table if not exists public.push_sends (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- The key from notification-policy. Never generated here.
  notification_key  text not null,
  kind              text not null,
  sent_at           timestamptz not null default now(),
  -- How many devices accepted it. Zero is a real outcome worth recording: it means the person
  -- was decided-for and reachable on paper, and no device took the message.
  devices_sent      integer not null default 0,
  created_at        timestamptz not null default now()
);

create unique index if not exists push_sends_user_key_uniq
  on public.push_sends (user_id, notification_key);

revoke all on public.push_sends from anon, authenticated;
alter table public.push_sends enable row level security;
-- No policy and no grant for either client role: this is operational history, not user data.
-- A client that could read it could enumerate what the app decided about a person, and a client
-- that could write it could suppress a notification by claiming it was already sent.

-- ── ONE ROW PER INVOCATION, INCLUDING THE QUIET ONES ─────────────────────────
--
-- Copied from og_anniversary_runs, and for the same reason: a job that only writes a row when
-- it does something is a job whose silence is unreadable. A run that decided nobody needed
-- anything and a run that never fired look identical unless the quiet run says so.
create table if not exists public.push_send_runs (
  id             uuid primary key default gen_random_uuid(),
  ran_at         timestamptz not null default now(),

  -- ⚠️ DEFAULT TRUE. A sender that ships defaulting to "actually send" is one accidental
  -- invocation away from messaging every user on the system. Sending is the opt-in.
  dry_run        boolean not null default true,

  -- Present when a run was scoped to one person, which is how it is exercised on a device
  -- before it is ever pointed at everybody.
  scoped_user_id uuid,

  candidates     integer not null default 0,
  sent           integer not null default 0,
  -- Decided, but already recorded in push_sends. Distinct from `sent` because the two mean
  -- different things about the run and only one of them is a message a person received.
  duplicate      integer not null default 0,
  -- Decided, but the person has no live device token. Distinct from `failed`: nothing went
  -- wrong, we simply cannot reach them, and that is the number that says whether registration
  -- is working at all.
  unreachable    integer not null default 0,
  failed         integer not null default 0,

  -- Errors in full. A swallowed error is how a job like this dies quietly.
  notes          text,

  created_at     timestamptz not null default now()
);

revoke all on public.push_send_runs from anon, authenticated;
alter table public.push_send_runs enable row level security;
-- Operational history. Read with the service role, same as og_anniversary_runs.

commit;
