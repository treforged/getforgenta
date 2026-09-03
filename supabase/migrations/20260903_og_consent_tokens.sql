-- One-time links for the OG billing-consent page.
-- ============================================================================
-- WHY A SEPARATE TABLE FROM `og_billing_consent`. That table is the EVIDENCE and
-- it is append-only on purpose: no UPDATE policy, no UPDATE grant, for anyone. A
-- link token is operational state — it gets marked used, it expires — so it
-- cannot live there without punching an UPDATE hole in the one table whose whole
-- value is that nobody can amend it. Evidence and plumbing are kept apart.
--
-- WHY A TOKEN AT ALL. The ask goes by email and the confirmation happens on the
-- web (docs/og-cohort.md — the App Store anti-steering line). The person opening
-- that link may be on a device where they have never signed in, and requiring a
-- login to accept a gift is how a promise goes unclaimed. So the link itself
-- carries the identity.
--
-- WHAT THAT MEANS FOR SECURITY, and every column below follows from it:
--
--  1. THE RAW TOKEN IS NEVER STORED. Only its SHA-256. A leaked database dump
--     then contains no working links. This is the same reason password hashes
--     exist, and a consent link is a credential: it can alter someone's billing.
--  2. IT EXPIRES. An email lives in an inbox forever; a credential must not.
--  3. IT IS SINGLE-USE. `used_at` is set when a decision is recorded, so a
--     forwarded email cannot be replayed to flip somebody's answer later.
--  4. NOBODY BUT THE SERVER CAN READ IT. No grants to anon or authenticated at
--     all — not even select-own. There is nothing here a user needs to see, and
--     a token a client can read is a token that can be exfiltrated by anything
--     that can read the client's session.

begin;

create table if not exists public.og_consent_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- SHA-256 of the raw token, hex. Never the token itself.
  token_sha256  text not null unique,

  -- Which wording this link was issued for. If the copy is superseded before
  -- they answer, the page must render what the EMAIL said, not today's text —
  -- otherwise they confirm something they were never shown.
  consent_version text not null,

  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.og_consent_tokens is
  'Single-use, expiring, hashed links to the OG billing-consent page. Deliberately separate from og_billing_consent, which is append-only evidence and must never gain an UPDATE path.';

revoke all on public.og_consent_tokens from anon, authenticated;
alter table public.og_consent_tokens enable row level security;
-- No policies: service role only. RLS with zero policies denies everyone else,
-- which is the intent stated positively rather than relied upon by omission.

create index if not exists og_consent_tokens_user_idx
  on public.og_consent_tokens (user_id, created_at desc);

-- At most one LIVE link per person, mirroring `og_billing_consent_one_open_ask`.
-- A resend must replace the outstanding link rather than leave two working ones:
-- two live credentials for the same decision is one more than anybody needs.
create unique index if not exists og_consent_tokens_one_live
  on public.og_consent_tokens (user_id)
  where used_at is null;

commit;
