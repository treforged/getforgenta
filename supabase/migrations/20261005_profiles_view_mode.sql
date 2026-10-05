-- Simple | Advanced view (ask 7515c3fa / 5b166e10). NULL means Advanced: every existing
-- account keeps the screen it has today. The user writes their own row under the existing
-- profiles RLS, so no policy or grant change is needed.
-- Undo: alter table public.profiles drop column view_mode;
alter table public.profiles
  add column if not exists view_mode text
  check (view_mode is null or view_mode in ('simple', 'advanced'));

comment on column public.profiles.view_mode is
  'Simple | Advanced view. NULL = advanced. Written by the header switch (src/hooks/useViewMode.ts).';
