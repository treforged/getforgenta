-- New accounts start in the Simple view (Tre, 2026-10-05, ask ae6c85a3: "1. yes").
-- A column DEFAULT only applies to rows inserted from now on, so every existing profile keeps
-- its NULL (= Advanced) and nobody's current screen changes. handle_new_user inserts the
-- profile without naming view_mode, so the default is what a new sign-up gets.
-- Undo: alter table public.profiles alter column view_mode drop default;
alter table public.profiles alter column view_mode set default 'simple';
