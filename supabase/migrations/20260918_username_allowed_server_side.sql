-- A USERNAME IS AN ENTRY POINT - Tre, 2026-09-18: "make sure username entry in restricted from
-- bad words and cant be used as an entry point for attacks. same protects as all the other
-- entry points."
--
-- WHAT WAS ALREADY TRUE, measured against the live database before this migration and recorded
-- so nobody re-derives it:
--   * `profiles_username_format` already CHECKs `^[a-z][a-z0-9_]*$`, length 3..20. That is a
--     strict ASCII allowlist, so unicode confusables, zero-width characters, HTML, quotes and
--     path separators cannot be stored AT ALL. The injection half was already closed.
--   * `find_profile_by_username` and `suggest_profiles_by_username` are LANGUAGE sql with bound
--     parameters and no dynamic EXECUTE, and the suggest function escapes \ % _ before a LIKE.
--     No injection surface in either.
--   * `profiles_username_change_limit` already rate-limits changes to 2 per 7 days.
--
-- ⚠️ WHAT WAS NOT TRUE, AND IS THE REASON FOR THIS FILE: `RESERVED_USERNAMES` in
-- `src/lib/username.ts` was enforced ONLY IN THE BROWSER. Nothing in the database refused them.
-- An authenticated caller going straight at PostgREST could claim `support`, `admin`, `billing`
-- or `forgenta` - and that file's own comment says those are the IMPERSONATION risks that cost
-- more than a squatted name. So the highest-value control in the app had no server side.
-- The client check is the courtesy; THIS is the control.
create or replace function public.username_is_allowed(p_username text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when p_username is null then true
    else
      -- Exact-match impersonation handles. Must stay in step with RESERVED_USERNAMES in
      -- src/lib/username.ts; `username-lists.gate.test.ts` fails if the two ever disagree.
      lower(btrim(p_username)) <> all (array[
        'admin','administrator','root','support','help','security','billing',
        'forgenta','treforged','team','staff','official','system','moderator',
        'null','undefined','anonymous','deleted'
      ])
      -- Substring-matched slurs and hard profanity, checked against four spellings: the value,
      -- its leet fold, its underscore-collapsed form, and both together.
      and not exists (
        select 1
          from unnest(array[
            'fuck','shit','cunt','nigger','nigga','faggot','retard','whore',
            'bitch','bastard','dickhead','cocksucker','wanker','twat','slut',
            'pussy','kike','chink','tranny','pedophile','paedophile','molest',
            'porn','dildo','jizz','nazi','hitler','kkk','incel'
          ]) as w(word)
          cross join lateral (
            select lower(btrim(p_username)) as v
          ) n
          cross join lateral (
            -- Collapse underscores ONLY on the evasion pattern - three or more consecutive
            -- single-character segments, i.e. a word spelled out one letter at a time. A blind
            -- strip would turn `cash_item` into `cashitem`, which contains `shit`.
            select case
              when n.v ~ '(^|_)[a-z0-9]_[a-z0-9]_[a-z0-9](_|$)' then replace(n.v, '_', '')
              else n.v
            end as c
          ) k
         where n.v like '%' || w.word || '%'
            or translate(n.v, '013457', 'oieast') like '%' || w.word || '%'
            or k.c like '%' || w.word || '%'
            or translate(k.c, '013457', 'oieast') like '%' || w.word || '%'
      )
  end
$$;

comment on function public.username_is_allowed(text) is
  'Server-side half of the username rules. Mirrors RESERVED_USERNAMES and BANNED_SUBSTRINGS in src/lib/username.ts; username-lists.gate.test.ts asserts the two agree.';

-- Verified before adding: the three usernames that exist (drforged, treforged1, walkprobe) all
-- pass, so this validates rather than needing NOT VALID.
alter table public.profiles
  add constraint profiles_username_allowed
  check (username_is_allowed(username));

-- UNDO: alter table public.profiles drop constraint profiles_username_allowed;
--       drop function public.username_is_allowed(text);
