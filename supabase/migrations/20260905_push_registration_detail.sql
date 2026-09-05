-- The provider's own error text, and the reason it was missing.
--
-- ⚠️ A `registrationError` PAYLOAD WAS BEING DISCARDED. `push-registration.ts` handled the event
-- with `finish('error', null)` — the callback's argument was never read — so a real APNs refusal
-- was recorded as a bare `registration_error` with no message. Apple's string usually names the
-- cause outright, and a full day was spent inferring what it would have said.
--
-- Kept verbatim and truncated. `detail` is REPLACED on every write rather than coalesced, because
-- it belongs to the CURRENT outcome: a row that has moved on to `registered` must not still be
-- showing yesterday's error.

alter table public.push_registration_status add column if not exists detail text;

comment on column public.push_registration_status.detail is
  'The provider''s own error text for a registration_error, verbatim and truncated.';

create or replace function public.record_push_registration(
  p_platform    text,
  p_outcome     text,
  p_prompted    boolean default false,
  p_app_version text default null,
  p_app_build   text default null,
  p_detail      text default null
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;

  insert into public.push_registration_status
    (user_id, platform, outcome, prompted, app_version, app_build, detail)
  values (v_user, p_platform, p_outcome, coalesce(p_prompted, false), p_app_version, p_app_build, p_detail)
  on conflict (user_id, platform) do update
    set outcome      = excluded.outcome,
        prompted     = public.push_registration_status.prompted or excluded.prompted,
        attempts     = public.push_registration_status.attempts + 1,
        last_seen_at = now(),
        app_version  = coalesce(excluded.app_version, public.push_registration_status.app_version),
        app_build    = coalesce(excluded.app_build,   public.push_registration_status.app_build),
        detail       = excluded.detail;
end;
$fn$;

-- The five-argument version goes, for the same reason the three-argument one did: an overload left
-- standing is a client still writing rows without the new field, invisibly.
drop function if exists public.record_push_registration(text, text, boolean, text, text);
revoke all on function public.record_push_registration(text, text, boolean, text, text, text) from public, anon;
grant execute on function public.record_push_registration(text, text, boolean, text, text, text) to authenticated;
