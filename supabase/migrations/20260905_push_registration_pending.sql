-- `pending`: an attempt is visible while it is still an attempt.
--
-- ⚠️ THIS EXISTS BECAUSE A FIX OF MINE MADE THE PREVIOUS TEST UNMEASURABLE. At 22:23:36Z the
-- registration wait window was raised from 10s to 30s so a late-arriving token would no longer be
-- discarded. The outcome, however, was only recorded when the promise SETTLED — so a person who
-- opened the app and closed it inside half a minute produced **NO ROW AT ALL**.
--
-- Measured: the last row was written at 22:13:22Z, ten minutes BEFORE that deploy. A cold start at
-- ~22:45Z wrote nothing, and the absence was read as "the registration handler never ran" — a
-- completely different diagnosis from "it ran and nothing answered", pointing at completely
-- different fixes. Two people spent an hour on the wrong branch because silence is ambiguous.
--
-- `pending` is written the instant `register()` is called, before the provider answers, and is
-- replaced by the real outcome when one arrives. So the three states are now distinguishable:
--   no row at all  -> the handler genuinely never ran
--   pending        -> it ran, and the app closed before the provider answered
--   anything else  -> it ran and resolved
--
-- It is not an outcome and surfaces should not treat it as one; it is proof of an attempt.

alter table public.push_registration_status
  drop constraint if exists push_registration_status_outcome_check;

alter table public.push_registration_status
  add constraint push_registration_status_outcome_check check (outcome in (
    'pending', 'registered', 'undecided_not_asked', 'denied', 'timeout',
    'registration_error', 'empty_token', 'save_failed', 'plugin_error'
  ));

comment on column public.push_registration_status.outcome is
  'Latest registration outcome. "pending" is written the moment register() is called, BEFORE the '
  'provider answers, so an attempt is visible even when the app is closed before it resolves.';
