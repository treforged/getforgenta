-- EVERY STOP GETS ITS OWN RANK AND ITS OWN AUTO-EXTRA TICK (Tre, 2026-08-26)
--
-- His words: *"each part of the stagger should always have the choice of extra payments. and each
-- should be freely re-orderable around the other items. just stay in their relative order. for
-- example, emergercy 2 should be behind all the credit cards, then 3 is behind the loan."*
--
-- So a stop stops being a projection of its goal and becomes a row in its own right. Two new keys
-- inside each `savings_goals.stages` entry:
--   sort_order  its rank in "Where the extra money goes", alongside the cards and the loans
--   auto_extra  its own tick
--
-- ⚠️ THIS RETIRES `after_cards`. A stop said "wait for the cards" with a flag only because it had
-- nowhere to sit; now it says it by SITTING there, and a flag repeating the same thing in a second
-- language could only ever come to disagree with the list. The key is left in place (the reader
-- still uses it to seed a default rank for a row this backfill misses) but is never written again —
-- and it could never have expressed "behind the LOAN", which is half of what he asked for.
--
-- No new column, no new constraint: `savings_goal_stages_valid` checks the sizing keys and is
-- deliberately silent about everything else, so an entry may carry extra keys.

-- ── BACKFILL ────────────────────────────────────────────────────────────────
--
-- Seeded so nobody's money moves on deploy:
--   • stop 1        the goal's own `sort_order` — exactly where the goal already sat
--   • a plain stop  one rank under the stop above it, where the list already drew it
--   • an after_cards stop  past EVERY ranked thing this user owns, which is what the flag meant.
--     Not "just after the cards": that is a position this statement cannot compute for a user
--     whose cards are inside the block, and a guess would move real money. Bottom of the list is
--     the conservative reading of "last", and one drag corrects it.
--   • auto_extra    the goal's own column on stop 1, FALSE on the rest. A stop nobody has ever
--     seen a tick for must not start diverting cash on deploy.
with ranked as (
  select
    g.id as goal_id,
    g.user_id,
    (
      select coalesce(max(r), 0) + 1 from (
        select max(a.surplus_sort_order) as r from public.accounts a where a.user_id = g.user_id
        union all
        select max(c.sort_order) from public.car_funds c where c.user_id = g.user_id
        union all
        select max(s2.sort_order) from public.savings_goals s2 where s2.user_id = g.user_id
        union all
        select max(p.cards_sort_order) from public.profiles p where p.user_id = g.user_id
      ) all_ranks
    ) as below_everything
  from public.savings_goals g
  where jsonb_array_length(g.stages) > 0
)
update public.savings_goals g
set stages = (
  select jsonb_agg(
    stop || jsonb_build_object(
      'sort_order', case
        when ord = 1 then g.sort_order
        when (stop -> 'after_cards')::text = 'true' then ranked.below_everything
        else g.sort_order + (ord - 1)
      end,
      'auto_extra', case when ord = 1 then g.auto_extra else false end
    )
    order by ord
  )
  from jsonb_array_elements(g.stages) with ordinality as t(stop, ord)
)
from ranked
where ranked.goal_id = g.id
  and not exists (
    select 1 from jsonb_array_elements(g.stages) as s where s ? 'sort_order'
  );
