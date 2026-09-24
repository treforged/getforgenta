-- business_user_counts() - the user figures the business rundown needs, as COUNTS ONLY.
--
-- Tre decided 2026-09-18 (cfd733a1): the APP publishes the business figure, and no
-- service-role key goes on a local disk, because he intends to sell the product.
-- This function is the publisher's read. The transport (a nightly push, like
-- revenue-push) is a separate step.
--
-- ⚠️ NOT PUBLIC. Execute is revoked from public, anon and authenticated and granted to
-- service_role only. A user count reachable by anyone is a disclosure about the business.
--
-- ⚠️ COUNTS, NEVER ROWS. It returns one row of integers. No id, no email, no date.
--
-- TEST ACCOUNTS are excluded by every RFC-reserved form (.test, .example, .invalid,
-- .localhost, and example.com/net/org), not only @forgenta.test. `excluded_reserved` is
-- returned on purpose: it is the positive control. A predicate that matched nothing would
-- report the same `real_users` as the total, and without this figure the two cannot be told
-- apart. Verified 2026-09-18 against live data: 33 / 4 / 29.
--
-- "Active" = signed in within the window (auth.users.last_sign_in_at). A session that stays
-- signed in without a new sign-in is NOT counted, so active_* is a floor, not an exact figure.
--
-- Does NOT survive per-user RLS, and cannot: it is a business aggregate across all users. It
-- is server-only by design, which is why execute is limited to service_role.

create or replace function public.business_user_counts()
returns table (
  total bigint,
  excluded_reserved bigint,
  real_users bigint,
  new_7d bigint,
  active_7d bigint,
  active_30d bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with u as (
    select
      created_at,
      last_sign_in_at,
      (email ~* '(\.test|\.example|\.invalid|\.localhost)$'
        or email ~* '@example\.(com|net|org)$') as reserved
    from auth.users
    where email is not null
  )
  select
    count(*)                                                                   as total,
    count(*) filter (where reserved)                                           as excluded_reserved,
    count(*) filter (where not reserved)                                       as real_users,
    count(*) filter (where not reserved and created_at >= now() - interval '7 days')       as new_7d,
    count(*) filter (where not reserved and last_sign_in_at >= now() - interval '7 days')  as active_7d,
    count(*) filter (where not reserved and last_sign_in_at >= now() - interval '30 days') as active_30d
  from u;
$$;

revoke all on function public.business_user_counts() from public, anon, authenticated;
grant execute on function public.business_user_counts() to service_role;
