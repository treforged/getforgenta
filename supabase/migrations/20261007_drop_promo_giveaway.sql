-- Drop the promo giveaway objects from 20260515_promo_giveaway.sql (security review f5b0efcb, 2026-10-07).
--
-- That migration was never applied to production: on 2026-10-07 mdtosrbfkextcaezuclh had no promo_* table,
-- no promo function and no promo trigger, and nothing in src/ or supabase/functions/ calls any of them.
-- But a FRESH deploy would create them, and they are unsafe as written:
--   * draw_promo_winner is SECURITY DEFINER with no caller check and no EXECUTE revoke, so any signed-in
--     user could draw a winner;
--   * auto_enroll_promo_user and record_promo_activity have no `set search_path`;
--   * trg_auto_enroll_promo runs on every INSERT into auth.users, so a fault in it blocks every sign-up.
-- Dropping is the safe choice for a feature with no caller. Every statement is IF EXISTS, so this is a
-- no-op in production. If a giveaway is wanted later, write it fresh and reviewed.

drop trigger if exists trg_auto_enroll_promo on auth.users;

drop function if exists public.draw_promo_winner(uuid);
drop function if exists public.record_promo_activity(uuid);
drop function if exists public.auto_enroll_promo_user();

drop table if exists public.promo_activity_log;
drop table if exists public.promo_entries;
drop table if exists public.promo_campaigns;
