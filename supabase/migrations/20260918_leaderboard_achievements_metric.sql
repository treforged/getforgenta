-- Achievement count as a FIFTH leaderboard metric.
--
-- Tre, ask 07150518, part 3: "add to leaderboard the ranking of people based on how many
-- achievements they have".
--
-- ⚠️ WHY THIS IS A METRIC AND NOT A COLUMN ON `follow_profiles()`.
-- Measured 2026-09-18 with pg_get_functiondef: `follow_profiles()` is gated on the FOLLOW EDGE
-- ALONE - it carries no reference to `leaderboard_shares` - so a count added there would be
-- published to everyone you follow or who follows you with NO WAY TO OPT OUT, while every other
-- number this app shows a friend is default-off, per-metric, explicit opt-in. That would have been
-- a privacy regression wearing the clothes of "the narrow door that already exists".
--
-- ⚠️ AND WHY THE `achievements` TABLE'S RLS IS UNTOUCHED.
-- `achievements_select_own` stays `user_id = auth.uid()`. Opening it would expose WHICH badges a
-- person holds - several are money-shaped - when the feature needs only HOW MANY. The count
-- travels as a bucket in `leaderboard_snapshots`, which already has the friend-and-opted-in-and-
-- this-week policy the other four metrics rely on. No new read path is created.
--
-- ⚠️ A COUNT, NOT A PERCENTAGE, AND THE CODEBASE ALREADY SAID SO.
-- `achievements.ts` records that only lessons are countable: "social badges are a fixed pair, and
-- `og_founder` is a cohort nobody can decide to join. A progress figure over the others would
-- invent a denominator." So this follows `savings_streak` - a raw count inside the existing
-- 0..520 `bucket_range` - rather than the 5-multiple percentage the other three use.
--
-- REVERSIBLE: re-run either statement with the original four-element array to undo.

alter table public.leaderboard_shares
  drop constraint leaderboard_shares_metric;

alter table public.leaderboard_shares
  add constraint leaderboard_shares_metric
  check (metric = any (array['goal_progress','savings_streak','debt_payoff','budget_adherence','achievements']));

alter table public.leaderboard_snapshots
  drop constraint leaderboard_snapshots_metric;

alter table public.leaderboard_snapshots
  add constraint leaderboard_snapshots_metric
  check (metric = any (array['goal_progress','savings_streak','debt_payoff','budget_adherence','achievements']));
