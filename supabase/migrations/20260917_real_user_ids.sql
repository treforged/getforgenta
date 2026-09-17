-- Which accounts are real people. Every user population should derive from this.
-- ============================================================================
-- WHY. Four RFC-reserved test accounts sit in `auth.users` and look like users to
-- every count. Measured 2026-09-17 against this project: **33 accounts with an
-- email, 4 reserved (2 @forgenta.test, 2 @example.com), 29 real.** So any
-- conversion, retention or engagement rate taken over 33 is wrong by 12% — and
-- the error is invisible, because 33 is a perfectly plausible number.
--
-- It bit two desks the same night, independently, and BOTH were caught by reading
-- the ROWS rather than the COUNT, which is luck rather than a control:
--   * marketing's retention audience was 29, of which 3 were reserved — sending
--     would have been 3 guaranteed hard bounces, a 10.3% rate on a domain that
--     has never sent bulk mail.
--   * this repo's PMF survey read its responses as real. Measured below: it is
--     **50% contaminated**.
--
-- ── WHERE THE CONTAMINATION ACTUALLY REACHES, measured, with a positive control
-- (the reserved set itself returning 4, so a zero cannot come from a broken join):
--     profiles               4 of 33   CONTAMINATED
--     pmf_responses          1 of  2   CONTAMINATED — half the sample
--     financial_connections  1 of 10   CONTAMINATED
--     leaderboard_snapshots  0 of  6   clean
--     leaderboard_shares     0 of  7   clean
--     achievements           0 of  5   clean
--     user_subscriptions     0 of 11   clean  (so revenue figures are unaffected)
--     device_tokens          0 of  9   clean  (so push figures are unaffected)
-- **The clean rows are worth as much as the dirty ones**: an unstated negative is
-- indistinguishable from a check nobody ran.
--
-- ── MATCH THE DOMAIN, NEVER THE LOCAL PART ─────────────────────────────────
-- A rule matching "test" anywhere silently drops a real person called
-- `testa@gmail.com`, and **dropping a real user is the more expensive error**.
-- Reserved domains are undeliverable BY STANDARD — a fact, not a guess about
-- intent.
--
-- ⚠️ THE SUBDOMAIN ALLOWANCE `(.*\.)?` IS LOAD-BEARING AND WAS A REAL BUG. Without
-- it, `c@sub.example.net` SURVIVES the filter. **The live count is 29 either way**,
-- so no amount of checking against real data can find it — only a synthetic
-- control can. That is why the controls below are an assertion that RUNS rather
-- than a comment, and why they are proven able to fail: with the allowance
-- removed, five addresses survive, including `@forgenta.test` itself.
--
-- ── IDS ONLY, AND NOT FOR CLIENTS ──────────────────────────────────────────
-- The view exposes NO email addresses, and is granted to `service_role` only. It
-- enumerates every account id in the product, which no client has a reason to
-- read, and it sits over a table full of personal data. Analytics runs
-- server-side; so does this.
--
-- UNDO: drop view if exists public.real_user_ids;
-- ============================================================================

begin;

create or replace view public.real_user_ids as
select u.id
  from auth.users u
 where u.email is not null
   and u.email !~* '@(.*\.)?(test|example|invalid|localhost)$'
   and u.email !~* '@(.*\.)?example\.(com|org|net)$';

revoke all on public.real_user_ids from public, anon, authenticated;
grant select on public.real_user_ids to service_role;

comment on view public.real_user_ids is
'Accounts that are real people: auth.users minus RFC-reserved (undeliverable) email domains. '
'Measured 2026-09-17: 33 with an email, 4 reserved, 29 real. A rate taken over 33 is wrong by 12%. '
'Match the DOMAIN, never the local part - testa@gmail.com is a real person. '
'The (.*\.)? subdomain allowance is load-bearing: without it sub.example.net survives, and the '
'live count is 29 either way, so only the synthetic controls in this migration can catch it.';

-- The controls, as an assertion that RUNS. A predicate copied without its
-- controls is one somebody will "simplify" later.
do $test$
declare
  v_wrong text;
  v_n     int;
begin
  with synth(email, must_keep) as (values
    -- KEEP: real people whose address merely CONTAINS a reserved word.
    ('testa@gmail.com', true), ('test@gmail.com', true), ('x@testing.io', true),
    ('y@example.io', true),      -- example.io is NOT reserved
    ('z@notexample.com', true),  -- proves this is not a substring match
    ('tre@treforged.com', true),
    -- DROP: RFC-reserved, undeliverable by standard.
    ('a@forgenta.test', false), ('b@example.com', false), ('c@example.org', false),
    ('d@sub.example.net', false),      -- load-bearing
    ('e@deep.sub.example.com', false),
    ('f@foo.invalid', false), ('g@localhost', false), ('h@my.test', false)
  ),
  judged as (
    select email, must_keep,
      (email is not null
       and email !~* '@(.*\.)?(test|example|invalid|localhost)$'
       and email !~* '@(.*\.)?example\.(com|org|net)$') as kept
    from synth
  )
  select count(*), string_agg(email, ', ') filter (where kept <> must_keep)
    into v_n, v_wrong
    from judged;

  -- A control that examined nothing must FAIL, or an empty corpus reads as a pass.
  if v_n <> 14 then
    raise exception 'real_user_ids control examined % cases, expected 14', v_n;
  end if;
  if v_wrong is not null then
    raise exception 'real_user_ids predicate is WRONG for: %', v_wrong;
  end if;

  -- If the view ever excludes nobody, either the predicate went inert or the test
  -- accounts were deleted. Both deserve a human look rather than a silent pass.
  if (select count(*) from public.real_user_ids)
     = (select count(*) from auth.users where email is not null) then
    raise warning 'real_user_ids excludes nobody - predicate inert, or reserved accounts removed';
  end if;
end;
$test$;

commit;
