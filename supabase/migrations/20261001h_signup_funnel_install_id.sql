-- Ask 98cbf494 item 2 (Sam approved 2026-10-01): count sign-in funnel rows per INSTALL, not per event.
-- install_id is a random UUID the client makes ONLY under an explicit analytics-cookie accept
-- (src/lib/signup-funnel.ts funnelInstallId). It is never derived from the device and never joined
-- to an account: this table has no user column and nothing here adds one.
-- Insert-only, like every other column: anon/authenticated still cannot SELECT this table.
-- Undo: alter table public.signup_funnel_events drop column install_id;
alter table public.signup_funnel_events add column if not exists install_id uuid;
grant insert (install_id) on public.signup_funnel_events to anon, authenticated;
