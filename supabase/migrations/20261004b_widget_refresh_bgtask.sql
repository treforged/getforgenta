-- Ask e74da89c (2026-10-04): a refresh run by the iOS BGAppRefreshTask is logged as 'bgtask', so SQL
-- can tell it from an ordinary app close ('hidden'). Widening a CHECK only; no rows change.
-- Undo: alter table ... drop constraint widget_refresh_events_via_check; add it back with ('host','hidden')
-- (only after deleting any 'bgtask' rows).
begin;
alter table public.widget_refresh_events drop constraint if exists widget_refresh_events_via_check;
alter table public.widget_refresh_events
  add constraint widget_refresh_events_via_check check (via in ('host', 'hidden', 'bgtask'));
commit;
