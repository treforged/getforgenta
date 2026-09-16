-- PMF RESPONSES FROM REAL PEOPLE ONLY.
--
-- WHY. `scripts/check-pmf-survey.mjs` exercises the survey end to end, which means it
-- WRITES a `very_disappointed` row for the walk account `deck-walk@forgenta.test`. That is
-- the qualifying sentiment - the exact one a Sean Ellis score counts in its numerator - and
-- it carries an empty `would_miss`, so it is a QUALIFYING row that says nothing.
--
-- FOUND BY RUBY (tre-forged-marketing), 2026-09-16, and the cost was already real rather
-- than hypothetical: she reads `would_miss` to write the product's lead message, THE COUNT
-- SAID 1 AND THE ROW SAID NOTHING, and had she taken the count and stopped she would have
-- published a positioning line attributed to a customer who does not exist.
--
-- ⚠️ ONE CORRECTION TO THE REPORT, because the difference changes what the fix must be.
-- Her message said the 40% threshold "would be computed over" a poisoned numerator. Nothing
-- in this repo computes that threshold today - the only readers of `pmf_responses` are the
-- modal (which reads the CURRENT USER'S own row) and the generated types, and
-- `src/lib/pmf-survey.ts` says in its header that the 40% figure is a CITATION of a known
-- benchmark, not a result measured here. Verified by grepping every reader.
--
-- THAT MAKES THE FIX MORE IMPORTANT, NOT LESS. Because no aggregate query exists yet,
-- there is no query to add an exclusion to, and the person who writes the first one will
-- have no reason to suspect the table. A filter placed at a call site that does not exist
-- protects nothing. So the exclusion lives in the DATABASE, where it is the default thing
-- a future reader selects from.
--
-- WHY A VIEW RATHER THAN CLEANING UP AFTER THE GATE. Ruby's own reasoning, and it is right:
-- a gate that tidies up is one crashed run away from leaving a row behind. The view survives
-- that. The gate also legitimately needs to write a QUALIFYING row - that is the path it is
-- testing - so making it write a non-qualifying sentiment would weaken the gate to protect
-- the data, which is the wrong trade.
--
-- THE ROW IS NOT DELETED. It is evidence that the gate ran, the table deliberately carries
-- no DELETE grant for clients, and a destructive write to production to tidy analytics is
-- not worth the risk when a filter does the same job reversibly.
--
-- UNDO:  drop view if exists public.pmf_responses_real;

create or replace view public.pmf_responses_real
with (security_invoker = true)
as
select r.*
from public.pmf_responses r
where exists (
  select 1
  from auth.users u
  where u.id = r.user_id
    -- Reserved TLDs, RFC 2606 / RFC 6761. These can never be delivered to a real mailbox,
    -- so an account under one is never a customer. Matching on the TLD rather than on the
    -- specific walk address means the next throwaway account is excluded automatically -
    -- a hand-named exclusion list is blind to the account nobody added to it.
    and u.email !~* '@[^@]*\.(test|example|invalid|localhost)$'
);

comment on view public.pmf_responses_real is
  'PMF survey responses from real accounts only. Reserved-TLD accounts (.test/.example/.invalid/.localhost) are test fixtures - check-pmf-survey.mjs writes a qualifying row for deck-walk@forgenta.test on every run. COMPUTE ANY SEAN ELLIS SCORE FROM THIS VIEW, NEVER FROM public.pmf_responses.';

comment on table public.pmf_responses is
  'Raw PMF survey responses, INCLUDING test-fixture accounts. For any aggregate or threshold, select from public.pmf_responses_real instead - this table contains a qualifying row written by the gate.';

-- `security_invoker` matters: without it the view would run as its owner and hand any
-- caller rows the table's RLS would refuse them. With it, the existing per-user RLS on
-- `pmf_responses` still applies, so this view widens nobody's access - it only narrows the
-- row set. No new grants: whoever can read the table can read the view, and nobody else.
grant select on public.pmf_responses_real to authenticated, service_role;
