-- Count the new "Try it first" button on the sign-in welcome screen (ask 4180a9dd).
-- Adds 'try_demo' to the closed list of steps. Nothing else changes: still INSERT-only for anon.
-- UNDO: re-add the constraint without 'try_demo' (delete any try_demo rows first).

alter table public.signup_funnel_events drop constraint if exists signup_funnel_events_step_check;
alter table public.signup_funnel_events add constraint signup_funnel_events_step_check check (step in (
  'app_opened', 'welcome_shown', 'signup_form_shown',
  'tap_email', 'tap_google', 'tap_apple',
  'auth_error', 'confirm_email_shown', 'signup_completed', 'try_demo'));
