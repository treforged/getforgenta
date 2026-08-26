-- Friends + leaderboard — Phase 0 schema (docs/friends-leaderboard-plan.md §2, §4).
-- ============================================================================
-- Three tables, two helper functions, and — deliberately — NOT ONE policy or
-- grant on a table that holds money. Friend visibility ends at
-- `leaderboard_snapshots`, whose rows are coarse integers the owner wrote about
-- themselves. There is no path from a friendship to `accounts`, `transactions`,
-- `debts`, `savings_goals`, `budget_items` or `profiles`, and the test beside
-- this file fails if one ever appears.
--
-- Discipline is inherited line-for-line from 20260825_partner_links.sql; the
-- three notes worth repeating, because each is a hole this project has already
-- had or nearly had:
--
-- WHY THE FIRST STATEMENT AFTER EVERY `create table` IS A REVOKE. Verified on
-- this project 2026-08-19 (20260819_slice6_crowd_merchant_category_learning.sql):
-- the default ACLs on schema `public` grant ALL (`arwdDxtm`) to BOTH `anon` and
-- `authenticated` for every new table, so a table created here is world-writable
-- the instant it exists. There is no window in this file where any of the three
-- tables is reachable.
--
-- WHY THE INVITE CODE IS NEVER STORED. `share_token` was a readable column and
-- that was the 2026-06-15 enumeration hole (20260615_fix_public_rls.sql). Here
-- the code exists in exactly two places: the invitee's mailbox, and a SHA-256
-- hash in a column with NO client-readable grant.
--
-- MIGRATION ORDER IS LOAD-BEARING, and more so than in the partner file:
-- friend_links → active_friend_ids() → leaderboard_shares → is_metric_shared()
-- → leaderboard_snapshots + its policies, because the last policy calls both
-- functions and each function reads a table defined above it. Wrapped
-- begin/commit like 20260806_financial_connections.sql.

begin;

-- ── The friendship row ─────────────────────────────────────────────────────
-- Same shape as `partner_links`, same two-consents-in-one-row model:
-- `inviter_id` wrote it (from their JWT, via the Edge Function); `accepted_by`
-- accepted it (from THEIR JWT, with the exact code, from the invited mailbox).
-- A friendship is active if and only if `accepted_at is not null and revoked_at
-- is null` — there is deliberately no `status` column, because a status can
-- drift out of sync with the two timestamps the RLS predicates actually test.
--
-- The ONE structural difference from partner_links: a person may hold many
-- friendships, so the "one active link per side" indexes are wrong here. They
-- are replaced below by a canonical-pair index.
create table if not exists public.friend_links (
  id               uuid primary key default gen_random_uuid(),

  -- Consent #1: creating the invite IS the inviter's consent.
  inviter_id       uuid not null references auth.users(id) on delete cascade,

  -- The invite is BOUND to a mailbox; only its owner can accept. Stored
  -- lowercased, and the CHECK enforces that rather than trusting the caller:
  -- the accept path compares lower(jwt email) against this value, so a row
  -- stored with any uppercase would be permanently unacceptable.
  invitee_email    text not null
                     constraint friend_links_email_lowercase
                       check (invitee_email = lower(invitee_email)),

  -- 128 bits of randomness, SHA-256, hex. NEVER granted to a client role.
  invite_code_hash text not null,

  expires_at       timestamptz not null default (now() + interval '7 days'),

  -- Consent #2: accepting with the exact code IS the invitee's consent.
  accepted_by      uuid references auth.users(id) on delete cascade,
  accepted_at      timestamptz,

  -- Either side, any time, without the other's agreement.
  revoked_at       timestamptz,
  revoked_by       uuid,

  created_at       timestamptz not null default now(),

  -- You cannot befriend yourself.
  constraint friend_links_no_self check (accepted_by is distinct from inviter_id),
  -- accepted_by and accepted_at travel together — one without the other is a
  -- half-recorded consent.
  constraint friend_links_accept_pair
    check ((accepted_by is null) = (accepted_at is null))
);

-- ⚠️ NON-NEGOTIABLE FIRST LINE (see the header). Everything the client may do
-- is re-granted explicitly further down; anything not listed there is denied.
revoke all on public.friend_links from anon, authenticated;

alter table public.friend_links enable row level security;

-- ── Uniqueness: one friendship per PAIR, one outstanding invite per mailbox ─
-- The canonical-pair index. `partner_links` allows one active link per person;
-- friends are many-to-many, so what must be unique is the unordered pair. Sorting
-- the two ids into (least, greatest) makes {A,B} and {B,A} the same key, which is
-- what stops A and B holding two active rows — one from each direction — and
-- appearing twice in every leaderboard.
--
-- Both expressions are parenthesised because LEAST/GREATEST are parsed as
-- expressions rather than function calls, and a bare `least(a, b)` in an index
-- column list is a syntax error. `accepted_at is not null` plus the accept-pair
-- CHECK guarantees `accepted_by` is non-null inside this partial index, so
-- neither expression is ever collapsing a NULL argument.
create unique index if not exists friend_links_one_active_pair
  on public.friend_links (
    (least(inviter_id, accepted_by)),
    (greatest(inviter_id, accepted_by))
  )
  where accepted_at is not null and revoked_at is null;

-- One OUTSTANDING invite per (inviter, mailbox) — stops invite-spraying the same
-- address. Unlike partner_links this is NOT one pending invite per inviter: a
-- user is expected to invite several friends at once. NOTE for the Edge Function:
-- an expired-but-unrevoked invite still occupies this slot, so `invite` must
-- supersede its own outstanding row for that address before inserting. Returning
-- "sent" without sending would be the alternative, and a success the user cannot
-- distinguish from a failure is not an option.
create unique index if not exists friend_links_one_pending
  on public.friend_links (inviter_id, lower(invitee_email))
  where accepted_at is null and revoked_at is null;

-- The accept path's only lookup: exact hash match. Not unique — a SHA-256
-- collision is not the thing being defended against, and `.maybeSingle()`
-- surfaces a duplicate as an error the function reports as its generic 404.
create index if not exists friend_links_invite_code_hash_idx
  on public.friend_links (invite_code_hash);

-- The membership lookup active_friend_ids() runs on every leaderboard read.
create index if not exists friend_links_accepted_by_idx
  on public.friend_links (accepted_by)
  where accepted_at is not null and revoked_at is null;
create index if not exists friend_links_inviter_id_idx
  on public.friend_links (inviter_id)
  where accepted_at is not null and revoked_at is null;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Members can SEE their own link rows. The code hash is excluded at the GRANT
-- layer below, not here: a policy grants rows, a column grant grants columns.
drop policy if exists friend_links_select_own on public.friend_links;
create policy friend_links_select_own
  on public.friend_links for select to authenticated
  using (auth.uid() = inviter_id or auth.uid() = accepted_by);

-- Either member can REVOKE directly. No function dependency on purpose:
-- leaving must work even if Edge Functions are down.
--
-- ⚠️ REVOCATION IS ONE-WAY, and that is what the `revoked_at` tests in USING
-- and WITH CHECK are for. Membership alone would let the OTHER member update
-- `revoked_at` back to null and resurrect a friendship the first member had
-- severed — putting their bucket back on that person's leaderboard without a
-- fresh consent. USING refuses to match an already-revoked row; WITH CHECK
-- refuses to write a null. The only reachable transition is null → not-null,
-- which is the entire feature.
--
-- `revoked_by` is left unconstrained deliberately: it is a label, not a gate,
-- and a mislabelled revocation still severs the link. A WITH CHECK on it would
-- let revocation FAIL for a cosmetic reason, and revocation must never fail.
drop policy if exists friend_links_revoke_own on public.friend_links;
create policy friend_links_revoke_own
  on public.friend_links for update to authenticated
  using (
    (auth.uid() = inviter_id or auth.uid() = accepted_by)
    and revoked_at is null
  )
  with check (
    (auth.uid() = inviter_id or auth.uid() = accepted_by)
    and revoked_at is not null
  );

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Column allowlist, and the omission is the point: `invite_code_hash` has no
-- client-readable path at all. NO insert and NO delete for authenticated —
-- invite and accept run through the Edge Function with the service role, which
-- is the only way both consents can be attributed to a verified JWT.
grant select (id, inviter_id, invitee_email, expires_at,
              accepted_by, accepted_at, revoked_at, created_at)
  on public.friend_links to authenticated;
grant update (revoked_at, revoked_by) on public.friend_links to authenticated;

-- ── The current user's ACTIVE friends ──────────────────────────────────────
-- SECURITY DEFINER so it reads friend_links regardless of future policy
-- changes; STABLE so the planner runs it once per statement (InitPlan) rather
-- than once per row; `set search_path = ''` per
-- 20260621_harden_definer_functions_and_storage.sql, hence every reference is
-- schema-qualified.
--
-- Returns the EMPTY SET when there is no active friendship — and for an
-- unauthenticated caller `auth.uid()` is null, so every comparison in the WHERE
-- is null and the set is empty again. `user_id in (empty set)` is FALSE, so the
-- snapshot policy below fails CLOSED in both cases.
--
-- No ORDER BY / LIMIT here, unlike active_partner_id(): that function had to
-- pick ONE row deterministically because an arbitrary `limit 1` inside an RLS
-- predicate can flip the visible dataset between statements. This one returns
-- the whole set, so there is nothing to pick and nothing to order.
create or replace function public.active_friend_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select case when fl.inviter_id = auth.uid() then fl.accepted_by
              else fl.inviter_id end
  from public.friend_links fl
  where (fl.inviter_id = auth.uid() or fl.accepted_by = auth.uid())
    and fl.accepted_at is not null
    and fl.revoked_at is null
$$;

-- New functions grant EXECUTE to PUBLIC by default, which anon and
-- authenticated inherit regardless of any grant on those roles specifically —
-- the revoke has to target PUBLIC, not just anon (20260621 §1).
revoke all on function public.active_friend_ids() from public, anon;
grant execute on function public.active_friend_ids() to authenticated;

-- ── The opt-in registry ────────────────────────────────────────────────────
-- One row per (user, metric). NO ROWS MEANS SHARE NOTHING: is_metric_shared()
-- below is an EXISTS over `enabled`, so a user who has never opened the feature,
-- and a user who opted out, are indistinguishable to a friend — both invisible.
-- `enabled` also defaults to false, so even an INSERT that forgets the column
-- shares nothing.
create table if not exists public.leaderboard_shares (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- The four metrics of design §3. A CHECK rather than an enum: adding a metric
  -- later is a one-line migration on both tables instead of an ALTER TYPE.
  metric     text not null
               constraint leaderboard_shares_metric
                 check (metric in ('goal_progress', 'savings_streak',
                                   'debt_payoff', 'budget_adherence')),

  enabled    boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Also the upsert target the toggle writes through.
  constraint leaderboard_shares_user_metric unique (user_id, metric)
);

revoke all on public.leaderboard_shares from anon, authenticated;

alter table public.leaderboard_shares enable row level security;

-- Owner-only, all three verbs. A friend has NO policy here at all: whether
-- somebody has opted in is itself private, and the only thing that ever reads
-- this table across users is the SECURITY DEFINER predicate below.
drop policy if exists leaderboard_shares_select_own on public.leaderboard_shares;
create policy leaderboard_shares_select_own
  on public.leaderboard_shares for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists leaderboard_shares_insert_own on public.leaderboard_shares;
create policy leaderboard_shares_insert_own
  on public.leaderboard_shares for insert to authenticated
  with check (auth.uid() = user_id);

-- USING and WITH CHECK both, so a row cannot be re-pointed at another user_id
-- on the way out.
drop policy if exists leaderboard_shares_update_own on public.leaderboard_shares;
create policy leaderboard_shares_update_own
  on public.leaderboard_shares for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Column allowlist. No DELETE: opting out is `enabled = false`, which keeps the
-- (user_id, metric) row as the durable record of the choice.
grant select (id, user_id, metric, enabled, created_at, updated_at)
  on public.leaderboard_shares to authenticated;
grant insert (user_id, metric, enabled, updated_at)
  on public.leaderboard_shares to authenticated;
grant update (enabled, updated_at)
  on public.leaderboard_shares to authenticated;

-- ── "Has this person opted this metric in?" ────────────────────────────────
-- SECURITY DEFINER for the same reason as active_friend_ids(): the caller has no
-- read path to another user's shares row and must not be given one. EXISTS
-- returns false — never null — for a missing row, a disabled row, a metric that
-- does not exist, or a null argument, so the policy below fails CLOSED in every
-- one of those cases.
--
-- `p_` prefixed parameters per the house convention (record_promo_activity,
-- crowd_merchant_categories): with `search_path = ''` a bare `user_id` here
-- would be an ambiguous reference against the column of the same name.
create or replace function public.is_metric_shared(p_user_id uuid, p_metric text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.leaderboard_shares ls
    where ls.user_id = p_user_id
      and ls.metric = p_metric
      and ls.enabled
  )
$$;

revoke all on function public.is_metric_shared(uuid, text) from public, anon;
grant execute on function public.is_metric_shared(uuid, text) to authenticated;

-- ── The only cross-user-readable artifact in the feature ───────────────────
-- A coarse integer the owner computed about themselves and wrote themselves
-- (design §3). The DB never holds anything finer than the bucket, so no server
-- bug, view mis-grant or policy drift can widen what a friend sees — the finer
-- number does not exist here to leak.
--
-- `bucket_value` is one int for four different shapes: 0-100 for the three
-- percentage metrics (5% buckets, enforced client-side), and a week count for
-- savings_streak. The CHECK is the outer clamp only — 520 weeks is ten years,
-- past which a streak is a data error rather than a streak.
--
-- `week` is the Monday of the week the bucket describes. The CHECK is what makes
-- the weekly cadence real: the friend policy only ever shows the current
-- `date_trunc('week', ...)` Monday, so without it a client could publish seven
-- rows a week under six invisible dates, and the (user_id, metric, week) key
-- would not stop the intra-week movement design §5 relies on being absent.
create table if not exists public.leaderboard_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  metric       text not null
                 constraint leaderboard_snapshots_metric
                   check (metric in ('goal_progress', 'savings_streak',
                                     'debt_payoff', 'budget_adherence')),

  bucket_value integer not null
                 constraint leaderboard_snapshots_bucket_range
                   check (bucket_value between 0 and 520),

  -- "week is the Monday of its own week", written with the SAME date_trunc the
  -- friend policy uses so the two can never disagree. The explicit ::timestamp
  -- cast is load-bearing: date_trunc(text, timestamp) is IMMUTABLE and so legal
  -- in a CHECK, while the timestamptz overload is only STABLE and would be
  -- rejected outright.
  week         date not null
                 constraint leaderboard_snapshots_week_is_monday
                   check (week = date_trunc('week', week::timestamp)::date),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One bucket per person per metric per week. This is the cadence limit of
  -- design §5, enforced by the database rather than by the publisher's
  -- good behaviour.
  constraint leaderboard_snapshots_user_metric_week unique (user_id, metric, week)
);

revoke all on public.leaderboard_snapshots from anon, authenticated;

alter table public.leaderboard_snapshots enable row level security;

-- The owner's own three verbs. Every one of them pins `auth.uid() = user_id` in
-- WITH CHECK, so a client cannot write, or re-point, a row belonging to somebody
-- else — the spoofing that matters is not a wrong bucket about yourself, it is a
-- bucket planted under another person's id.
drop policy if exists leaderboard_snapshots_select_own on public.leaderboard_snapshots;
create policy leaderboard_snapshots_select_own
  on public.leaderboard_snapshots for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists leaderboard_snapshots_insert_own on public.leaderboard_snapshots;
create policy leaderboard_snapshots_insert_own
  on public.leaderboard_snapshots for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists leaderboard_snapshots_update_own on public.leaderboard_snapshots;
create policy leaderboard_snapshots_update_own
  on public.leaderboard_snapshots for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── The friend read (design §2) ────────────────────────────────────────────
-- ADDITIVE and SELECT-ONLY, and this is the ONLY policy in the whole feature
-- that lets one user read another user's row. Three independent conditions, each
-- of which fails closed on its own:
--
--   1. `active_friend_ids()` is empty unless an accepted, unrevoked link exists,
--      so an unlinked or revoked viewer matches nothing. Revocation therefore
--      takes effect on the next statement, with no cache to wait for.
--   2. `is_metric_shared()` is false unless the OWNER opted this exact metric in,
--      so a real friend of someone who never opted in also sees nothing.
--   3. The week equality hides every historical row, so a friend sees one coarse
--      value per metric per week and cannot assemble a series.
--
-- `(select public.active_friend_ids())` is wrapped so the STABLE function is an
-- InitPlan evaluated once per statement rather than once per row.
drop policy if exists leaderboard_snapshots_select_friend on public.leaderboard_snapshots;
create policy leaderboard_snapshots_select_friend
  on public.leaderboard_snapshots for select to authenticated
  using (
    user_id in (select public.active_friend_ids())
    and public.is_metric_shared(user_id, metric)
    and week = date_trunc('week', now())::date
  );

-- Column allowlist. `created_at` and `updated_at` are deliberately NOT readable:
-- a friend who can see when in the week you published has a timing signal to
-- correlate against, which is exactly the inference design §5 spends its
-- mitigations on. They are writable so the publisher can stamp an upsert, and
-- readable by nobody but the service role.
--
-- No DELETE: history is pruned server-side if it ever needs pruning, and a
-- client-side delete grant would let a bad actor with a stolen session erase the
-- record rather than merely misreport it.
grant select (id, user_id, metric, bucket_value, week)
  on public.leaderboard_snapshots to authenticated;
grant insert (user_id, metric, bucket_value, week, updated_at)
  on public.leaderboard_snapshots to authenticated;
grant update (bucket_value, updated_at)
  on public.leaderboard_snapshots to authenticated;

-- No extra index: the unique constraint's (user_id, metric, week) index is
-- exactly the access path both reads use — the owner's own rows by user_id, and
-- the friend read, whose policy resolves to a user_id IN-list first.

commit;
