-- THE DISCRIMINATING PAIR FOR `suggest_profiles_by_username`, AND IT ROLLS BACK.
-- ============================================================================
-- `f8da9783` shipped the username typeahead and said in its own commit subject that it was
-- NOT YET VERIFIED. What it named as missing was exactly this:
--
--   "THE DISCRIMINATING PAIR HAS NOT RUN. The load-bearing assertion is 'a PUBLIC account IS
--    suggested AND a PRIVATE one is NOT', and only the second half is currently true-by-vacuum,
--    since nothing is public. A test that only asserts the private one is absent is satisfied
--    perfectly by a function that returns nothing at all."
--
-- It could not run because `profiles.visibility` defaults to `'private'` and ZERO profiles are
-- public - which is the feature working, and is also indistinguishable from the feature being
-- completely broken. So the missing half has to be MANUFACTURED, and that is what this does.
--
-- ⚠️ WHY A ROLLED-BACK TRANSACTION RATHER THAN A TEST FIXTURE. The only way to get a public
-- profile is to make one, and every profile in this database belongs to a real person. Creating
-- a permanent public test account would put a stranger's name in the live typeahead for every
-- real user. So the flip happens inside a transaction that ends in ROLLBACK: no other connection
-- ever sees it (MVCC), and nothing is committed. The row that IS flipped is the `@forgenta.test`
-- walk account, never a real user's, so even a failure to roll back would be recoverable.
--
-- ⚠️ AND THE ROLLBACK IS VERIFIED FROM OUTSIDE THE TRANSACTION, not assumed - see the second
-- script at the bottom. A rollback you did not read back is a rollback you have not checked, and
-- this repo already records a reset whose verification ran before the system could undo it.
--
-- ⚠️ THIS IS NOT PART OF `npm test` AND CANNOT BE. It needs service-role access to flip a row
-- and to set `request.jwt.claims`, which no gate in this repo has and which CI must never have.
-- The CLIENT half - the dropdown, the minimum prefix on screen, the empty state that explains
-- itself, and what a press hands back - IS a normal gate and lives in
-- `src/components/settings/__tests__/UsernameSuggestions.test.tsx`.
--
-- RUN IT: paste into the Supabase SQL editor, or through the Supabase MCP `execute_sql`.
-- Substitute the two ids for whatever this database holds at the time.
--
-- RESULT, 2026-09-17, project mdtosrbfkextcaezuclh - all seven PASS:
--   A private target is NOT suggested                    expected 0  got 0
--   B public target IS suggested (POSITIVE CONTROL)      expected 1  got 1
--   C one-character prefix returns nothing               expected 0  got 0
--   D wildcard cannot widen to match everything          expected 0  got 0
--   E substring from the middle does not match           expected 0  got 0
--   F caller is excluded from their own results          expected 0  got 0
--   G row carries 3 columns only                         expected 3  got 3
-- and afterwards, read back from outside: 0 public profiles, walkprobe `private`, 33 profiles
-- total (a non-zero control proving the reader works), anon EXECUTE false, authenticated true.
--
-- WHAT IT DOES NOT COVER, said plainly: it does not exercise the dropdown, it does not go through
-- PostgREST (it simulates the JWT claims directly, so a grant that PostgREST would refuse for a
-- different reason is not covered - the grant pair is asserted separately), and it says nothing
-- about how the suggestion behaves once it is picked.
-- ============================================================================

-- The caller, and the target whose visibility is flipped. The target MUST be a test account.
--   caller = treforged1  a72f416e-433a-4055-9ab0-9feae4e60edf
--   target = walkprobe   0c44347d-8b0e-4ffb-8938-ad17bf3112a7  (deck-walk@forgenta.test)

begin;
create temp table probe(arm text, expected int, got int) on commit drop;
-- The arms run as `authenticated`, which cannot write to a temp table it does not own.
grant insert, select on probe to authenticated;

-- ARM A - the shipped state. Target private.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a72f416e-433a-4055-9ab0-9feae4e60edf","role":"authenticated"}';
insert into probe
select 'A private target is NOT suggested', 0, count(*)::int
from public.suggest_profiles_by_username('wa');
reset role;

-- Manufacture the missing half. Rolled back below.
update public.profiles set visibility = 'public'
 where user_id = '0c44347d-8b0e-4ffb-8938-ad17bf3112a7';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a72f416e-433a-4055-9ab0-9feae4e60edf","role":"authenticated"}';

-- ARM B - THE POSITIVE CONTROL. Read this one first: without it, A and C through F are all
-- satisfied by a function that returns nothing at all.
insert into probe
select 'B public target IS suggested (POSITIVE CONTROL)', 1, count(*)::int
from public.suggest_profiles_by_username('wa');

-- ARM C - one character must not enumerate. With a 1-char minimum, 26 queries list everybody.
insert into probe
select 'C one-character prefix returns nothing', 0, count(*)::int
from public.suggest_profiles_by_username('w');

-- ARM D - a smuggled wildcard must not widen the pattern to match everything.
insert into probe
select 'D wildcard cannot widen to match everything', 0, count(*)::int
from public.suggest_profiles_by_username('%%');

-- ARM E - prefix, never substring. A substring match can be walked from the middle.
insert into probe
select 'E substring from the middle does not match', 0, count(*)::int
from public.suggest_profiles_by_username('lkprobe');

-- ARM F - you are never suggested to yourself.
set local request.jwt.claims = '{"sub":"0c44347d-8b0e-4ffb-8938-ad17bf3112a7","role":"authenticated"}';
insert into probe
select 'F caller is excluded from their own results', 0, count(*)::int
from public.suggest_profiles_by_username('wa');

-- ARM G - what the row carries. No email, no visibility, no counts.
set local request.jwt.claims = '{"sub":"a72f416e-433a-4055-9ab0-9feae4e60edf","role":"authenticated"}';
insert into probe
select 'G row carries 3 columns only', 3,
       (select count(*)::int from json_object_keys(
          (select row_to_json(t) from public.suggest_profiles_by_username('wa') t limit 1)));
reset role;

select arm, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict
from probe order by arm;
rollback;

-- ============================================================================
-- RUN THIS SECOND, AS ITS OWN STATEMENT. It is the only thing that proves the rollback held,
-- and `total_profiles_control` is there so that a reader of zeroes can tell "nothing is public"
-- apart from "this query matched nothing".
-- ============================================================================
-- select
--   (select count(*) from public.profiles where visibility = 'public') as public_profiles_now,
--   (select visibility from public.profiles
--     where user_id = '0c44347d-8b0e-4ffb-8938-ad17bf3112a7') as walkprobe_visibility,
--   (select count(*) from public.profiles) as total_profiles_control,
--   has_function_privilege('anon',
--     'public.suggest_profiles_by_username(text)', 'EXECUTE') as anon_can_execute,
--   has_function_privilege('authenticated',
--     'public.suggest_profiles_by_username(text)', 'EXECUTE') as authenticated_can_execute;
