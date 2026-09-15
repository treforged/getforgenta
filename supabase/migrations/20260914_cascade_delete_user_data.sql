-- Deleted accounts must not leave financial data behind.
--
-- WHY. Eleven public BASE TABLES carry `user_id` and had NO foreign key to
-- auth.users, so deleting an auth user by ANY route other than the
-- delete-account edge function left every row in place. Measured 2026-09-14
-- against production: 108 orphan rows survived that way - 18 `profiles`
-- (display_name, monthly_income_default, deductions) and 90 `recurring_rules`
-- (bill names and amounts). The edge function was not at fault; it deletes
-- these tables explicitly. The hole is every OTHER deletion path - the
-- Supabase dashboard, the auth admin API, a future script - and a rule that
-- lives only in one TypeScript array cannot cover those.
--
-- So the guarantee moves into the database, where it binds every path.
--
-- WHAT IS DELIBERATELY NOT CASCADED, and why:
--   user_subscriptions - the purchase/billing record. Tre, 2026-09-14: if they
--     bought a plan, that record stays for our records. delete-account already
--     severs the personal link by nulling user_id and stamping anonymized_at;
--     a cascade here would destroy the retained record instead.
--
-- `plaid_items` is NOT in the list and must not be: it is a VIEW, not a table.
-- A first pass included it, derived from information_schema.columns, which does
-- not distinguish the two - and the migration failed loudly rather than
-- silently, which is the only reason it was caught. The list here is derived
-- from pg_class with relkind='r'.
--
-- NOT VALID is deliberate. It enforces the rule on every FUTURE delete without
-- checking the rows already present, so this migration cannot fail on the 108
-- existing orphans and does not delete them. Removing those is a separate,
-- irreversible act that is snapshotted and approved on its own. After that
-- backfill, each constraint is promoted with:
--     alter table public.<t> validate constraint <t>_user_id_fkey;
--
-- UNDO, complete and one statement per table:
--     alter table public.<t> drop constraint <t>_user_id_fkey;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'assets', 'budget_items', 'car_funds', 'debts',
    'liabilities', 'profiles', 'recurring_rules',
    'savings_goals', 'subscriptions', 'transactions'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_user_id_fkey'
        and conrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (user_id) '
        || 'references auth.users(id) on delete cascade not valid',
        t, t || '_user_id_fkey'
      );
    end if;
  end loop;
end $$;
