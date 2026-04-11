-- Phase 3.2: Per-account APY rate for investment/retirement growth projection
-- Also tracks when 401k balance was last auto-updated from paycheck contributions

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS apy_rate NUMERIC DEFAULT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_401k_update DATE DEFAULT NULL;

COMMENT ON COLUMN public.accounts.apy_rate      IS 'Annual percentage yield for investment/retirement accounts. NULL = use global forecast assumption.';
COMMENT ON COLUMN public.profiles.last_401k_update IS 'Date when 401k balance was last auto-updated from paycheck deduction contributions.';
