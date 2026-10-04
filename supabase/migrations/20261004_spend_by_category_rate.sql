-- spend-by-category rate limit (ask fbc5671a, Leo's month-to-date spending by category).
-- Same shape as money_glance_rate_ok (20261001f): counts ONLY the caller's own key and returns one
-- boolean. Definer only because rate_limits is revoked from users. Its own key prefix, so Leo's
-- two reads do not share one 30/min budget.
begin;

create or replace function public.spend_by_category_rate_ok()
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
    from public.rate_limit_check('spend-by-category:' || uid::text, 60000::bigint, 30) r;
  return coalesce(ok, false);
end;
$$;

comment on function public.spend_by_category_rate_ok() is
  'spend-by-category rate limit (30/min): counts only the CALLER''s own key and returns one boolean. Definer only because rate_limits is revoked from users.';

revoke execute on function public.spend_by_category_rate_ok() from public, anon;
grant execute on function public.spend_by_category_rate_ok() to authenticated;

commit;
