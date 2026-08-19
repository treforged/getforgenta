-- Slice 6 -- global store->category learning. APPLIED to project mdtosrbfkextcaezuclh 2026-08-19.
-- Kept here so the schema is reviewable in the repo, not only in the dashboard.
--
-- WARNING: nothing here lives in `public`. Verified on this project 2026-08-19: the default ACLs on
-- schema public grant `arwdDxtm` (ALL) to BOTH `anon` and `authenticated` for every new table, so a
-- table created there is world-writable the instant it exists -- the 2026-06-15 enumeration lesson
-- in the same database. These tables have no grants, no schema USAGE, RLS on and NO policies, and
-- are reachable only through the two SECURITY DEFINER functions below.
--
-- WARNING: the distinct-voter floor is the privacy control, and it is not decoration. A normalized
-- merchant key is not always a business -- this account's own memory holds "Zelle payment from
-- ARIA...". A pair is only returned once >= 3 DIFFERENT people independently agree; a private payee
-- has one voter forever. A caller may raise the floor and can never lower it.

create schema if not exists crowd;
revoke all on schema crowd from anon, authenticated, public;

create table if not exists crowd.merchant_category_ballot (
  merchant_key text not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null,
  updated_at   timestamptz not null default now(),
  primary key (merchant_key, user_id)
);

create table if not exists crowd.merchant_category_tally (
  merchant_key text not null,
  category     text not null,
  voters       integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (merchant_key, category)
);

alter table crowd.merchant_category_ballot enable row level security;
alter table crowd.merchant_category_tally  enable row level security;
revoke all on all tables in schema crowd from anon, authenticated, public;

create or replace function public.record_merchant_category_vote(
  p_merchant_key text, p_category text
) returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_user uuid := auth.uid();
  v_key  text := nullif(btrim(p_merchant_key), '');
  v_cat  text := nullif(btrim(p_category), '');
begin
  if v_user is null then
    raise exception 'record_merchant_category_vote requires an authenticated caller';
  end if;
  if v_key is null or v_cat is null then return; end if;
  if length(v_key) > 200 or length(v_cat) > 64 then
    raise exception 'merchant key or category too long';
  end if;

  insert into crowd.merchant_category_ballot (merchant_key, user_id, category, updated_at)
  values (v_key, v_user, v_cat, now())
  on conflict (merchant_key, user_id)
  do update set category = excluded.category, updated_at = now();

  -- Recompute rather than increment: a user CHANGING their mind must decrement the old category
  -- too, and an increment-only counter silently accumulates votes nobody still holds.
  delete from crowd.merchant_category_tally t where t.merchant_key = v_key;
  insert into crowd.merchant_category_tally (merchant_key, category, voters, updated_at)
  select b.merchant_key, b.category, count(*)::int, now()
  from crowd.merchant_category_ballot b
  where b.merchant_key = v_key
  group by b.merchant_key, b.category;
end;
$fn$;

create or replace function public.crowd_merchant_categories(p_min_voters integer default 3)
returns table (merchant_key text, category text, voters integer)
language sql stable security definer set search_path = '' as $fn$
  select distinct on (t.merchant_key) t.merchant_key, t.category, t.voters
  from crowd.merchant_category_tally t
  where t.voters >= greatest(coalesce(p_min_voters, 3), 3)
  order by t.merchant_key, t.voters desc, t.category asc;
$fn$;

revoke all on function public.record_merchant_category_vote(text, text) from public, anon;
revoke all on function public.crowd_merchant_categories(integer)        from public, anon;
grant execute on function public.record_merchant_category_vote(text, text) to authenticated;
grant execute on function public.crowd_merchant_categories(integer)        to authenticated;
