-- Landing-to-download conversion (ask 4f473837): count landing views and store-badge taps.
-- Adds 'landing_viewed' and 'tap_store' to the closed list of steps. `detail` on tap_store is
-- 'app_store' or 'play_store' (already constrained to ^[a-z0-9_]{0,40}$). Nothing else changes:
-- still INSERT-only for anon, no account, name or email on any row.
-- READ: select step, detail, count(*), count(distinct install_id) from signup_funnel_events
--       where env = 'prod' and step in ('landing_viewed','tap_store') group by 1, 2;
-- UNDO: delete the landing_viewed/tap_store rows, then re-add the constraint without them.

alter table public.signup_funnel_events drop constraint if exists signup_funnel_events_step_check;
alter table public.signup_funnel_events add constraint signup_funnel_events_step_check check (step in (
  'app_opened', 'welcome_shown', 'signup_form_shown',
  'tap_email', 'tap_google', 'tap_apple',
  'auth_error', 'confirm_email_shown', 'signup_completed', 'try_demo',
  'landing_viewed', 'tap_store'));
