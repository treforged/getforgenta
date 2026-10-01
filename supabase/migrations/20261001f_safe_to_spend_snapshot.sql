-- Safe to Spend snapshot, for Leo's money glance (ask 1dc2c388; design forged-glass
-- docs/DESIGN-leo-money-glance.md).
-- ============================================================================
-- WHY A SNAPSHOT AND NOT A SERVER ENGINE. Safe to Spend is computed in the browser
-- (src/lib/safe-to-spend.ts on the client's projection engine). Porting that math to
-- an edge function would make a SECOND engine, and two engines drift until Leo and the
-- app show Tre different numbers for one question. So the dashboard publishes the
-- figure it already shows, and Leo reads that row.
--
-- WHY `horizon`. Since 8b9e50d0 the low point is the lowest balance from today to the
-- end of PAYDAY's month, paychecks included, so `low_date` can fall after `payday`.
-- `horizon` records how far the walk checked.
--
-- WHY A DEFINER RATE-LIMIT HELPER. `public.rate_limits` is revoked from users and the
-- money-glance function must not hold a service-role key (the app-will-be-sold rule).
-- `money_glance_rate_ok()` counts ONLY the caller's own key and returns one boolean;
-- the row itself is read through RLS with the caller's JWT.

begin;

create table if not exists public.safe_to_spend_snapshot (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  amount_cents    bigint not null check (amount_cents >= 0),
  payday          date not null,
  horizon         date not null,
  -- Can be negative: the lowest projected balance, before the floor comes off.
  low_point_cents bigint not null,
  low_date        date not null,
  floor_cents     bigint not null default 0 check (floor_cents >= 0),
  -- When the CLIENT computed the figure. Leo states the age from this.
  computed_at     timestamptz not null,
  updated_at      timestamptz not null default now(),
  constraint safe_to_spend_snapshot_horizon_check check (horizon >= payday)
);

comment on table public.safe_to_spend_snapshot is
  'The Safe to Spend figure the dashboard already shows, published so Leo reads the SAME number. One engine, not two.';

revoke all on public.safe_to_spend_snapshot from anon, authenticated;
-- No delete grant: the row goes with the user (on delete cascade).
grant select, insert, update on public.safe_to_spend_snapshot to authenticated;
alter table public.safe_to_spend_snapshot enable row level security;

create policy safe_to_spend_snapshot_select_own on public.safe_to_spend_snapshot
  for select to authenticated using (user_id = (select auth.uid()));

create policy safe_to_spend_snapshot_insert_own on public.safe_to_spend_snapshot
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy safe_to_spend_snapshot_update_own on public.safe_to_spend_snapshot
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.money_glance_rate_ok()
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ok boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select r.allowed into ok
    from public.rate_limit_check('money-glance:' || uid::text, 60000::bigint, 30) r;
  return coalesce(ok, false);
end;
$$;

comment on function public.money_glance_rate_ok() is
  'money-glance rate limit (30/min): counts only the CALLER''s own key and returns one boolean. Definer only because rate_limits is revoked from users.';

revoke execute on function public.money_glance_rate_ok() from public, anon;
grant execute on function public.money_glance_rate_ok() to authenticated;

commit;
