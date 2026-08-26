# Friends + Leaderboard System — Implementation Plan (2026-08-26)

Manager-accepted plan from the read-only Plan agent. Phase 0 is the next
executor brief (Opus tier - security). Verified against the real partner-link
prior art; file paths were checked by the planner, not guessed.

## 1. Definition of done
Two users can become friends via hashed-token mutual-consent invites, opt in
per-metric to a leaderboard that shows only coarse-bucketed derived
percentages/streaks (never dollars), with either side able to revoke instantly,
all guarded by fail-closed RLS proven by tests.

## 2. Data model

Follow `supabase/migrations/20260825_partner_links.sql` line-for-line in
discipline: `revoke all ... from anon, authenticated` as the first statement
after every `create table` (this project's public-schema default ACLs
world-grant new tables), column-allowlist grants, no `status` column
(timestamps are truth), `begin/commit`.

**`friend_links`** - same columns as `partner_links` (`inviter_id`,
`invitee_email` with lowercase CHECK, `invite_code_hash` with no client grant,
`expires_at`, `accepted_by`/`accepted_at` pair CHECK, `revoked_at`/`revoked_by`,
no-self CHECK). Differences: drop the one-active-link partial unique indexes;
replace with a canonical-pair index
`unique (least(inviter_id, accepted_by), greatest(inviter_id, accepted_by))
where accepted_at is not null and revoked_at is null`, plus
`unique (inviter_id, lower(invitee_email)) where accepted_at is null and
revoked_at is null` for pending. RLS: `friend_links_select_own` and the one-way
`friend_links_revoke_own` (USING `revoked_at is null`, WITH CHECK
`revoked_at is not null`) copied verbatim - revocation must work with Edge
Functions down.

**`leaderboard_shares`** (opt-in registry) - `user_id`, `metric` (CHECK in
`('goal_progress','savings_streak','debt_payoff','budget_adherence')`),
`enabled boolean`, `updated_at`; unique `(user_id, metric)`. RLS: owner-only
select/insert/update (`auth.uid() = user_id`). Default: no rows = share nothing.

**`leaderboard_snapshots`** - `user_id`, `metric` (same CHECK),
`bucket_value int` with `CHECK (bucket_value between 0 and 520)`, `week date`
(Monday), unique `(user_id, metric, week)`. Owner insert/update with
`WITH CHECK (auth.uid() = user_id)`. Friend SELECT policy:

```sql
using (
  user_id in (select public.active_friend_ids())
  and public.is_metric_shared(user_id, metric)
  and week = date_trunc('week', now())::date
)
```

**Helpers**: `active_friend_ids() returns setof uuid` and
`is_metric_shared(uuid, text) returns boolean` - `security definer stable set
search_path = ''`, `revoke ... from public, anon`, returning empty/false when
unlinked so every policy fails closed, exactly like `active_partner_id()`.

**Critically: zero new policies on any raw financial table.** Friend visibility
touches only `leaderboard_snapshots`. No path from friendship to `accounts`,
`transactions`, `debts`, `savings_goals`, or `profiles`.

**Edge function vs direct RLS**: invite/accept/status -> new `friend-link` edge
function cloned from `supabase/functions/partner-link/index.ts` +
`invite-code.ts` (service role, `verify_jwt = true` declared explicitly in
`supabase/config.toml` - the file is source of truth; MCP deploys must pass it
too). Keep all four disciplines: no account-existence oracle, uniform 404 on
accept failures, code emailed once and only SHA-256 stored, no false "sent".
`status` additionally returns friends' `profiles.display_name` via service role
(fallback: masked email local part) - avoids any client grant on `profiles`.
Revoke, opt-in toggles, and snapshot publishing -> direct RLS-scoped client
writes.

## 3. Metric computation - client-side, bucketed before write

All four metrics are computed client-side from the user's own already-loaded
data, bucketed, then upserted into `leaderboard_snapshots`. Leak-safety
argument: raw dollars never cross the user's own trust boundary - the DB never
holds anything finer than the bucket, so no server bug, view mis-grant, or
policy drift can widen what a friend sees. A DB view or edge fn computing from
raw tables would create a live server-side path from balances to
friend-visible output; here the only cross-user-readable artifact is a coarse
integer the owner wrote about themselves.

- **goal_progress**: `savings_goals.current_amount / target_amount` (columns
  verified in `src/integrations/supabase/types.ts` ~line 1508), best goal,
  rounded to 5% buckets.
- **savings_streak**: consecutive weeks of non-negative net-worth delta from
  `net_worth_snapshots` via `src/lib/net-worth-trend.ts` /
  `useNetWorthSnapshotRecorder.ts`; integer weeks, display cap 104.
- **debt_payoff**: % of peak revolving balance paid down, from
  `src/lib/net-worth.ts` aggregation (`nonCardLiabilityTotal`,
  `aggregateNetWorth`) and `src/lib/revolving-payoff.ts`; 5% buckets.
- **budget_adherence**: share of budget categories at-or-under budget this
  month, from `budget_items` data already consumed by
  `src/pages/BudgetControl.tsx`; 5% buckets.

New pure module `src/lib/leaderboard-metrics.ts` (unit-testable, no I/O);
publisher in a `useLeaderboardShares` hook, writing at most once per week per
metric (the `(user_id, metric, week)` unique key enforces cadence server-side).

Spoofability of self-reported buckets is accepted: social feature, not a
financial rail; the CHECK constraint clamps range.

## 4. Phased slices (each = one executor brief)

**Phase 0 - schema + RLS + tests.** Files:
`supabase/migrations/20260826_friend_links.sql` only. Do NOT touch
`20260825_partner_links.sql`, any existing policy, or `useSupabaseData.ts`.
Evidence: new test `src/hooks/__tests__/friendLinks.rls.test.ts` (mirror the
RLS-assertion style of `usePartnerLink.test.tsx`) proving: unlinked user sees
zero snapshots; linked-but-not-opted-in sees zero; revoked link sees zero;
owner cannot write another user's snapshot; `invite_code_hash` unreadable.
Plus Supabase advisors clean after apply. REMEMBER: applied migration + types
regen (`src/integrations/supabase/types.ts`) land in the SAME commit.

**Phase 1 - invite/consent plumbing + Settings UI.** Files:
`supabase/functions/friend-link/` (clone of `partner-link/`),
`supabase/config.toml` entry, `src/hooks/useFriendLink.ts` (mirror
`usePartnerLink.ts`: explicit columns, timeout-raced invokes, cache purge on
revoke, never lensed through `viewedUserId`),
`src/components/settings/FriendLink.tsx` rendered beside `<PartnerLink />` at
`src/pages/Settings.tsx:638`. Do NOT touch `ViewedProfileContext` - friends get
no viewing lens, ever. Test: `useFriendLink.test.tsx` incl. uniform-404 and
no-oracle assertions.

**Phase 2 - metric computation + opt-in.** Files:
`src/lib/leaderboard-metrics.ts` + `__tests__` (pin: every output in
{0,5,...,100} or integer weeks; property test that +/-$1 input change moves
output by 0 or one bucket), `useLeaderboardShares.ts` (toggles + weekly
publisher), opt-in toggles inside `FriendLink.tsx`. Do NOT touch forecast
engine or `useCardProjection.ts` internals - read their outputs only.

**Phase 3 - leaderboard UI.** Files:
`src/components/dashboard/FriendsLeaderboard.tsx` (or a Settings-adjacent
page), display names via `friend-link` status. States: no friends, friend
sharing nothing ("private" row), stale week. Test: renders zero data for
revoked/non-opted friends given mocked query results.

**Gating (one-line):** ship friends FREE-TIER - for the 18-26 car-enthusiast
audience the invite email is the acquisition loop and paywalling it kills
virality; partner (full read lens) stays the premium anchor. Encode as
`const FREE_TIER_FRIEND_CAP = 5` checked in the `friend-link` invite handler
(premium = `Infinity`); flipping later needs no schema or UI change.

## 5. Risks + nastiest abuse case

**Nastiest: metric inference.** A friend who knows your goal target converts
each `goal_progress` step into dollars; with fine granularity and frequent
updates they reconstruct contribution size and timing -> paydays -> income.
Mitigation is triple: 5% buckets, weekly write cadence enforced by the
`(user_id, metric, week)` unique key (no intra-week movement to
time-correlate), and no absolute values or targets anywhere in the schema.
Residual risk is one coarse delta per week - accepted.

Others: enumeration/oracle (inherit partner-link disciplines); RLS drift
(additive-only, snapshots-table-only); stale cache after revoke (mirror
`usePartnerLink` purge); invite spam (rate limit + pending unique index +
friend cap).

## 6. Open product forks for Tre
None. Free-with-cap gating, friends-only leaderboard (no public boards yet),
5% buckets, weekly cadence, masked-email fallback - all decided, each
reversible in one file.

## Critical template files
- supabase/migrations/20260825_partner_links.sql (Phase 0 template)
- supabase/functions/partner-link/index.ts (friend-link template)
- src/hooks/usePartnerLink.ts (useFriendLink template)
- src/pages/Settings.tsx:638 (UI mount point)
- src/lib/net-worth.ts, src/lib/revolving-payoff.ts (metric inputs)
