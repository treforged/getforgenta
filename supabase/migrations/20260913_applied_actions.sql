-- A durable record of an action that was applied, and exactly how to reverse it.
--
-- WHY THIS EXISTS. Tre, 2026-09-12: "There's no easy way to undo this action." He was right,
-- and the reason is worth stating precisely because the app LOOKED like it had undo. It had
-- three, and every one of them lived in React state:
--   * `DecisionDeck.undoAll`      - end screen only, whole run, offered once
--   * `MerchantMemoryPanel.undo`  - holds the applied pass in `useState`
--   * confirming a link           - no undo at all; the write overwrites and the prior value is gone
-- Navigate away, reload, or close the tab and all three evaporate. The batch panel's own copy
-- promises the user it "undoes in one press", which is true only while he is looking at it.
--
-- ⚠️ AND THAT IS WHY THIS TABLE BLOCKS THE AUTO-APPLY WORK RATHER THAN FOLLOWING IT. Tre asked
-- for the confirmation prompts to go away and for the app to just act. But the prompt is the only
-- reason the in-memory undo is reachable: it puts him in front of the component that holds it.
-- Auto-apply happens when he is NOT watching - that is its entire purpose - so shipping it against
-- a `useState` undo would remove a prompt he dislikes AND silently remove the reversibility its
-- own copy promises. The app would be quietly lying. Durable first, then auto-apply.
--
-- WHY IT STORES THE UNDO PLAN RATHER THAN THE FORWARD ACTION. Reconstructing "what would reverse
-- this" later means re-deriving it from state that has since moved on - the exact mistake that
-- made the $15 link unrecoverable, where the prior value was simply overwritten and no longer
-- existed anywhere. The plan is computed at apply time, when the previous values are still known,
-- and stored verbatim. Undo then becomes a replay, not an inference.
--
-- WHY NOTHING IS EVER DELETED HERE. `undone_at` marks a reversal; the row stays. A table that
-- erases its own history cannot answer "what happened to this charge", which is the question a
-- user asks precisely when something looks wrong.

create table if not exists public.applied_actions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- 'deck_decision' | 'merchant_retro_pass' | 'link_confirm'. Text rather than an enum so a new
  -- kind does not need a migration; the client is the only thing that reads it.
  kind       text        not null,
  -- What to show a human: "Categorized 28 charges from merchants you have labeled before".
  label      text        not null,
  -- The reversal plan, computed at apply time. Shape belongs to the client that wrote it.
  steps      jsonb       not null,
  created_at timestamptz not null default now(),
  -- NULL means still reversible. Set, never cleared.
  undone_at  timestamptz
);

comment on table public.applied_actions is
  'One row per applied action, carrying the plan that reverses it. See the 20260913 migration header.';

-- Offering "undo" means listing a user's recent, not-yet-undone actions, newest first.
create index if not exists applied_actions_user_recent_idx
  on public.applied_actions (user_id, created_at desc)
  where undone_at is null;

alter table public.applied_actions enable row level security;

-- ⚠️ THE DEFAULT PUBLIC-SCHEMA ACL GRANTS ALL TO anon AND authenticated, so a table created
-- without this is readable and writable by anyone holding the anon key that ships in the app
-- bundle - the same class of mistake as the `revenue_summary_lines` leak. Revoke first, then
-- grant back only what the client genuinely needs.
revoke all on public.applied_actions from anon, authenticated;
grant select, insert, update on public.applied_actions to authenticated;

-- ⚠️ NO DELETE IS GRANTED, deliberately. See the header: a reversal is a mark, not an erasure.

create policy applied_actions_select_own on public.applied_actions
  for select using ((select auth.uid()) = user_id);

create policy applied_actions_insert_own on public.applied_actions
  for insert with check ((select auth.uid()) = user_id);

-- ⚠️ THE `with check` IS WHAT STOPS A ROW BEING REASSIGNED TO ANOTHER USER. `using` alone decides
-- which rows may be targeted; without the check an owner could UPDATE their own row's `user_id`
-- to somebody else's and park an action in their history.
create policy applied_actions_update_own on public.applied_actions
  for update using ((select auth.uid()) = user_id)
          with check ((select auth.uid()) = user_id);

-- ⚠️ `(select auth.uid())` RATHER THAN A BARE `auth.uid()`: the bare call is re-evaluated PER ROW
-- (the `auth_rls_initplan` advisor flags 87 of these across this database). Wrapped in a subselect
-- Postgres evaluates it once per statement. Negligible on a small table and material on a large
-- one; written correctly here so this table never joins that backlog.
