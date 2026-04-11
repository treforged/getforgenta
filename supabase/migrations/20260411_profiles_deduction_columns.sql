-- Phase 3.1: Pre-tax deduction columns for paycheck net calculation
-- These are per-paycheck amounts/percentages stored on the profile
-- Applied before income tax: net = (gross - pretax_deductions) * (1 - tax_rate/100)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deduction_401k_pct  NUMERIC DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_hsa       NUMERIC DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_fsa       NUMERIC DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS deduction_medical   NUMERIC DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.profiles.deduction_401k_pct IS '401k contribution as % of gross per paycheck (e.g. 6 = 6%)';
COMMENT ON COLUMN public.profiles.deduction_hsa      IS 'HSA flat deduction per paycheck in dollars';
COMMENT ON COLUMN public.profiles.deduction_fsa      IS 'FSA flat deduction per paycheck in dollars';
COMMENT ON COLUMN public.profiles.deduction_medical  IS 'Medical insurance flat deduction per paycheck in dollars';
