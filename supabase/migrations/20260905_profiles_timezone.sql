-- profiles.timezone — the precondition for ANY server-side notification being correct.
-- ============================================================================
--
-- ⚠️ THE BUG THIS PREVENTS, found before it shipped rather than after.
--
-- `learn-streak.ts` buckets reads by the LOCAL calendar day, deliberately: *"two reads either
-- side of midnight UTC are the same evening for a reader in New York, and counting them as two
-- days would hand out a streak nobody earned."* That works on a device, where "local" is the
-- reader's own clock.
--
-- A Deno edge function has no such clock. It runs in UTC. Port that arithmetic to the server
-- unchanged and two things go wrong at once, silently:
--
--   1. A New York reader finishing a lesson at 8pm on the 4th is 00:00 UTC on the 5th. The
--      SERVER counts it as the 5th, the PHONE counts it as the 4th, and the streak in the
--      notification disagrees with the streak on the screen. Whichever is smaller looks like
--      the app lost a day the reader knows they did not miss.
--   2. `STREAK_RISK_HOUR = 18` means 6pm — late enough that "ends tonight" is true. Evaluated
--      in UTC it is 2pm in New York, so the warning arrives four hours before the day is
--      meaningfully at risk, about a streak that is in no danger at all.
--
-- This repo already runs its suite in UTC, America/New_York and Asia/Tokyo precisely because
-- single-timezone reasoning has produced a live money bug here before. Shipping a UTC-only
-- streak would be that same mistake, in a place the tests would not have caught it, because
-- the defect lives on a server the tests do not run on.
--
-- ── WHY A COLUMN AND NOT AN INFERENCE ────────────────────────────────────────
-- There is nothing to infer from. A row has no coordinates, no phone number, no address, and
-- the last-seen timestamp says nothing about where the seeing happened. The browser knows
-- exactly — `Intl.DateTimeFormat().resolvedOptions().timeZone` — so the client writes it and
-- the server reads it.
--
-- NULLABLE, and null means "fall back to UTC". That is honest rather than convenient: a user
-- who has not opened the app since this shipped has not told us, and pretending otherwise
-- would be inventing a fact about a person. An IANA name is stored, never an offset — an
-- offset is wrong twice a year in every zone that observes daylight saving.

begin;

alter table public.profiles
  add column if not exists timezone text;

comment on column public.profiles.timezone is
  'IANA timezone name (e.g. America/New_York) reported by the browser on sign-in. Read by '
  'server-side notification senders so a "local day" means the USER''s day rather than UTC. '
  'Null means unknown; callers fall back to UTC and must treat that as a guess, not a fact. '
  'Never store an offset - an offset is wrong twice a year wherever daylight saving applies.';

commit;
