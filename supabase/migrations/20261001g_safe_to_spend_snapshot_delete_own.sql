-- A user may delete their own Safe to Spend snapshot (ask 1dc2c388).
-- 20261001f left DELETE out ("the row goes with the account"). Two reasons to allow it after all:
-- the figure is the user's own derived data, so removing it should not need an account deletion;
-- and check:money-glance plants a row on the walk account and must be able to clear it, or its
-- 404 arm fails on every run after the first.
begin;

grant delete on public.safe_to_spend_snapshot to authenticated;

create policy safe_to_spend_snapshot_delete_own on public.safe_to_spend_snapshot
  for delete to authenticated using (user_id = (select auth.uid()));

commit;
