-- Phase 2: Add RevenueCat fields to user_subscriptions
-- Additive only — no existing columns touched.
-- purchase_provider distinguishes billing origin for debugging and routing.

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS revenuecat_app_user_id TEXT,
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS purchase_provider TEXT DEFAULT 'stripe';

CREATE INDEX IF NOT EXISTS idx_user_subs_rc_app_user_id
  ON user_subscriptions (revenuecat_app_user_id)
  WHERE revenuecat_app_user_id IS NOT NULL;

COMMENT ON COLUMN user_subscriptions.purchase_provider IS 'stripe | apple | google';
COMMENT ON COLUMN user_subscriptions.revenuecat_app_user_id IS 'RevenueCat app user ID — equals Supabase user UUID';
COMMENT ON COLUMN user_subscriptions.apple_original_transaction_id IS 'Apple original_transaction_id from first IAP receipt';
