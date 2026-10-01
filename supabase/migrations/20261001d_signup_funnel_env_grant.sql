-- Let the client write the env column (2026-10-01, Ada).
--
-- WHY: 20261001c added signup_funnel_events.env, and the client began sending it, but INSERT on
-- this table is granted PER COLUMN (step, method, detail, platform). A column outside that list
-- makes PostgREST refuse the whole row with 401. Measured 2026-10-01 03:21Z: check:signup-funnel
-- sent 11 inserts, all carrying env, all refused 401 - so every funnel row from the new client,
-- prod included, was being dropped.
--
-- Same shape as the existing grants: the client may write env, and the check constraint still
-- limits it to prod / dev / unknown.
--
-- UNDO: revoke insert (env) on public.signup_funnel_events from anon, authenticated;

grant insert (env) on public.signup_funnel_events to anon, authenticated;
