-- Defense-in-depth hardening found during a 2026-06-21 follow-up audit
-- (the bi-daily security review reports had not caught these).

-- 1. rate_limit_check / handle_new_user / rls_auto_enable are SECURITY
--    DEFINER functions that Supabase's default grants exposed to anon and
--    authenticated via PostgREST RPC (e.g. POST /rest/v1/rpc/rate_limit_check).
--    None of them need to be callable by clients:
--      - rate_limit_check is only ever called by edge functions using the
--        service-role client (see supabase/functions/_shared/rate-limit.ts).
--        Direct anon/authenticated access let anyone pollute or pre-exhaust
--        another IP's rate-limit bucket (key is `${ip}:<endpoint>`).
--      - handle_new_user fires as an AFTER INSERT trigger on auth.users;
--        trigger execution does not require EXECUTE grants on the calling
--        role, so revoking is functionally inert.
--      - rls_auto_enable is an event trigger function; same as above, and
--        it errors outside event-trigger context anyway.
-- New Postgres functions grant EXECUTE to PUBLIC by default, which anon and
-- authenticated inherit regardless of any direct grant/revoke on those roles
-- specifically -- the fix has to target PUBLIC, not anon/authenticated.
revoke execute on function public.rate_limit_check(text, bigint, integer) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.rls_auto_enable() from public;
grant execute on function public.rate_limit_check(text, bigint, integer) to service_role;

-- 2. Pin search_path on the two trigger functions that didn't have one set,
--    closing the standard search_path-hijack vector flagged by the linter.
alter function public.handle_new_user() set search_path = '';
alter function public.update_updated_at_column() set search_path = '';

-- 3. The "Public can view build photos" policy on storage.objects allowed
--    listing every object in the build-photos bucket (bucket_id match only,
--    no per-build/share-token scoping), exposing user_id-prefixed paths and
--    photos for builds that were never shared. The bucket's public=true flag
--    already serves known object paths via /storage/v1/object/public/... for
--    the share-page feature (src/lib/build-photos.ts uses getPublicUrl(),
--    which doesn't consult this RLS policy), and no code path calls
--    storage.list() on this bucket — so the policy is unused and unsafe.
drop policy if exists "Public can view build photos" on storage.objects;
