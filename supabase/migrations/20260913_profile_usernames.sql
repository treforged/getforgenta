-- The public handle people connect by.
--
-- Tre, 2026-09-13: "maybe, like, a username that only one person can use", and "maybe we should do
-- usernames instead or or make that an option to add people by usernames".
--
-- ⚠️ UNIQUENESS IS ENFORCED HERE AND NOWHERE ELSE. Two people can claim the same handle in the
-- same second, and only the database can arbitrate that — a check in the client or the edge
-- function is a race with a friendly error message. `src/lib/username.ts` holds the FORMAT rules
-- and says so; it deliberately does not claim to hold this one.
--
-- ⚠️ A SEPARATE COLUMN FROM `display_name`, AND THE DIFFERENCE IS A PROMISE. `display_name` is
-- already populated for most users, frequently with a real first name, and is shown only to a
-- partner or an accepted friend. A username is typed by strangers by design. Reusing the existing
-- column as the connect-by handle would publish a name nobody agreed to publish.

alter table public.profiles
  add column if not exists username text;

-- Case-insensitive uniqueness without the citext extension (not installed on this project).
-- `lower(username)` is the canonical form `normalizeUsername` produces, so the two agree by
-- construction rather than by convention.
--
-- ⚠️ PARTIAL, so the many rows with no username do not collide on NULL. A plain unique index would
-- be fine in Postgres (NULLs are distinct) but the predicate states the intent: only claimed
-- handles participate.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

-- The format rules, mirrored from src/lib/username.ts.
--
-- ⚠️ DELIBERATE DUPLICATION, and it is worth the cost. The client owns the message a person reads
-- while typing; the database owns what can be STORED, because an edge function, a future import or
-- a hand-run UPDATE all bypass the client entirely. The constraint is the narrower of the two
-- promises: length, charset and a leading letter. The RESERVED list is NOT mirrored — it is a
-- product judgement that will change more often than a schema should, and a reserved handle that
-- slipped in is an embarrassment rather than a corruption.
alter table public.profiles
  drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null
    or (
      length(username) between 3 and 20
      and username ~ '^[a-z][a-z0-9_]*$'
    )
  );

-- Readable by anyone signed in: a handle exists to be looked up, and the whole point is that a
-- friend can find you by it. Nothing else about the profile rides along — this grant is one
-- column, and `profiles`' other columns keep whatever they already had.
--
-- ⚠️ THIS IS AN ENUMERATION SURFACE AND THE GRANT ALONE DOES NOT DEFEND IT. Anyone signed in can
-- ask whether a handle exists, which is exactly what mapping the user base looks like. The guards
-- are: the same "not available" answer for taken and reserved (src/lib/username.ts), and rate
-- limiting at the lookup path. Neither belongs in a GRANT, so neither is claimed here.
grant select (username) on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;

comment on column public.profiles.username is
  'Public handle for friend connections. Unique case-insensitively via profiles_username_lower_key. '
  'NEVER derived from an email or real name - the claim form starts empty. See src/lib/username.ts.';

-- ── UNDO ──────────────────────────────────────────────────────────────────────
-- Reversible in full; nothing below destroys a row.
--   revoke update (username), select (username) on public.profiles from authenticated;
--   alter table public.profiles drop constraint if exists profiles_username_format;
--   drop index if exists public.profiles_username_lower_key;
--   alter table public.profiles drop column if exists username;   -- drops claimed handles
