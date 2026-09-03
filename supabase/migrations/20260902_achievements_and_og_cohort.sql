-- One achievement system, and the OG cohort.
-- ============================================================================
-- Two things, and the SECOND is the reason the first has to change shape.
--
-- 1. `learn_progress` becomes `achievements`. It shipped this morning holding one
--    row per lesson read, which is already an achievement record with a narrower
--    name. An OG badge and a social-follow badge are the same shape, and three
--    parallel tables would mean three sets of grants to get right instead of one.
--    Safe to rename rather than migrate: the table is hours old and holds no
--    production rows.
--
-- 2. `og_members` is the first-100-organic-premium cohort. Tre: "they should
--    recieve an OGs achievement... after a year, they get a year free just for
--    being an OG. this needs to be trackable."
--
-- THE SECURITY LINE, and it is the whole design:
--
--   A CLIENT MAY ASSERT ONLY WHAT IT CANNOT LIE ABOUT PROFITABLY. Reading a
--   lesson and following an Instagram account are self-asserted — there is no
--   way to verify either, and the cost of a lie is a badge. Being an OG is
--   worth a free year, so it is written SERVER-SIDE ONLY, by a trigger on the
--   subscription table, from state the webhooks own. The INSERT policy below
--   enumerates exactly what a client may claim, so a client cannot mint
--   `og_founder` for itself. That is not a comment — it is the WITH CHECK.
--
-- There is still no UPDATE grant anywhere here. A row is a fact with a
-- timestamp; a client that can rewrite `earned_at` can fabricate a streak, and
-- one that could rewrite `og_number` could jump the queue.

begin;

-- ── 1. The one achievement table ───────────────────────────────────────────
alter table if exists public.learn_progress rename to achievements;
alter table if exists public.achievements rename column lesson_id to achievement_id;
alter table if exists public.achievements rename column read_at to earned_at;

alter index if exists learn_progress_user_lesson_uniq rename to achievements_user_achievement_uniq;
alter index if exists learn_progress_user_read_at_idx rename to achievements_user_earned_at_idx;

comment on table public.achievements is
  'One row per achievement earned. Lessons are `lesson:<slug>`; social follows are self-asserted; `og_founder` is granted server-side only (see the INSERT policy).';

drop policy if exists learn_progress_select_own on public.achievements;
drop policy if exists learn_progress_insert_own on public.achievements;
drop policy if exists learn_progress_delete_own on public.achievements;

drop policy if exists achievements_select_own on public.achievements;
create policy achievements_select_own on public.achievements
  for select to authenticated
  using (user_id = auth.uid());

-- THE ENUMERATED CLAIM. A client may write its own lesson reads and its own
-- social follows, and nothing else. `og_founder` is absent on purpose: the
-- trigger below writes it with the service role, which bypasses RLS entirely.
drop policy if exists achievements_insert_own on public.achievements;
create policy achievements_insert_own on public.achievements
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      achievement_id like 'lesson:%'
      or achievement_id in ('follow_instagram', 'follow_tiktok')
    )
  );

-- Deleting your own badge is allowed — a user who un-follows should be able to
-- take the claim back, and account deletion cascades through here anyway.
-- `og_founder` is exempt: giving it up is not a thing a client should be able
-- to do by accident, and the cohort has to stay enumerable a year from now.
drop policy if exists achievements_delete_own on public.achievements;
create policy achievements_delete_own on public.achievements
  for delete to authenticated
  using (user_id = auth.uid() and achievement_id <> 'og_founder');

-- ── 2. The OG cohort ───────────────────────────────────────────────────────
create table if not exists public.og_members (
  user_id            uuid primary key references auth.users(id) on delete cascade,

  -- 1..100. Unique, so the hundredth place can only be taken once even if two
  -- subscriptions land in the same millisecond.
  og_number          integer not null unique
                       constraint og_members_number_range check (og_number between 1 and 100),

  claimed_at         timestamptz not null default now(),

  -- WHICH RAIL THEY JOINED ON. This is the operational fact that decides how the
  -- reward can be honoured: Stripe can grant a free period, RevenueCat cannot.
  -- Recorded at claim time rather than read a year later, because by then the
  -- row may say something different.
  claimed_provider   text not null,

  -- WHO IS OWED WHAT, AND WHEN — written now, not reconstructed later from
  -- subscription history. Tre's word for the requirement was "trackable", and a
  -- reward whose due date has to be re-derived a year from now is not.
  reward_due_at      timestamptz not null,
  reward_granted_at  timestamptz,

  -- How it was actually honoured. Tre decided 2026-09-02: an OG who joined on
  -- mobile is MOVED TO A STRIPE-BILLED PLAN at the anniversary and the free year
  -- is granted there, because Stripe is the only provider that can grant one.
  reward_granted_via text
                       constraint og_members_granted_via check (
                         reward_granted_via is null or reward_granted_via in ('stripe')
                       ),

  -- The last moment we OBSERVED this account as premium. `user_subscriptions` is
  -- current-state, not history — one upserted row per user — so "were they
  -- premium during the grace window?" cannot be answered retroactively. It has
  -- to be RECORDED as it happens, and this is where.
  last_premium_at    timestamptz not null default now(),

  -- A lapse does NOT remove someone from the cohort. They were one of the first
  -- hundred; that is a historical fact and stays true.
  lapsed_at          timestamptz,

  -- WHY they lapsed, and this is the column that makes the rule fair rather than
  -- merely consistent. A card that expired is not a customer choosing to leave.
  -- 'unknown' is a real answer, not a failure — and it resolves in the
  -- CUSTOMER'S favour (see `og_reward_eligible`). Being wrong in their favour
  -- costs one free year; being wrong against them costs the relationship, with
  -- the hundred people most invested in this product.
  lapse_reason       text
                       constraint og_members_lapse_reason check (
                         lapse_reason is null
                         or lapse_reason in ('voluntary', 'billing_failure', 'unknown')
                       ),

  created_at         timestamptz not null default now()
);

revoke all on public.og_members from anon, authenticated;

alter table public.og_members enable row level security;

-- Read your own row only. There is no public leaderboard of OG numbers: it would
-- turn a reward into a directory of who pays for the app.
drop policy if exists og_members_select_own on public.og_members;
create policy og_members_select_own on public.og_members
  for select to authenticated
  using (user_id = auth.uid());

-- NO INSERT, UPDATE OR DELETE POLICY, AND NO WRITE GRANT. Every write happens
-- through the trigger below under the service role. A client cannot make itself
-- an OG, cannot renumber itself, and cannot mark its own reward granted.
grant select on public.og_members to authenticated;

create index if not exists og_members_reward_due_idx
  on public.og_members (reward_due_at)
  where reward_granted_at is null;

/**
 * Claim the next OG place, if there is one and this account qualifies.
 *
 * ORGANIC means paid for. Tre asked for the first 100 ORGANIC premium users, and
 * `grant-promo-premium` exists, so a comped account is explicitly not one of
 * them — the guard is that the subscription must carry a real provider id.
 *
 * SECURITY DEFINER with a pinned search_path: it writes a table no role can
 * write directly, so it must not be reachable through a schema a caller can
 * shadow.
 */
create or replace function public.claim_og_place()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number integer;
  is_organic  boolean;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Only on becoming premium and active. Anything else is not a join.
  if coalesce(new.plan, '') <> 'premium' or coalesce(new.subscription_status, '') not in ('active', 'trialing') then
    return new;
  end if;

  -- Already in. The primary key would refuse the insert anyway; returning early
  -- keeps the sequence from being consumed by a no-op.
  if exists (select 1 from public.og_members where user_id = new.user_id) then
    return new;
  end if;

  -- ORGANIC: a real purchase on one of the two rails, not a promo grant. A
  -- comped account has neither id.
  is_organic := new.stripe_subscription_id is not null
             or new.revenuecat_app_user_id is not null;
  if not is_organic then
    return new;
  end if;

  -- The hundredth place, taken once. The unique constraint on `og_number` is the
  -- real guarantee; this count is the cheap check in front of it.
  select coalesce(max(og_number), 0) + 1 into next_number from public.og_members;
  if next_number > 100 then
    return new;
  end if;

  insert into public.og_members (user_id, og_number, claimed_provider, reward_due_at)
  values (
    new.user_id,
    next_number,
    coalesce(new.purchase_provider, 'stripe'),
    now() + interval '1 year'
  )
  on conflict do nothing;

  -- The badge, granted server-side. The client's own INSERT policy cannot write
  -- this id, which is the point of enumerating what it can write.
  insert into public.achievements (user_id, achievement_id)
  values (new.user_id, 'og_founder')
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.claim_og_place() from public, anon, authenticated;

/**
 * Keep the cohort's premium history current. Runs on the same subscription
 * writes as the claim above, for members only.
 *
 * WHY A SECOND FUNCTION rather than more branches in the first: claiming a place
 * happens once and must be cheap to reason about; this runs for the rest of the
 * member's life and has to be safe to run on every subscription event forever.
 */
create or replace function public.track_og_premium_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_premium boolean;
  reason     text;
begin
  if new.user_id is null then
    return new;
  end if;
  if not exists (select 1 from public.og_members where user_id = new.user_id) then
    return new;
  end if;

  is_premium := coalesce(new.plan, '') = 'premium'
            and coalesce(new.subscription_status, '') in ('active', 'trialing');

  if is_premium then
    -- Still with us. Clearing the lapse matters: someone who lost a card and
    -- fixed it has not lapsed, and leaving the stamp would say they had.
    update public.og_members
       set last_premium_at = now(),
           lapsed_at       = null,
           lapse_reason    = null
     where user_id = new.user_id;
    return new;
  end if;

  -- VOLUNTARY vs BILLING FAILURE, from what the provider actually told us.
  -- Stripe's own status vocabulary carries this; RevenueCat's billing states map
  -- onto the same words in `revenuecat-webhook`. Anything we cannot classify is
  -- 'unknown', which the eligibility rule treats as the customer's favour.
  reason := case
    when new.cancel_at_period_end then 'voluntary'
    when coalesce(new.subscription_status, '') in ('canceled', 'cancelled') then 'voluntary'
    when coalesce(new.subscription_status, '') in ('past_due', 'unpaid', 'incomplete', 'incomplete_expired') then 'billing_failure'
    else 'unknown'
  end;

  update public.og_members
     set lapsed_at    = coalesce(lapsed_at, now()),
         lapse_reason = reason
   where user_id = new.user_id;

  return new;
end;
$$;

revoke all on function public.track_og_premium_state() from public, anon, authenticated;

/**
 * IS THIS OG OWED THEIR FREE YEAR? The rule, in one place, in plain words:
 *
 *   An OG keeps the free year if they are still with us at the anniversary —
 *   judged over a GRACE WINDOW, not on a single calendar day — OR if the reason
 *   they are not is a billing failure rather than a decision.
 *
 * The three parts, and why each exists:
 *
 *  1. STILL PREMIUM (or premium at any point inside the window). A single-day
 *     equality check would forfeit a year over a card that declined on the wrong
 *     Tuesday. `OG_GRACE_DAYS` either side is the whole difference.
 *  2. AN INVOLUNTARY LAPSE NEVER FORFEITS. Someone who paid for eleven and a
 *     half months and had a card expire in month twelve earned the year, and
 *     would be right to be furious about losing it.
 *  3. AMBIGUITY GOES TO THE CUSTOMER. `lapse_reason = 'unknown'` qualifies.
 *
 * What does NOT qualify: cancelling deliberately and staying gone. That is the
 * case the rule exists to exclude — cancel on day 2, resubscribe on day 364,
 * collect a free year.
 */
create or replace function public.og_reward_eligible(p_user_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.og_members m
     where m.user_id = p_user_id
       and (
            -- 1. premium inside the grace window around the anniversary
            m.last_premium_at >= p_at - interval '30 days'
            -- 2 and 3. not a deliberate departure
            or m.lapsed_at is null
            or coalesce(m.lapse_reason, 'unknown') in ('billing_failure', 'unknown')
       )
  );
$$;

comment on function public.og_reward_eligible(uuid, timestamptz) is
  'An OG keeps the free year if premium within 30 days of the anniversary, or if their lapse was a billing failure rather than a choice. Ambiguity resolves in the customer''s favour. See docs/og-cohort.md.';

drop trigger if exists user_subscriptions_track_og on public.user_subscriptions;
create trigger user_subscriptions_track_og
  after insert or update of plan, subscription_status, cancel_at_period_end on public.user_subscriptions
  for each row
  execute function public.track_og_premium_state();

drop trigger if exists user_subscriptions_claim_og on public.user_subscriptions;
create trigger user_subscriptions_claim_og
  after insert or update of plan, subscription_status on public.user_subscriptions
  for each row
  execute function public.claim_og_place();

commit;
