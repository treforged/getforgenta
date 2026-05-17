ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS autopay_full_balance boolean NOT NULL DEFAULT false;
