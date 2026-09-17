-- ─────────────────────────────────────────────────────────────────────────────
-- MOVE THE REFUSAL FROM THE FUNCTION BODY TO THE GRANT.
--
-- The security advisor flags both functions added by 20260917_follows_and_visibility.sql
-- as `anon_security_definer_function_executable`. Measured against the live REST surface
-- 2026-09-17, with two controls that prove the probe discriminates:
--
--     anon -> request_follow            400  {"code":"P0001","message":"not signed in"}
--     anon -> find_profile_by_username  200  []      (even for `drforged`, which EXISTS)
--     CONTROL leaderboard_global_stats  401  permission denied   <- anon genuinely blocked
--     CONTROL no_such_fn_xyz            404                      <- a bad name looks different
--
-- So both are REACHABLE by anon and both REFUSE, and no data crosses. This migration is
-- defence in depth, not a leak being closed.
--
-- ⚠️ WHY THE ORIGINAL MIGRATION'S `revoke all ... from public` DID NOT DO THIS ALREADY,
-- because the next person will otherwise read that line and conclude anon was covered.
-- Measured, not assumed — `proacl` on both functions reads:
--
--     postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- `anon=X` is a DIRECT grant, written by Supabase's ALTER DEFAULT PRIVILEGES on schema
-- public whenever a function is created. Revoking from the PUBLIC pseudo-role does not
-- touch a direct grant to a named role. Only naming `anon` removes it.
--
-- The guard inside each body stays. This is the second lock, not a replacement: an edit to
-- `if v_me is null then raise` can silently remove the first one, and an edit to the body
-- cannot remove a grant.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function public.request_follow(uuid)            from anon;
revoke execute on function public.find_profile_by_username(text)  from anon;

-- ⚠️ THE ADVISOR WILL STILL FLAG BOTH FUNCTIONS AFTER THIS, AND THAT IS CORRECT.
-- Its check is "a SECURITY DEFINER function is executable by a client role", and
-- `authenticated` is a client role. These functions EXIST to be called by signed-in
-- users, so that half cannot go away without deleting the feature. Do not chase it to
-- zero; a warning that cannot be cleared is one people stop reading.

-- ── UNDO ─────────────────────────────────────────────────────────────────────
-- grant execute on function public.request_follow(uuid)           to anon;
-- grant execute on function public.find_profile_by_username(text) to anon;
