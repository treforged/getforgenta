-- Item 9 — a 30-day login streak grants 30 days of Premium, and the server decides all of it.
-- ============================================================================
--
-- ⚠️ READ 20260905_achievements_earned_at_is_server_time.sql FIRST. That migration is the
-- precondition for this one: until it landed, `achievements.earned_at` was client-supplied, so
-- thirty backdated rows bought a thirty-day streak one second after signing up. Granting real
-- Premium on top of that would have been a feature shipping on a hole. This one is only safe
-- because the clock is now the server's.
--
-- ── WHY SQL AND NOT AN EDGE FUNCTION ────────────────────────────────────────
-- The whole job is: read this user's achievement rows, count consecutive local days, write one
-- subscription row. Every input and every output is already in this database. An edge function
-- would add a deploy, a secret, an HTTP hop and a network failure mode to move data from Postgres
-- to Postgres — and, decisively, it could not be exercised the way this can: these functions are
-- called AS THE `authenticated` ROLE in a probe, which is the same path the app takes. A test that
-- can make the real call beats a test that mocks one.
--
-- ── WHY THE ENTITLEMENT IS A COMPED `user_subscriptions` ROW ────────────────
-- Premium truth lives in this database — webhooks write it, everything else reads it, never the
-- provider APIs. `isPremium` is `plan = 'premium'` and status in (active, trialing). So a grant is
-- that row, marked `is_comp` so it is never counted as revenue (20260905_subscriptions_is_comp),
-- and stamped `purchase_provider = 'streak_reward'` so expiry can find exactly the rows this
-- feature created and nothing else. No RevenueCat call, no Stripe coupon, no new credential.
--
-- ── THE FOUR REFUSALS, AND WHY EACH ONE EXISTS ──────────────────────────────
--  1. NOT SIGNED IN. `auth.uid()` is the identity; nothing is passed in, so there is no user_id
--     parameter to lie about. This is why the function takes NO arguments.
--  2. ALREADY ACTIVE. An open grant blocks another. Without this, thirty-one days of reading is
--     one grant and thirty-two days is two, stacking forever.
--  3. STREAK TOO SHORT. Computed here, never accepted from the caller.
--  4. ALREADY PAYING. A real subscriber is never overwritten with a comp — that would delete a
--     paid subscription's period end and mark real revenue as comped. A comped or lapsed row IS
--     overwritten, which is correct: there is one row per user and the newer entitlement wins.
--
-- ── EXPIRY IS PART OF THE GRANT, NOT A FOLLOW-UP ────────────────────────────
-- `isPremium` does NOT read `current_period_end`. Nothing in the client expires a subscription —
-- for Stripe and RevenueCat the webhooks do it, and a streak comp has no webhook. So a grant with
-- no expiry path is not "30 days of Premium", it is Premium forever, given away by a feature
-- described as temporary. `expire_streak_rewards()` ships in the SAME migration for that reason,
-- and it touches ONLY rows carrying `purchase_provider = 'streak_reward'` AND `is_comp`, so it can
-- never reach a paying subscriber even if it is scheduled wrongly.
--
-- ── REVERSING THIS ──────────────────────────────────────────────────────────
-- drop the three functions and `public.streak_rewards`. Any granted row can be undone with
-- `select public.expire_streak_rewards();` after setting its `current_period_end` to now().

begin;

-- ── 1. THE GRANT LEDGER ─────────────────────────────────────────────────────
-- Separate from `user_subscriptions` on purpose. That table holds ONE row per user and is
-- overwritten by whichever entitlement is current, so it cannot answer "was this ever granted, and
-- on what evidence". This can, and it is what makes a second claim refusable.
create table if not exists public.streak_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The streak AS COUNTED AT GRANT TIME. Kept because the achievements it was counted from can be
  -- deleted by their owner, so the evidence has to be copied, not referenced.
  streak_days integer not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint streak_rewards_days_check check (streak_days >= 30),
  constraint streak_rewards_window_check check (expires_at > granted_at)
);

create index if not exists streak_rewards_user_idx on public.streak_rewards (user_id, granted_at desc);
create index if not exists streak_rewards_open_idx on public.streak_rewards (expires_at) where revoked_at is null;

alter table public.streak_rewards enable row level security;

-- READ-ONLY TO THE OWNER, AND THAT IS ALL. There is no INSERT policy for anyone: the only writer
-- is `claim_streak_reward()`, which is SECURITY DEFINER. A client that could insert here could
-- write its own entitlement, which is the entire thing being prevented.
drop policy if exists streak_rewards_select_own on public.streak_rewards;
create policy streak_rewards_select_own on public.streak_rewards
  for select using (user_id = auth.uid());

revoke all on public.streak_rewards from anon, authenticated;
grant select on public.streak_rewards to authenticated;

-- ── 2. THE STREAK, COMPUTED SERVER-SIDE ─────────────────────────────────────
-- Consecutive distinct LOCAL calendar days ending today, or ending yesterday when nothing has been
-- read yet today — the same "ending yesterday" allowance the client's `computeStreakInZone` makes,
-- and for the same reason: a five-day streak must not read as zero at breakfast.
--
-- The zone is the user's own (`profiles.timezone`, an IANA name), falling back to UTC. Bucketing in
-- UTC instead would move somebody's midnight: a New York reader finishing at 8pm on the 4th is
-- 00:00 UTC on the 5th, and the server would count a day the phone does not.
create or replace function public.streak_days_for(p_user uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with zone as (
    -- ⚠️ `p.user_id`, NOT `p.id`. `profiles` has its own primary key and carries the auth user in a
    -- SEPARATE `user_id` column: measured, 0 of 46 rows have `id = user_id`. Keying on `id` found
    -- nothing, fell through the coalesce, and silently bucketed EVERY user's streak in UTC — the
    -- exact wrong-midnight defect 20260905_profiles_timezone.sql exists to prevent, reintroduced
    -- one migration later. Caught by the probe below, before this shipped.
    select coalesce(nullif((select p.timezone from public.profiles p where p.user_id = p_user), ''), 'UTC') as tz
  ),
  days as (
    select distinct (a.earned_at at time zone (select tz from zone))::date as d
      from public.achievements a
     where a.user_id = p_user
       and a.achievement_id like 'lesson:%'
  ),
  anchored as (
    select d,
           row_number() over (order by d desc) as rn,
           (select max(d) from days) as newest,
           ((now() at time zone (select tz from zone))::date) as today
      from days
  )
  -- A run is unbroken exactly while the nth-newest day equals newest-(n-1). The `newest >= today-1`
  -- guard is what stops a streak that ended a month ago counting as if it were still running.
  select coalesce(
    (select count(*)::integer
       from anchored
      where newest >= today - 1
        -- `rn` is bigint from row_number(); `date - bigint` has no operator, only `date - integer`.
        and d = newest - (rn - 1)::integer),
    0);
$function$;

-- ── 3. THE CLAIM ────────────────────────────────────────────────────────────
-- NO ARGUMENTS, deliberately. The identity is `auth.uid()`, so there is no user_id and no streak
-- count for a caller to supply. The only thing a client can do is ask.
create or replace function public.claim_streak_reward()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid := auth.uid();
  v_streak integer;
  v_open record;
  v_sub record;
  v_expires timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('granted', false, 'reason', 'not_signed_in');
  end if;

  select * into v_open
    from public.streak_rewards
   where user_id = v_user and revoked_at is null and expires_at > now()
   order by granted_at desc limit 1;
  if found then
    return jsonb_build_object('granted', false, 'reason', 'already_active',
                              'expires_at', v_open.expires_at);
  end if;

  v_streak := public.streak_days_for(v_user);
  if v_streak < 30 then
    return jsonb_build_object('granted', false, 'reason', 'streak_too_short',
                              'streak_days', v_streak, 'needed', 30);
  end if;

  select * into v_sub from public.user_subscriptions where user_id = v_user;
  if found
     and v_sub.plan = 'premium'
     and v_sub.subscription_status in ('active', 'trialing')
     and not v_sub.is_comp then
    -- Never overwrite money. Their streak still counts; there is simply nothing to give someone
    -- who already has it, and clobbering the row would erase a paid period end.
    return jsonb_build_object('granted', false, 'reason', 'already_paying');
  end if;

  v_expires := now() + interval '30 days';

  insert into public.streak_rewards (user_id, streak_days, expires_at)
  values (v_user, v_streak, v_expires);

  insert into public.user_subscriptions
    (user_id, plan, subscription_status, current_period_end, cancel_at_period_end,
     purchase_provider, is_comp)
  values
    (v_user, 'premium', 'active', v_expires, true, 'streak_reward', true)
  on conflict (user_id) do update set
    plan = 'premium',
    subscription_status = 'active',
    current_period_end = excluded.current_period_end,
    -- It does not renew, and saying so is what stops it looking like a subscription in the UI.
    cancel_at_period_end = true,
    purchase_provider = 'streak_reward',
    is_comp = true,
    updated_at = now();

  return jsonb_build_object('granted', true, 'streak_days', v_streak, 'expires_at', v_expires);
end;
$function$;

-- ── 4. EXPIRY ───────────────────────────────────────────────────────────────
-- Scoped as narrowly as it can be: `purchase_provider = 'streak_reward'` AND `is_comp` AND the
-- period is actually over. Even scheduled wrongly, or run by hand at the wrong moment, it cannot
-- reach a paying subscriber or a comp granted by anything else.
create or replace function public.expire_streak_rewards()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_count integer := 0;
begin
  update public.user_subscriptions s
     set subscription_status = 'canceled',
         plan = 'free',
         updated_at = now()
   where s.purchase_provider = 'streak_reward'
     and s.is_comp
     and s.subscription_status = 'active'
     and s.current_period_end is not null
     and s.current_period_end <= now();
  get diagnostics v_count = row_count;

  update public.streak_rewards
     set revoked_at = now()
   where revoked_at is null and expires_at <= now();

  return v_count;
end;
$function$;

-- A SECURITY DEFINER function gets a default PUBLIC EXECUTE grant on creation, so the revokes are
-- stated here and must be repeated whenever these are redefined, or the hole silently reopens.
revoke execute on function public.streak_days_for(uuid) from public, anon;
revoke execute on function public.claim_streak_reward() from public, anon;
revoke execute on function public.expire_streak_rewards() from public, anon, authenticated;
grant execute on function public.streak_days_for(uuid) to authenticated, service_role;
grant execute on function public.claim_streak_reward() to authenticated, service_role;
-- Expiry is the SERVER'S alone. A client that could call it could cancel somebody's entitlement.
grant execute on function public.expire_streak_rewards() to service_role;

comment on function public.claim_streak_reward() is
  'Grants 30 days of comped Premium for a 30-day lesson streak. Takes no arguments: the identity is auth.uid() and the streak is counted here, so a caller can only ask. Refuses when not signed in, when a grant is already open, when the streak is short, or when the user is already PAYING.';
comment on function public.expire_streak_rewards() is
  'Ends streak comps whose 30 days are up. Service role only. Scoped to purchase_provider = streak_reward AND is_comp, so it can never touch a paying subscriber.';

-- ── 5. THE SCHEDULE, IN THE SAME MIGRATION AS THE GRANT ─────────────────────
-- A grant with an expiry function nobody calls is a grant with no expiry. HOURLY rather than
-- daily, so a comp ends within an hour of its thirty days instead of up to a day late; at :07 to
-- stay off the top-of-hour pile-up with the nine jobs already scheduled here. Pure SQL — no HTTP
-- hop, no CRON_SECRET, nothing to leak or misconfigure.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'streak-reward-expiry-hourly') then
    perform cron.unschedule('streak-reward-expiry-hourly');
  end if;
  perform cron.schedule('streak-reward-expiry-hourly', '7 * * * *',
                        'select public.expire_streak_rewards();');
exception when undefined_table or undefined_function then
  -- A local stack without pg_cron still gets the functions; only the schedule is skipped.
  raise notice 'pg_cron not available; schedule streak-reward-expiry-hourly by hand';
end $$;

-- ── PROVED END TO END AGAINST THE LIVE DATABASE ─────────────────────────────
-- On a throwaway auth user, every call made AS THE `authenticated` ROLE with a real JWT claim —
-- the same path the app takes:
--   0. the profile is found BY user_id and its zone is America/New_York (this caught the id/user_id
--      bug above: 0 of 46 profiles have id = user_id, so the first version silently used UTC);
--   1. 29 consecutive days  -> refused, reason `streak_too_short`;
--   2. the 30th day         -> GRANTED, and `user_subscriptions` really carries
--                              plan=premium, status=active, is_comp=true, a period end 30 days out;
--   3. an immediate second claim -> refused, reason `already_active`;
--   4. `expire_streak_rewards()` after the window -> status canceled, plan free, ledger row revoked;
--   5. a fresh claim after expiry -> GRANTED again, so the reward can be re-earned.
-- The throwaway user was deleted and the database verified back at 6 achievements rows, 0
-- streak_rewards rows and 0 probe users. The check constraint `streak_rewards_window_check` refused
-- an earlier, lazier version of step 4 — the constraint doing its job, so the probe was fixed
-- rather than the constraint.

commit;
