-- The Sean Ellis product-market-fit survey: one row per user per survey version.
-- ============================================================================
-- WHAT IT IS. One question - "how would you feel if you could no longer use
-- Forgenta?" - with three fixed answers, and a free-text follow-up asked ONLY of
-- the people who answer "very disappointed". The second half is the valuable
-- one: it names the real value proposition in the user's own words.
--
-- ⚠️ THE 40% BENCHMARK IS A CITATION, NOT A RESULT. Sean Ellis's figure is the
-- creator's citation of a known number. Nothing here has measured it, this app
-- has tens of users rather than hundreds, and a proportion from a small sample
-- is not a product-market-fit verdict. Do not render 40% anywhere in the product
-- as though it were this app's own bar, and do not let a dashboard imply it.
--
-- WHY A TABLE AND NOT A `tour_flags` KEY. `tour_flags` records that somebody was
-- SHOWN something; this records what they SAID, which is data with a lifetime of
-- its own and a free-text field attached. Mixing an answer into a boolean map is
-- how an answer gets overwritten by the next thing that touches the map.
--
-- THE COLUMNS, and what each is for:
--   sentiment      the three fixed answers, constrained so a typo cannot become a
--                  fourth silent category that quietly shrinks every proportion.
--   would_miss     free text, asked only of `very_disappointed`. NULLABLE, and an
--                  empty answer is legitimate - somebody can be disappointed and
--                  decline to say why.
--   survey_version so a reworded question is a DIFFERENT population rather than
--                  more rows in the same one. Changing the wording and pooling the
--                  answers is the quiet way to make a trend out of two questions.
--
-- ONE ROW PER USER PER VERSION, enforced by a unique index rather than by the
-- client remembering. A client-side guard is a guard the user can clear.
--
-- PRIVACY. `would_miss` is free text a person typed about their own money, so every
-- policy is scoped to the owner's own row, and there are NO grants to `anon` at all.
--
-- ⚠️ UPDATE-OWN IS GRANTED, AND THE FIRST DRAFT OF THIS FILE WAS WRONG TO REFUSE IT.
-- The header used to say "no UPDATE and no DELETE policy: an answer is evidence, and
-- evidence that can be amended is not evidence". That reads well and it broke the
-- feature: the modal writes the sentiment first and the free text second, and an
-- upsert is INSERT ... ON CONFLICT DO UPDATE, so with UPDATE revoked the survey
-- rendered, accepted the press, advanced to the follow-up and recorded NOTHING.
-- Found by reading the table, not the screen - the screen was identical either way.
-- So: UPDATE-own is granted deliberately. A user can amend their OWN answer, which
-- costs little for a survey and is unavoidable given they are its only writer.
-- DELETE stays revoked, so an answer cannot be erased.
--
-- ⚠️ THIS READ WOULD NOT SURVIVE PER-USER RLS BEING REMOVED, and that is the
-- point - it is written to depend on it.

begin;

create table if not exists public.pmf_responses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  survey_version text not null,
  sentiment      text not null check (sentiment in ('very_disappointed', 'somewhat_disappointed', 'not_disappointed')),
  would_miss     text,
  created_at     timestamptz not null default now()
);

create unique index if not exists pmf_responses_user_version_uniq
  on public.pmf_responses (user_id, survey_version);

alter table public.pmf_responses enable row level security;

revoke all on table public.pmf_responses from anon;
grant select, insert on table public.pmf_responses to authenticated;

-- ⚠️ THE REVOKE IS LOAD-BEARING AND THE GRANT ABOVE IS NOT ENOUGH ON ITS OWN.
-- Measured on the live database right after applying this: `authenticated` came
-- back holding DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE.
-- This project has default privileges that hand `authenticated` everything on a
-- new table in `public`, so a narrow `grant` ADDS nothing - it cannot subtract.
-- RLS still refused the writes, because there is no UPDATE or DELETE policy, so
-- nothing was exposed. But the header above claims there is no UPDATE and no
-- DELETE, and a claim resting on one layer while the grant says otherwise is the
-- shape that becomes true the day somebody adds a permissive policy.
-- After this revoke, re-read: `INSERT,SELECT,UPDATE` and nothing else.
revoke delete, truncate, references, trigger on table public.pmf_responses from authenticated;

drop policy if exists pmf_responses_select_own on public.pmf_responses;
create policy pmf_responses_select_own on public.pmf_responses
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists pmf_responses_insert_own on public.pmf_responses;
create policy pmf_responses_insert_own on public.pmf_responses
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists pmf_responses_update_own on public.pmf_responses;
create policy pmf_responses_update_own on public.pmf_responses
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No DELETE policy and no DELETE grant, deliberately. See the header.

commit;
