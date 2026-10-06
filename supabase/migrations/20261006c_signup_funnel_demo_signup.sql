-- The demo's way out (e1b0fffc, 2026-10-06): count presses on the demo banner's "Sign Up Free".
-- try_demo already counts who ENTERS the demo; nothing counted who LEFT it to sign up, so
-- whether the demo converts anyone could not be answered. Adds 'demo_signup_tap' to the closed
-- list of steps. Nothing else changes: still INSERT-only for anon, no account, name or email.
-- READ: select platform, count(*) filter (where step='try_demo') entered,
--              count(*) filter (where step='demo_signup_tap') left_to_sign_up
--       from signup_funnel_events where env = 'prod' group by 1;
-- UNDO: delete the demo_signup_tap rows, then re-add the constraint without it.

alter table public.signup_funnel_events drop constraint if exists signup_funnel_events_step_check;
alter table public.signup_funnel_events add constraint signup_funnel_events_step_check check (step in (
  'app_opened', 'welcome_shown', 'signup_form_shown',
  'tap_email', 'tap_google', 'tap_apple',
  'auth_error', 'confirm_email_shown', 'signup_completed', 'try_demo',
  'landing_viewed', 'tap_store', 'demo_signup_tap'));
