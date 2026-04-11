-- Phase 3.1 addendum: flat vs percentage mode per deduction
-- Rename 401k column to a generic "value" name since it can now hold either flat $ or pct
ALTER TABLE public.profiles RENAME COLUMN deduction_401k_pct TO deduction_401k_value;

-- Mode columns: 'pct' (% of gross per paycheck) or 'flat' ($/paycheck)
-- 401k defaults pct (existing behavior), others default flat (existing behavior)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deduction_401k_mode   TEXT DEFAULT 'pct'  NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_hsa_mode    TEXT DEFAULT 'flat' NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_fsa_mode    TEXT DEFAULT 'flat' NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_medical_mode TEXT DEFAULT 'flat' NOT NULL;

COMMENT ON COLUMN public.profiles.deduction_401k_value     IS 'Amount — interpreted as pct of gross or flat $/check depending on deduction_401k_mode';
COMMENT ON COLUMN public.profiles.deduction_401k_mode      IS '''pct'' = % of gross per paycheck; ''flat'' = flat $ per paycheck';
COMMENT ON COLUMN public.profiles.deduction_hsa_mode       IS '''pct'' = % of gross per paycheck; ''flat'' = flat $ per paycheck';
COMMENT ON COLUMN public.profiles.deduction_fsa_mode       IS '''pct'' = % of gross per paycheck; ''flat'' = flat $ per paycheck';
COMMENT ON COLUMN public.profiles.deduction_medical_mode   IS '''pct'' = % of gross per paycheck; ''flat'' = flat $ per paycheck';
