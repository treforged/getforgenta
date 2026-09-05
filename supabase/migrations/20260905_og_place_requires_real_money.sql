-- An OG seat is for someone who PAID, and the test for that was the one already disproved.
-- ============================================================================
--
-- `docs/og-cohort.md`, first paragraph of "Who is an OG": *"**Organic** means they paid. A comped
-- account is not one of the hundred."* `claim_og_place()` implemented that as:
--
--     is_organic := new.stripe_subscription_id is not null
--                or new.revenuecat_app_user_id is not null;
--
-- ⚠️ THAT IS THE EXACT HEURISTIC `20260905_subscriptions_is_comp.sql` PROVED INSUFFICIENT, hours
-- earlier and against live Stripe data. Its own words: *"The obvious rule -- 'a comp is a row with
-- no stripe_subscription_id' -- is PROVABLY INSUFFICIENT. Four of the five are that shape; the
-- fifth holds a real Stripe subscription id and is still a comp, because the comp lives in a 100%
-- discount attached to the subscription at Stripe."*
--
-- So the seat test was passing exactly the accounts the cohort is defined to exclude. Measured
-- before this migration: **all 5 rows in `og_members` carry `is_comp = true`** — a cohort whose
-- defining property is having paid, populated entirely by accounts that never did, each one
-- currently owed a free year on the strength of it.
--
-- ── THE FIX IS ONE CONDITION, AND IT IS THE COLUMN THAT EXISTS FOR THIS ─────
-- `is_comp` was added that morning precisely because no predicate over the other columns can
-- classify these rows. Consulting it here is what that column is FOR.
--
-- ── WHAT THIS CHANGES ABOUT *WHEN* A SEAT IS CLAIMED, WHICH IS AN IMPROVEMENT ─
-- `is_comp` defaults TRUE and is set false in exactly one place: the Stripe webhook's
-- `invoice.paid` handler, when `amount_paid > 0`. A checkout completing is therefore no longer the
-- moment a seat is taken — the PAYMENT is. That is a deliberate consequence and it is closer to
-- the written rule than the old behaviour: a 100%-discount checkout completes identically to a
-- paid one, which is why the paperwork could never be the signal and the money has to be.
--
-- A subscriber whose first invoice pays fires this trigger again on that update, with
-- `new.is_comp = false`, and takes their seat then. Nobody who pays is excluded; they are merely
-- enrolled a few seconds later, at the point the claim becomes true.
--
-- ── WHAT THIS DELIBERATELY DOES *NOT* DO ────────────────────────────────────
-- It does not touch the 5 existing rows. They were backfilled on Tre's direct instruction
-- (2026-09-03) and removing somebody from a cohort is his call, not a migration's. What it does is
-- stop the NEXT hundred from being filled the same way, which matters now: Tre's ask is a push for
-- the first 100 ORGANIC premium users, and comped accounts consuming those seats would make that
-- number meaningless before the push begins.
--
-- The contradiction in the existing rows is reported rather than silently corrected — see
-- `og_cohort_integrity()` below, so it is visible to whoever decides.
--
-- REVERSING THIS: restore the previous function body. No data is altered by this migration.

begin;

create or replace function public.claim_og_place()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  next_number integer;
  is_organic  boolean;
begin
  if new.user_id is null then
    return new;
  end if;

  if coalesce(new.plan, '') <> 'premium' or coalesce(new.subscription_status, '') not in ('active', 'trialing') then
    return new;
  end if;

  if exists (select 1 from public.og_members where user_id = new.user_id) then
    return new;
  end if;

  -- ⚠️ `not new.is_comp` IS THE LOAD-BEARING HALF. A provider id says paperwork exists; it does
  -- not say money moved, and a 100%-discount subscription carries a real id. `is_comp` is the only
  -- column that distinguishes them, which is why it was created.
  is_organic := not coalesce(new.is_comp, true)
            and (new.stripe_subscription_id is not null
                 or new.revenuecat_app_user_id is not null);
  if not is_organic then
    return new;
  end if;

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

  insert into public.achievements (user_id, achievement_id)
  values (new.user_id, 'og_founder')
  on conflict do nothing;

  return new;
end;
$function$;

-- ── AND THE TRIGGER HAS TO WAKE UP WHEN `is_comp` CHANGES ───────────────────
--
-- ⚠️ WITHOUT THIS, THE FIX ABOVE IS A SILENT NO-OP THAT ADMITS NOBODY. The trigger was
-- `AFTER INSERT OR UPDATE OF plan, subscription_status`. The ordinary Stripe flow is: checkout
-- completes, plan becomes premium while `is_comp` is still TRUE, the seat is correctly refused;
-- then `invoice.paid` flips `is_comp` to false -- and the trigger never fired, so the seat was
-- never taken. No one would ever have become an OG again.
--
-- CAUGHT BY RUNNING IT, NOT BY READING IT. The probe granted a seat to a comped account (refused,
-- correct), then paid and asserted a seat WAS granted -- and it was not. The function body was
-- right; the thing that decides WHEN it runs lives in a different object, and no amount of reading
-- `claim_og_place` could have shown it.
--
-- The live webhook happens to write plan, subscription_status and is_comp in ONE statement, so the
-- old trigger would have fired anyway. Depending on that is the fragile version: any later change
-- that flips `is_comp` alone would silently cost somebody their place in the hundred.
drop trigger if exists user_subscriptions_claim_og on public.user_subscriptions;
create trigger user_subscriptions_claim_og
  after insert or update of plan, subscription_status, is_comp
  on public.user_subscriptions
  for each row execute function public.claim_og_place();

-- ── THE CONTRADICTION, REPORTED RATHER THAN HIDDEN ──────────────────────────
-- A cohort defined as "they paid" that contains accounts which did not is a fact somebody has to
-- decide about. Silently deleting those rows would be a migration making a call that is Tre's, and
-- silently leaving them would let a free year be granted in 2027 on a subscription nobody paid
-- for. So it is counted, named, and readable on demand.
create or replace function public.og_cohort_integrity()
returns table(
  members bigint,
  comped_members bigint,
  seats_left integer,
  earliest_reward_due timestamptz,
  rewards_due_now bigint
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)                                                        as members,
         count(*) filter (where coalesce(s.is_comp, true))               as comped_members,
         (100 - coalesce(max(m.og_number), 0))::integer                  as seats_left,
         min(m.reward_due_at)                                            as earliest_reward_due,
         count(*) filter (where m.reward_due_at <= now()
                            and m.reward_granted_at is null)             as rewards_due_now
    from public.og_members m
    left join public.user_subscriptions s on s.user_id = m.user_id;
$function$;

revoke execute on function public.og_cohort_integrity() from public, anon, authenticated;
grant execute on function public.og_cohort_integrity() to service_role;

comment on function public.claim_og_place() is
  'Assigns OG places 1-100 when a subscription becomes premium AND is not a comp. `is_comp` is load-bearing: a provider id proves paperwork, not payment, and a 100%-discount subscription carries a real one. Consequence: the seat is claimed at invoice.paid rather than at checkout, which is what "organic means they paid" actually says.';
comment on function public.og_cohort_integrity() is
  'Counts the OG cohort and how many of its members are COMPED - which the cohort definition says cannot happen. Non-zero means existing rows contradict the rule and somebody has to decide about them. Service role only.';

-- ── PROVED AGAINST THE LIVE DATABASE, on throwaway accounts, rolled back ────
--   1. premium + a REAL stripe_subscription_id + is_comp -> NO seat taken. That is the exact
--      shape of five live subscriptions and the shape the old test called organic.
--   2. the same account once `is_comp` goes false (invoice.paid) -> seat granted.
--   3. the `og_founder` badge written with it.
--   4. a later renewal -> still one seat, not two.
-- Then: probe users deleted, `og_members` verified back at 5, `achievements` at 6, and
-- `revenue_summary_lines()` byte-identical to before -- `user_subscriptions` has no FK to
-- `auth.users`, so a probe can strand a row that later reads as revenue.
--
-- SEPARATELY PROVED, because Sam asked which way the social-follow badge went: it is COSMETIC.
-- A user holding `follow_instagram` and `follow_tiktok` and no lessons has `streak_days_for() = 0`
-- and `claim_streak_reward()` refuses. A client-mintable badge feeding a paying streak would be
-- the morning's `earned_at` exploit wearing different clothes.

commit;
