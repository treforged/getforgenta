-- Which BINARY produced a registration outcome.
--
-- ⚠️ THE FIELD WHOSE ABSENCE MADE 29 MEASUREMENTS USELESS. On 2026-09-05 Tre's iPhone recorded
-- 29 `timeout` attempts between 17:33Z and 19:16Z, spanning two TestFlight builds — 676, which had
-- `aps-environment: development` (wrong: a TestFlight build is distribution-signed and registers
-- against PRODUCTION APNs), and 682, which corrected it.
--
-- `push_registration_status` recorded outcome, prompted, attempts and timestamps — and no app
-- version. So **"682 is installed and still failing" and "these are more 676 attempts" were the
-- SAME ROW**, and they need opposite next steps: one means `production` was not the whole cause
-- and the hunt continues, the other means the fix has simply not reached the device yet.
--
-- That is the confident-blank shape this repo keeps finding, occurring inside the diagnostic built
-- to prevent it. A measurement that cannot be attributed to a version is not a measurement.
--
-- The upsert keeps the LATEST reported binary via `coalesce(excluded, existing)`, so a row always
-- names the build behind its CURRENT outcome, and a device that cannot report its version (an
-- older shell, a platform where `App.getInfo()` is unavailable) degrades to "unknown build"
-- rather than to no diagnosis at all.

alter table public.push_registration_status
  add column if not exists app_version text,
  add column if not exists app_build   text;

comment on column public.push_registration_status.app_build is
  'CFBundleVersion / versionCode of the binary that produced this outcome. Added 2026-09-05 '
  'because 29 timeout attempts could not be attributed to a build.';

create or replace function public.record_push_registration(
  p_platform    text,
  p_outcome     text,
  p_prompted    boolean default false,
  p_app_version text default null,
  p_app_build   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  insert into public.push_registration_status
    (user_id, platform, outcome, prompted, app_version, app_build)
  values (v_user, p_platform, p_outcome, coalesce(p_prompted, false), p_app_version, p_app_build)
  on conflict (user_id, platform) do update
    set outcome      = excluded.outcome,
        prompted     = public.push_registration_status.prompted or excluded.prompted,
        attempts     = public.push_registration_status.attempts + 1,
        last_seen_at = now(),
        app_version  = coalesce(excluded.app_version, public.push_registration_status.app_version),
        app_build    = coalesce(excluded.app_build,   public.push_registration_status.app_build);
end;
$fn$;

-- ⚠️ THE THREE-ARGUMENT VERSION IS DROPPED, NOT LEFT BESIDE THIS ONE. `create or replace` with a
-- new signature creates an OVERLOAD, and a client still calling the old shape would keep writing
-- rows with no build — the exact ambiguity this migration exists to end, surviving invisibly.
drop function if exists public.record_push_registration(text, text, boolean);

revoke all on function public.record_push_registration(text, text, boolean, text, text) from public, anon;
grant execute on function public.record_push_registration(text, text, boolean, text, text) to authenticated;
