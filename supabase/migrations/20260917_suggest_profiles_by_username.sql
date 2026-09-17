-- Typeahead for the Find-someone field. PUBLIC PROFILES ONLY.
-- ============================================================================
-- Tre, 2026-09-17: "while searching for usernames, pop-up suggestions of already
-- created accounts."
--
-- ⚠️ A PREFIX SEARCH OVER EVERY ACCOUNT IS ACCOUNT ENUMERATION, so the shape of
-- this matters more than the feature. `find_profile_by_username` is EXACT-MATCH
-- by design, and `follow_profiles` was deliberately written so that it CANNOT
-- enumerate - it returns a name only for somebody you already have a `follows`
-- row with. A careless typeahead would have quietly undone both.
--
-- So every one of these is load-bearing:
--   * `visibility = 'public'` ONLY. A private account stays findable by EXACT
--     username and is NEVER suggested - otherwise this feature silently
--     downgrades a privacy setting somebody already chose.
--   * a TWO-CHARACTER minimum prefix. With one character, 26 queries enumerate
--     every public account.
--   * PREFIX, never substring: `like 'abc%'` cannot be walked from the middle.
--   * the caller's own wildcards are ESCAPED, so `%` cannot be smuggled in to
--     widen the pattern to match everything.
--   * the caller is excluded, the limit is 8, and the row carries a username and
--     a display name and nothing else - no email, no visibility, no counts.
--   * `authenticated` only; `anon` is revoked.
--
-- ⚠️ MEASURED THE DAY THIS WAS WRITTEN, AND IT IS THE FIRST THING TO KNOW WHEN
-- SOMEBODY REPORTS THIS AS BROKEN: `profiles.visibility` DEFAULTS TO 'private',
-- and **ZERO** profiles are public (3 have usernames, all private). So this
-- returns nothing for everybody until people opt in. **That is the feature
-- working, not failing.** Do not "fix" an empty dropdown by widening the filter -
-- the empty state in `UsernameSuggestions.tsx` says so on screen for exactly this
-- reason.
--
-- UNDO: drop function if exists public.suggest_profiles_by_username(text);
-- ============================================================================

begin;

create or replace function public.suggest_profiles_by_username(p_prefix text)
returns table (user_id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.user_id, p.username, p.display_name
    from public.profiles p
   where auth.uid() is not null
     and p.visibility = 'public'
     and p.username is not null
     and p.user_id <> auth.uid()
     and length(btrim(coalesce(p_prefix, ''))) >= 2
     and p.username like replace(replace(replace(lower(btrim(p_prefix)), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
   order by length(p.username), p.username
   limit 8
$fn$;

revoke all on function public.suggest_profiles_by_username(text) from public, anon;
grant execute on function public.suggest_profiles_by_username(text) to authenticated;

comment on function public.suggest_profiles_by_username(text) is
'Typeahead for the Find-someone field (Tre, 2026-09-17). PUBLIC PROFILES ONLY, minimum 2-character '
'PREFIX, caller excluded, 8 rows max, and the caller''s own wildcards are escaped so the pattern '
'cannot be widened to match everything. A private account stays findable by EXACT username through '
'find_profile_by_username and is never suggested here - otherwise this feature would silently '
'downgrade a privacy setting people already chose. Returns username and display name only: no '
'email, no visibility, no counts.';

commit;
