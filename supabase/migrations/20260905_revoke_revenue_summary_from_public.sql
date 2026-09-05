-- Stop an anonymous stranger reading the business's subscriber counts.
--
-- ── THE LEAK, CONFIRMED WITH A REAL REQUEST (2026-09-05) ─────────────────────
-- `public.revenue_summary_lines()` is SECURITY DEFINER and carried an EXECUTE grant to
-- PUBLIC (`=X/postgres` in its ACL), which includes `anon`. The anon key ships inside the
-- app bundle and is therefore public by design, so anyone who has ever seen the bundle
-- could POST /rest/v1/rpc/revenue_summary_lines and get HTTP 200 with the whole picture:
-- how many subscribers there are, on which provider, and how many have churned.
--
-- That is not personal data -- the function groups in SQL precisely so no per-user row
-- ever exists outside the database -- but it is the business's own numbers, and nothing
-- about the app needs a stranger to have them.
--
-- ── WHY REVOKING IS SAFE, CHECKED RATHER THAN ASSUMED ────────────────────────
-- The function has exactly ONE caller in the entire codebase:
-- `supabase/functions/revenue-push/index.ts:55`, which builds its client with
-- SUPABASE_SERVICE_ROLE_KEY and is itself gated behind a CRON_SECRET header. service_role
-- keeps its own explicit grant (`service_role=X/postgres`), so that path is untouched.
-- No marketing site, founders page or client surface calls it, anonymously or otherwise.
--
-- SECURITY DEFINER is kept deliberately. The grouping has to read `user_subscriptions`
-- across every user, which is exactly what RLS forbids, so switching to SECURITY INVOKER
-- would break the one legitimate caller. The privilege, not the definer-ness, was the bug.
--
-- Reversible in one statement if a genuine anonymous caller ever appears:
--   GRANT EXECUTE ON FUNCTION public.revenue_summary_lines() TO anon;

REVOKE EXECUTE ON FUNCTION public.revenue_summary_lines() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revenue_summary_lines() FROM anon;
REVOKE EXECUTE ON FUNCTION public.revenue_summary_lines() FROM authenticated;

-- Belt and braces: make the intent explicit rather than relying on the absence of a grant.
GRANT EXECUTE ON FUNCTION public.revenue_summary_lines() TO service_role;
