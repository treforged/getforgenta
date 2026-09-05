-- A comped subscription is not a subscriber. Say so in a column, not in a heuristic.
--
-- Tre, 2026-09-05: *"fix the reporting bug so comps dont count as subscribers."*
--
-- ── THE BUG ──────────────────────────────────────────────────────────────────
-- `revenue_summary_lines()` grouped `user_subscriptions` by provider/plan/status and
-- reported five ACTIVE STRIPE PREMIUM subscriptions. Read against Stripe itself on
-- 2026-09-05, live mode: eight subscriptions, six active, EVERY ONE carrying a discount,
-- five of the six with no `default_payment_method` at all -- and exactly ONE charge in the
-- account's entire history, $4.99 on 2026-03-26, billed to Tre's own card while testing
-- his own checkout. No customer money has ever moved. The function was reporting comps as
-- traction.
--
-- ── WHY A COLUMN AND NOT A RULE ──────────────────────────────────────────────
-- The obvious rule -- "a comp is a row with no `stripe_subscription_id`" -- is PROVABLY
-- INSUFFICIENT. Four of the five are that shape; the fifth holds a real Stripe subscription
-- id and is still a comp, because the comp lives in a 100% discount attached to the
-- subscription at Stripe. That discount is not in this database and cannot be, so no SQL
-- predicate over these columns can ever classify that row correctly. Inference here is not
-- merely fragile, it is impossible.
--
-- So the fact is stored. A wrong column value is visible and fixable; a wrong inference is
-- neither.
--
-- ── WHY THE DEFAULT IS TRUE, WHICH LOOKS BACKWARDS ───────────────────────────
-- Because the two failure directions are not equally bad. If a write path forgets to mark a
-- real purchase, Tre sees FEWER paying subscribers than he has -- he notices, and he asks.
-- If it forgets the other way, he sees revenue that does not exist, which is exactly the
-- mistake being fixed here and the expensive one: it reads as traction and gets planned
-- against. Defaulting to `true` makes the forgetful case fail in the safe direction.
--
-- ── THE BACKFILL IS A FACT, NOT A GUESS ──────────────────────────────────────
-- Every existing row is marked comped, because the Stripe read above proves that no real
-- purchase has ever been completed on this account. This is not a heuristic applied to
-- history; it is history.

alter table public.user_subscriptions
  add column if not exists is_comp boolean not null default true;

comment on column public.user_subscriptions.is_comp is
  'TRUE unless a real payment has been observed for this subscription. Defaults TRUE so a '
  'forgotten write under-reports revenue rather than inventing it. Set FALSE by the Stripe '
  'webhook when an invoice is paid with amount_paid > 0. A 100%-discount subscription is a '
  'comp even though it carries a real stripe_subscription_id, which is why this cannot be '
  'inferred from the columns here.';

-- Explicit and idempotent: every row that existed before this migration predates any real
-- purchase. Verified against Stripe live mode 2026-09-05 (one charge ever, Tre's own).
update public.user_subscriptions set is_comp = true where is_comp is distinct from true;

-- ── THE REPORT ───────────────────────────────────────────────────────────────
-- Comps are counted SEPARATELY AND LABELLED, never silently dropped. How many people are
-- being carried for free is real information Tre wants; it just must never be totalled as
-- revenue. A function that says "5 active" and one that says "0 paying, 5 comped" are
-- different products, and this is the second.
--
-- The shape gains one column rather than changing the existing ones, so `revenue-push` keeps
-- reading `provider`, `plan`, `status`, `count` and `ending` exactly as before.
-- Adding an OUT column changes the row type, which CREATE OR REPLACE cannot do. Dropping
-- first is safe here: the sole caller is the revenue-push edge function, which calls it by
-- name at runtime rather than holding a dependency the drop would cascade into.
drop function if exists public.revenue_summary_lines();

create function public.revenue_summary_lines()
returns table(provider text, plan text, status text, count bigint, ending bigint, comped bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(s.purchase_provider, '(unrecorded)')  as provider,
         coalesce(s.plan, '(none)')                     as plan,
         coalesce(s.subscription_status, '(none)')      as status,
         -- PAYING only. This is the number that may ever be called revenue.
         count(*) filter (where not s.is_comp)          as count,
         count(*) filter (where not s.is_comp and s.cancel_at_period_end) as ending,
         -- Carried for free. Real information, kept visible, never added to the above.
         count(*) filter (where s.is_comp)              as comped
    from public.user_subscriptions s
   group by 1, 2, 3;
$function$;

-- The grant this function must NOT have. See 20260905_revoke_revenue_summary_from_public.sql:
-- a freshly created function gets the default PUBLIC EXECUTE grant, so the revoke is repeated
-- here or the leak silently reopens every time the function is redefined.
revoke execute on function public.revenue_summary_lines() from public;
revoke execute on function public.revenue_summary_lines() from anon;
revoke execute on function public.revenue_summary_lines() from authenticated;
grant execute on function public.revenue_summary_lines() to service_role;
