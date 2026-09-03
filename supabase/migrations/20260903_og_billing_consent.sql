-- Consent to move an OG's subscription to Stripe billing.
-- ============================================================================
-- Tre, 2026-09-03: "id want it to notify the user that their subscribtion would
-- be moved to stripe and require a confirmation. it would need to be tracked for
-- legal reason."
--
-- So this is a COMPLIANCE ARTEFACT, not a UX flag, and it is built as one. The
-- question it has to answer, a year from now, to a stranger who was not here:
--
--     WHO agreed, to WHAT EXACT WORDING, WHEN, and BY WHAT ACTION.
--
-- Every column below exists to answer one of those four, and the three rules
-- that follow are what make the answer worth anything.
--
-- 1. THE WORDING IS STORED, NOT REFERENCED. `consent_text` holds the full text
--    the person actually saw, plus `consent_version` and a SHA-256 of it. It is
--    deliberately NOT a foreign key to live copy: copy gets edited, and the
--    moment somebody rewords the page, every historical consent would silently
--    start claiming people agreed to something they never read. A record that
--    changes its own meaning later is not evidence.
--
-- 2. APPEND-ONLY. No UPDATE policy and no UPDATE grant, for anyone. No client
--    INSERT either — rows are written server-side from the confirmed action.
--    Same reasoning as `achievements.earned_at`: a row the subject could write
--    or amend proves nothing about what they did.
--
-- 3. A DECLINE AND A NON-RESPONSE ARE BOTH RECORDED. "They said no" and "we
--    asked and never heard back" are different facts with different
--    obligations, and an absent row is indistinguishable from never having
--    asked. `decision` carries all three states.
--
-- ⛔ WHERE THIS HAPPENS: the ask goes by EMAIL and the confirmation happens on a
-- WEB page. Never in the app, and never behind a link IN the app — that is what
-- keeps it outside App Store payment rules. See docs/og-cohort.md.

begin;

create table if not exists public.og_billing_consent (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,

  -- WHO, WHEN, and BY WHAT ACTION.
  decision         text not null
                     constraint og_billing_consent_decision check (
                       decision in ('confirmed', 'declined', 'asked')
                     ),
  -- 'asked' rows are written when the email goes out, so a non-response is a
  -- FACT ON THE RECORD rather than an absence. `confirmed`/`declined` are
  -- written from the person's own affirmative act on the confirmation page.
  decided_at       timestamptz not null default now(),

  -- WHAT THEY SAW. The full text, its version id, and a hash so a later
  -- accidental edit to this row is detectable rather than silent.
  consent_version  text not null,
  consent_text     text,
  consent_sha256   text,

  -- What the act actually was, in words: 'clicked-confirm-web' rather than a
  -- boolean. A year later "they consented" is a claim; "they pressed a button
  -- labelled X on a page stating Y" is a record.
  action_taken     text not null,

  -- Best-effort provenance. Nullable on purpose: a missing IP must not be a
  -- reason to refuse a consent the person genuinely gave.
  ip_address       inet,
  user_agent       text,

  created_at       timestamptz not null default now()
);

comment on table public.og_billing_consent is
  'Legal record of consent to move an OG subscription to Stripe billing. Append-only; the consent WORDING is stored, never referenced, so an edit to live copy cannot rewrite history.';

revoke all on public.og_billing_consent from anon, authenticated;
alter table public.og_billing_consent enable row level security;

-- A person may READ their own consent history — they are entitled to see what
-- they agreed to. They may not write it, amend it, or delete it: a record the
-- subject controls is not a record.
drop policy if exists og_billing_consent_select_own on public.og_billing_consent;
create policy og_billing_consent_select_own on public.og_billing_consent
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.og_billing_consent to authenticated;

-- One live ask at a time, so a resend cannot produce two open asks. Confirmed
-- and declined rows are unconstrained: the full history is the point.
create unique index if not exists og_billing_consent_one_open_ask
  on public.og_billing_consent (user_id)
  where decision = 'asked';

create index if not exists og_billing_consent_user_idx
  on public.og_billing_consent (user_id, decided_at desc);

/**
 * Has this person confirmed, and to which version?
 *
 * THE GRANT MUST FIRE ONLY FROM A CONFIRMED ROW. Nothing moves anyone's billing
 * without one, and nothing is stamped granted unless Stripe itself confirmed the
 * change — a `reward_granted_at` written by code that granted nothing is the
 * class of lie this whole feature is built against.
 */
create or replace function public.og_billing_consent_current(p_user_id uuid)
returns table (decision text, decided_at timestamptz, consent_version text)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.decision, c.decided_at, c.consent_version
    from public.og_billing_consent c
   where c.user_id = p_user_id
   order by c.decided_at desc
   limit 1;
$$;

commit;
