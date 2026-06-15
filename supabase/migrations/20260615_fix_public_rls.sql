-- F1 (CRITICAL): Drop the overly-broad profiles public SELECT policy.
-- This policy exposed the entire profiles row (income, tax rate, 401k, HSA deductions,
-- device trust list, etc.) to any anonymous caller who queried via the anon key.
DROP POLICY IF EXISTS "Public can view display_name of shared build owners" ON public.profiles;

-- F1: Security barrier view — restricts anon access to display_name only.
-- security_barrier prevents predicate push-down leakage from WHERE clauses.
CREATE VIEW public.public_build_owner_names
  WITH (security_barrier = true) AS
  SELECT p.user_id, p.display_name
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.car_builds cb
    WHERE cb.user_id = p.user_id AND cb.share_token IS NOT NULL
  );

GRANT SELECT ON public.public_build_owner_names TO anon;
GRANT SELECT ON public.public_build_owner_names TO authenticated;

-- F2 (HIGH): Drop public RLS policies that allow full enumeration of shared builds.
-- The old policies only checked `share_token IS NOT NULL`, not that the requester
-- knows the token. Anyone with the anon key could enumerate all builds and their tokens.
-- Public build access is now routed through the `public-build` Edge Function, which
-- validates the exact token server-side using the service role.
DROP POLICY IF EXISTS "Public can view shared builds" ON public.car_builds;
DROP POLICY IF EXISTS "Public can view phases of shared builds" ON public.car_build_phases;
DROP POLICY IF EXISTS "Public can view items of shared builds" ON public.car_build_items;

-- F3: Track the share_token column that was applied directly to the live DB
-- without a migration file (schema drift from the 2026-06-12 car builds session).
ALTER TABLE public.car_builds ADD COLUMN IF NOT EXISTS share_token uuid;

CREATE INDEX IF NOT EXISTS idx_car_builds_share_token
  ON public.car_builds (share_token)
  WHERE share_token IS NOT NULL;
