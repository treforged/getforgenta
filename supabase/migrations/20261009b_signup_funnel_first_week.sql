-- FIRST-WEEK FUNNEL (proposal G, Tre "yes" via Sam, 2026-10-09). The funnel stopped at
-- signup_completed, so nothing said whether a new account finished setup, saved anything or came
-- back. Adds three steps to the closed list; the client sends them from src/lib/first-week-funnel.ts,
-- once per account per device, during the first 7 days, with detail = 'd0'..'d6' (days since
-- signup; first_transaction prefixes the source, e.g. 'manual_d1'). Still INSERT-only for anon,
-- no account, name or email. The list must match FUNNEL_STEPS in src/lib/signup-funnel.ts
-- (signup-funnel.steps.test.ts checks it).
-- READ: select step, detail, count(*) from signup_funnel_events
--       where env = 'prod' and step in ('signup_completed','onboarding_finished','first_transaction','returned_day2')
--       group by 1, 2 order by 1, 2;
-- UNDO: delete the three steps' rows, then re-add the constraint from 20261006c_signup_funnel_demo_signup.sql.

alter table public.signup_funnel_events drop constraint if exists signup_funnel_events_step_check;
alter table public.signup_funnel_events add constraint signup_funnel_events_step_check check (step in (
  'app_opened', 'welcome_shown', 'signup_form_shown',
  'tap_email', 'tap_google', 'tap_apple',
  'auth_error', 'confirm_email_shown', 'signup_completed', 'try_demo',
  'landing_viewed', 'tap_store', 'demo_signup_tap',
  'onboarding_finished', 'first_transaction', 'returned_day2'));
