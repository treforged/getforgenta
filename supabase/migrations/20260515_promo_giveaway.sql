-- Promo giveaway: track new users + qualify after 7 activity days + random winner pull

-- Active promo campaigns (admin-managed)
create table if not exists public.promo_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  prize         text not null default 'Free Premium for 1 Year',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One entry per user per campaign; qualified after 7 activity days
create table if not exists public.promo_entries (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.promo_campaigns(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  enrolled_at     timestamptz not null default now(),
  activity_days   int not null default 0,
  qualified       boolean not null default false,
  qualified_at    timestamptz,
  is_winner       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (campaign_id, user_id)
);

-- Daily activity log (one row per user per UTC day)
create table if not exists public.promo_activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.promo_campaigns(id) on delete cascade,
  activity_date date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (user_id, campaign_id, activity_date)
);

-- RLS: users can only see/insert their own rows
alter table public.promo_campaigns   enable row level security;
alter table public.promo_entries     enable row level security;
alter table public.promo_activity_log enable row level security;

-- Campaigns: readable by all authenticated users
create policy "campaigns_select" on public.promo_campaigns
  for select to authenticated using (true);

-- Entries: users see their own
create policy "entries_select_own" on public.promo_entries
  for select to authenticated using (auth.uid() = user_id);

-- Activity log: users insert/select their own
create policy "activity_select_own" on public.promo_activity_log
  for select to authenticated using (auth.uid() = user_id);

create policy "activity_insert_own" on public.promo_activity_log
  for insert to authenticated with check (auth.uid() = user_id);

-- Auto-enroll new users who sign up during an active campaign
create or replace function public.auto_enroll_promo_user()
returns trigger language plpgsql security definer as $$
declare
  v_campaign record;
begin
  select * into v_campaign
  from public.promo_campaigns
  where is_active = true
    and starts_at <= now()
    and ends_at >= now()
  order by created_at desc
  limit 1;

  if found then
    insert into public.promo_entries (campaign_id, user_id)
    values (v_campaign.id, new.id)
    on conflict (campaign_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_auto_enroll_promo
  after insert on auth.users
  for each row execute function public.auto_enroll_promo_user();

-- Record a daily activity ping and update qualification status
create or replace function public.record_promo_activity(p_campaign_id uuid)
returns void language plpgsql security definer as $$
declare
  v_days int;
begin
  -- Log today (upsert — idempotent)
  insert into public.promo_activity_log (user_id, campaign_id, activity_date)
  values (auth.uid(), p_campaign_id, current_date)
  on conflict (user_id, campaign_id, activity_date) do nothing;

  -- Count distinct days
  select count(*) into v_days
  from public.promo_activity_log
  where user_id = auth.uid() and campaign_id = p_campaign_id;

  -- Update entry
  update public.promo_entries
  set
    activity_days = v_days,
    qualified     = (v_days >= 7),
    qualified_at  = case when v_days >= 7 and qualified = false then now() else qualified_at end
  where user_id = auth.uid() and campaign_id = p_campaign_id;
end;
$$;

-- Admin: pick a random winner from qualified entries
create or replace function public.draw_promo_winner(p_campaign_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_winner_id uuid;
begin
  -- Clear any previous winner for this campaign
  update public.promo_entries
  set is_winner = false
  where campaign_id = p_campaign_id;

  -- Pick one random qualified entry
  select user_id into v_winner_id
  from public.promo_entries
  where campaign_id = p_campaign_id and qualified = true
  order by random()
  limit 1;

  if v_winner_id is null then
    raise exception 'No qualified entries found for campaign %', p_campaign_id;
  end if;

  update public.promo_entries
  set is_winner = true
  where campaign_id = p_campaign_id and user_id = v_winner_id;

  return v_winner_id;
end;
$$;

-- Index for fast lookups
create index if not exists idx_promo_entries_campaign on public.promo_entries(campaign_id);
create index if not exists idx_promo_entries_user on public.promo_entries(user_id);
create index if not exists idx_promo_activity_user_campaign on public.promo_activity_log(user_id, campaign_id);
