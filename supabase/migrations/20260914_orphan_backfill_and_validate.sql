-- Removes the orphan rows left behind by accounts deleted BEFORE
-- 20260914_cascade_delete_user_data.sql put the guarantee in the database,
-- then promotes those constraints from NOT VALID to fully validated.
--
-- Tre approved this half explicitly, 2026-09-14: "delete those existing orphan
-- rows after snapshotting them." The order was not negotiable and is recorded
-- here because the order IS the safety.
--
-- 1. SNAPSHOT FIRST, to a service-role-only schema:
--      create schema orphan_backup_20260914;
--      revoke all on schema orphan_backup_20260914 from anon, authenticated, public;
--      create table orphan_backup_20260914.profiles        as select * from public.profiles        x where not exists (select 1 from auth.users u where u.id = x.user_id);
--      create table orphan_backup_20260914.recurring_rules as select * from public.recurring_rules x where not exists (select 1 from auth.users u where u.id = x.user_id);
--
--    Proven BEFORE any delete, by content and not by row count - a count can
--    match while the copy is wrong:
--      profiles        md5 78a1b8f3e9d7e0b2d9b217ddd938c612  snapshot == live
--      recurring_rules md5 0d4a9111f3fdd0b0b9a94449420d71dc  snapshot == live
--      anon USAGE = false, authenticated USAGE = false, 0 table grants to either.
--
-- 2. THEN the delete: 18 profiles, 90 recurring_rules. 108 rows, which is the
--    measured figure - the ask said 110.
--
-- 3. THEN re-read the snapshot as a SEPARATE step, because a verifier that
--    finishes before the thing it verifies has not verified anything:
--      18 / 90 still present, both md5 values UNCHANGED.
--      public.profiles 49 -> 31, public.recurring_rules 436 -> 346.
--      Orphans remaining across all 11 tables: 0.
--
-- KEPT, per Tre's carve-out in the same message - a purchase or billing record
-- stays for our records:
--   user_subscriptions  2 rows, already anonymised (user_id null, anonymized_at
--                       stamped by delete-account). Not snapshotted, not
--                       deleted, and deliberately carries no cascade.
-- Every other FK-less table measured 0 orphans, so nothing else was touched.
--
-- RESTORE, if the snapshot is ever needed:
--   insert into public.profiles        select * from orphan_backup_20260914.profiles;
--   insert into public.recurring_rules select * from orphan_backup_20260914.recurring_rules;
--   (the auth.users rows are gone, so the validated FK will refuse them until
--   those users are recreated - that refusal is the constraint working.)

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'assets', 'budget_items', 'car_funds', 'debts',
    'liabilities', 'profiles', 'recurring_rules',
    'savings_goals', 'subscriptions', 'transactions'
  ] loop
    execute format('alter table public.%I validate constraint %I', t, t || '_user_id_fkey');
  end loop;
end $$;
