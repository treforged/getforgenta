-- Add columns to profiles for cross-device persistence
-- forecast_assumptions: stores Forecast page assumption settings (was localStorage only)
-- ui_preferences: stores UI collapse/expand states (was localStorage only)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS forecast_assumptions JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ui_preferences JSONB DEFAULT NULL;
