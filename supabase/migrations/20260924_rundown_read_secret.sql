-- rundown_read_secret - the SHA-256 of the x-rundown-secret that rundown-counts accepts.
--
-- Only the HASH is stored. The secret lives in claudecontext/.env on Tre's machine (gitignored),
-- where rundown.py reads it. It is a read secret for user COUNTS, not the service key and not
-- the cron secret, so leaking it discloses aggregates and nothing else.
--
-- RLS on with no policies, and every privilege revoked from anon and authenticated: only
-- service_role (the edge function) can read the row.
-- Rotate: generate a new secret, then update the hash here. No redeploy is needed.

create table if not exists public.rundown_read_secret (
  id smallint primary key default 1 check (id = 1),
  sha256_hex text not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.rundown_read_secret enable row level security;
revoke all on public.rundown_read_secret from anon, authenticated, public;
grant select on public.rundown_read_secret to service_role;
