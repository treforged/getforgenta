-- The friends board emptied every Sunday night, and called sharing friends "Private" while it did.
--
-- ⚠️ MEASURED LIVE, 2026-09-14 01:10 UTC — which was 21:10 SUNDAY for Tre. `date_trunc('week',
-- now())` had already rolled to 2026-09-14; the newest snapshot in the table was week 2026-09-07;
-- rows matching the policy's week: ZERO. So at nine on a Sunday evening his leaderboard went blank,
-- and stays blank for each friend until THAT friend personally reopens the app and the publisher
-- writes a row for the new week.
--
-- ⚠️ AND IT DID NOT GO BLANK HONESTLY. `buildLeaderboardRows` has three states: `value`, `stale`
-- ("Not updated this week") and `private` ("Private"). `stale` fires when the newest snapshot is
-- from an earlier week — but the OLD policy returned only current-week rows, so an older row never
-- reached the client and the friend fell through to the no-snapshot branch. The board therefore
-- said **"Private"** about somebody who is sharing and simply had not opened the app since Sunday.
-- A wrong claim about another person's privacy choice is worse than an empty row, and the UI state
-- built to tell the truth here was UNREACHABLE.
--
-- ⚠️ THIS WIDENS FRESHNESS, NOT CONSENT, and the distinction is the whole justification:
--   * `user_id IN active_friend_ids()` — UNCHANGED. Still friends only.
--   * `is_metric_shared(user_id, metric)` — UNCHANGED, and evaluated LIVE. Someone who switches a
--     metric off disappears immediately, including their older rows. Opting out is still retroactive.
--   * the WEEK window is the only thing that moves, from "this week" to "the last four weeks".
-- Nothing new is exposed about anyone who has not opted in; a person who opted in is shown the same
-- rounded bucket they already agreed to share, with the app saying plainly that it is not current.
--
-- FOUR WEEKS, CHOSEN NOT MEASURED. Long enough to survive a fortnight away from the app, short
-- enough that a number nobody has refreshed in over a month stops being presented at all rather
-- than ageing silently. There is no participation data to tune against - one user shares today.
--
-- UNDO: restore the previous predicate, which was
--   (week = (date_trunc('week', now()))::date)
-- in place of the range below. No row is written or altered by this migration.

drop policy if exists leaderboard_snapshots_select_friend on public.leaderboard_snapshots;

create policy leaderboard_snapshots_select_friend
  on public.leaderboard_snapshots
  for select
  to authenticated
  using (
    user_id in (select public.active_friend_ids())
    and public.is_metric_shared(user_id, metric)
    and week <= (date_trunc('week', now()))::date
    and week >= (date_trunc('week', now()))::date - interval '28 days'
  );
