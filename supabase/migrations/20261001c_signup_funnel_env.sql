-- Tell real visitors from our own test runs in the sign-up funnel (2026-10-01, Ada).
--
-- WHY: check:signup-funnel and the desks' localhost walks insert into this PRODUCTION table, and a
-- row carried nothing that said where it came from. Measured 2026-10-01: 84 signup_completed rows in
-- two days, in hour-long bursts, while auth.users gained ZERO real users after 2026-08-07 - so the
-- table could not answer "where do real visitors drop off".
--
-- env: 'prod'    the client ran on getforgenta.com (web, and the native apps, which load it)
--      'dev'     any other host: localhost, a LAN address, a Vercel preview
--      'unknown' every row written before this column existed - it cannot be told apart now
-- Old clients send no env and get the default 'prod'; the new client always sends it.
--
-- UNDO: alter table public.signup_funnel_events drop column env;

alter table public.signup_funnel_events add column if not exists env text;
update public.signup_funnel_events set env = 'unknown' where env is null;
alter table public.signup_funnel_events alter column env set default 'prod';
alter table public.signup_funnel_events alter column env set not null;
alter table public.signup_funnel_events add constraint signup_funnel_events_env_check
  check (env in ('prod', 'dev', 'unknown'));
