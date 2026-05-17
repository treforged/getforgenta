ALTER TABLE public.accounts DROP COLUMN IF EXISTS autopay_full_balance;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS payment_preference text CHECK (payment_preference IN ('statement', 'full')) DEFAULT NULL;
