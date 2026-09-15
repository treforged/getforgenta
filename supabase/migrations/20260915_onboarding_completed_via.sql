-- Applied to the live project 2026-09-15 (migration `onboarding_completed_via_attribution`).
--
-- WHY: `onboarding_completed` is written by FOUR call sites that mean four different things -
-- finishing the wizard, a legacy display_name bounce, the dashboard checklist auto-completing
-- from real data, and a cache restore. A bare boolean cannot tell them apart, so every metric
-- built on the column measures "any of the four", which in practice has meant HAVING A NAME:
-- 33 profiles, 7 completed, and exactly ONE has ever reached `finish` in the wizard.
--
-- NULL means the flag was set before this column existed (the 7 accounts as at 2026-09-15). It is
-- deliberately NOT backfilled to a guess - an invented attribution reads exactly like a measured
-- one, and the whole defect being fixed here is a column that cannot be read honestly.
--
-- UNDO: alter table public.profiles drop column onboarding_completed_via;
alter table public.profiles
  add column if not exists onboarding_completed_via text;

comment on column public.profiles.onboarding_completed_via is
  'Which code path set onboarding_completed. wizard | legacy_name | checklist | cache_restore. NULL = set before attribution existed (pre 2026-09-15).';
