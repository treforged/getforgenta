-- ============================================================================
-- Video-testimonial promo (ask a868f7c3, Tre 2026-10-06): an APPROVED testimonial earns the
-- submitter 3 free months of Premium. Ruby reviews the video; Ada runs the grant for that user.
-- ============================================================================
--
-- ── SAME SHAPE AS THE STREAK REWARD (20260905_streak_reward_grant.sql) ──────
-- The entitlement is a comped `user_subscriptions` row (premium truth lives in this database),
-- marked `is_comp` so it never counts as revenue, and stamped
-- `purchase_provider = 'testimonial_reward'` so expiry finds exactly these rows and nothing else.
-- No Stripe coupon and no promo code: there is nothing a user could copy, share or reuse.
--
-- ── WHAT DIFFERS, AND WHY ───────────────────────────────────────────────────
--  * STAFF RUN IT, NOT THE USER. Approval is a human judgement made outside the app, so there is no
--    client-callable claim. `grant_testimonial_reward()` is SERVICE ROLE ONLY. A client that could
--    call it could award itself three months.
--  * ONCE PER USER, EVER. A ledger row is kept even after expiry, and any earlier grant refuses a
--    second one. One testimonial, one reward.
--  * NEVER OVER MONEY. A user whose row is premium + active/trialing/past_due and NOT comp is
--    refused ('already_paying'): a comp would erase a paid period end and mark revenue as comped.
--    Past_due is included because premium-entitlement.ts treats it as entitled (billing grace).
--
-- ── EXPIRY SHIPS WITH THE GRANT ─────────────────────────────────────────────
-- `isPremium` does not read `current_period_end`, and a comp has no webhook. Without the hourly
-- job below, "3 months" would be Premium forever. Scoped to provider = 'testimonial_reward' AND
-- is_comp AND the period actually over, so even a wrong run cannot touch a paying subscriber.
--
-- After expiry the row is plan 'free' with provider 'testimonial_reward'. That keeps the user
-- eligible for the first-year intro offer (intro-eligibility.ts counts only apple/google as a
-- past purchase): they never paid.
--
-- ── REVERSING THIS ──────────────────────────────────────────────────────────
-- select cron.unschedule('testimonial-reward-expiry-hourly');
-- drop function public.grant_testimonial_reward(uuid, text);
-- drop function public.expire_testimonial_rewards();
-- drop table public.testimonial_rewards;
-- To end one grant early: update its user_subscriptions.current_period_end to now(), then
-- select public.expire_testimonial_rewards();

begin;

-- ── 1. THE GRANT LEDGER ─────────────────────────────────────────────────────
create table if not exists public.testimonial_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- What was approved (a submission id or permalink). Free text, staff-supplied, never shown.
  reference text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint testimonial_rewards_reference_check check (length(btrim(reference)) between 1 and 500),
  constraint testimonial_rewards_window_check check (expires_at > granted_at),
  -- One reward per user, ever.
  constraint testimonial_rewards_one_per_user unique (user_id)
);

create index if not exists testimonial_rewards_open_idx
  on public.testimonial_rewards (expires_at) where revoked_at is null;

alter table public.testimonial_rewards enable row level security;

-- Owner may read their own grant. No insert/update/delete policy for anyone: the only writer is
-- the SECURITY DEFINER function below, callable by the service role only.
drop policy if exists testimonial_rewards_select_own on public.testimonial_rewards;
create policy testimonial_rewards_select_own on public.testimonial_rewards
  for select using (user_id = auth.uid());

revoke all on public.testimonial_rewards from anon, authenticated;
grant select on public.testimonial_rewards to authenticated;

-- ── 2. THE GRANT ────────────────────────────────────────────────────────────
create or replace function public.grant_testimonial_reward(p_user uuid, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sub record;
  v_expires timestamptz;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    return jsonb_build_object('granted', false, 'reason', 'no_such_user');
  end if;

  if p_reference is null or length(btrim(p_reference)) = 0 then
    return jsonb_build_object('granted', false, 'reason', 'reference_required');
  end if;

  if exists (select 1 from public.testimonial_rewards r where r.user_id = p_user) then
    return jsonb_build_object('granted', false, 'reason', 'already_granted');
  end if;

  select * into v_sub from public.user_subscriptions where user_id = p_user;
  if found
     and v_sub.plan = 'premium'
     and v_sub.subscription_status in ('active', 'trialing', 'past_due')
     and not v_sub.is_comp then
    return jsonb_build_object('granted', false, 'reason', 'already_paying');
  end if;

  v_expires := now() + interval '3 months';

  insert into public.testimonial_rewards (user_id, reference, expires_at)
  values (p_user, btrim(p_reference), v_expires);

  insert into public.user_subscriptions
    (user_id, plan, subscription_status, current_period_end, cancel_at_period_end,
     purchase_provider, is_comp)
  values
    (p_user, 'premium', 'active', v_expires, true, 'testimonial_reward', true)
  on conflict (user_id) do update set
    plan = 'premium',
    subscription_status = 'active',
    -- Never SHORTEN an open comp (e.g. a streak reward running longer): keep the later end.
    current_period_end = greatest(excluded.current_period_end,
                                  case when user_subscriptions.is_comp
                                       then user_subscriptions.current_period_end end),
    cancel_at_period_end = true,
    purchase_provider = 'testimonial_reward',
    is_comp = true,
    updated_at = now();

  return jsonb_build_object('granted', true, 'expires_at', v_expires);
end;
$function$;

-- ── 3. EXPIRY ───────────────────────────────────────────────────────────────
create or replace function public.expire_testimonial_rewards()
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
   where s.purchase_provider = 'testimonial_reward'
     and s.is_comp
     and s.subscription_status = 'active'
     and s.current_period_end is not null
     and s.current_period_end <= now();
  get diagnostics v_count = row_count;

  update public.testimonial_rewards
     set revoked_at = now()
   where revoked_at is null and expires_at <= now();

  return v_count;
end;
$function$;

-- SECURITY DEFINER functions get PUBLIC EXECUTE on creation; take it away explicitly.
revoke execute on function public.grant_testimonial_reward(uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_testimonial_rewards() from public, anon, authenticated;
grant execute on function public.grant_testimonial_reward(uuid, text) to service_role;
grant execute on function public.expire_testimonial_rewards() to service_role;

comment on function public.grant_testimonial_reward(uuid, text) is
  'Staff-only: 3 months of comped Premium for an approved video testimonial (ask a868f7c3). Once per user, never over a paying subscription, expires via expire_testimonial_rewards().';
comment on function public.expire_testimonial_rewards() is
  'Ends testimonial comps whose period is over. Service role only. Scoped to purchase_provider = testimonial_reward AND is_comp.';

-- ── 4. THE SCHEDULE ─────────────────────────────────────────────────────────
-- Hourly at :09, beside the streak job at :07.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'testimonial-reward-expiry-hourly') then
    perform cron.unschedule('testimonial-reward-expiry-hourly');
  end if;
  perform cron.schedule('testimonial-reward-expiry-hourly', '9 * * * *',
                        'select public.expire_testimonial_rewards();');
exception when undefined_table or undefined_function then
  raise notice 'pg_cron not available; schedule testimonial-reward-expiry-hourly by hand';
end $$;

commit;
