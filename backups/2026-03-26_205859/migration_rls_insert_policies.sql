-- Backup record: migration applied 2026-03-26_205859
-- Migration name: rls_insert_ownership_policies
-- Scope: Enable RLS + add INSERT ownership policies on 12 user-data tables.
--        Remove true-based policies on user_subscriptions.
--        No SELECT/UPDATE/DELETE policies added or modified.
--        subscription_tiers untouched.
--
-- To reverse a specific table:
--   DROP POLICY IF EXISTS "insert_own" ON public.<table>;
--   -- (RLS disable is destructive — only do if you had it off before)
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;

-- accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.accounts;
CREATE POLICY "insert_own" ON public.accounts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- assets
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.assets;
CREATE POLICY "insert_own" ON public.assets
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- budget_items
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.budget_items;
CREATE POLICY "insert_own" ON public.budget_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- car_funds
ALTER TABLE public.car_funds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.car_funds;
CREATE POLICY "insert_own" ON public.car_funds
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- debts
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.debts;
CREATE POLICY "insert_own" ON public.debts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- liabilities
ALTER TABLE public.liabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.liabilities;
CREATE POLICY "insert_own" ON public.liabilities
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.profiles;
CREATE POLICY "insert_own" ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- recurring_rules
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.recurring_rules;
CREATE POLICY "insert_own" ON public.recurring_rules
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- savings_goals
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.savings_goals;
CREATE POLICY "insert_own" ON public.savings_goals
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.subscriptions;
CREATE POLICY "insert_own" ON public.subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insert_own" ON public.transactions;
CREATE POLICY "insert_own" ON public.transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- user_subscriptions: drop true-based policies, add INSERT ownership only
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_subscriptions'
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_subscriptions', pol.policyname);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "insert_own" ON public.user_subscriptions;
CREATE POLICY "insert_own" ON public.user_subscriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
