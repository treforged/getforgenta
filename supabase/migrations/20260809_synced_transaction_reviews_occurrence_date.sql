-- §1B Stage 4A follow-up — a rule link records WHICH occurrence it settled, not just which month.
--
-- THE DEFECT THIS FIXES. `buildConfirmedOccurrences` keys a confirmation on `ruleId|YYYY-MM`, and
-- every consumer asks `isRuleOccurrenceConfirmed(ruleId, date, …)` with `date.slice(0, 7)`. For a
-- MONTHLY rule that is exact — one occurrence, one month. For a WEEKLY or BIWEEKLY rule there are
-- two or three occurrences in the same month, so confirming ONE of them suppressed ALL of them and
-- over-raised projected available cash by the amounts of the ones the user never confirmed.
-- Live on Tre's account: the biweekly `Fuel` rule ($65) already carries two `linked_rule` reviews,
-- both `occurrence_month = '2026-07'`.
--
-- ⚠️ WHY A DATE AND NOT A COUNT. The obvious cheaper fix is to count confirmations per rule+month
-- and suppress at most N occurrences. It is wrong, and one case decides it: the month-0 helpers only
-- charge occurrences AFTER the sync cutoff. Say Fuel lands Aug 3 and Aug 17 and today is Aug 9 — only
-- Aug 17 is still charged. The user confirms the bank row for the Aug 3 fill-up. Suppressing the
-- DATE Aug 3 correctly moves nothing (it was already past the cutoff); a count-based "suppress any
-- one" kills Aug 17 and wrongly raises cash by $65. The date is the fix; the count trades one wrong
-- answer for another. A date key also keeps every consumer a pure `has()` inside a `.filter()`,
-- where a running budget would make eight call sites order-dependent inside React memos.
--
-- ⚠️ NO "status='linked_rule' implies occurrence_date is not null" CHECK, and it is NOT the
-- ON DELETE SET NULL argument this time (nothing nulls this column) — it is that a NULL here is a
-- FIRST-CLASS legacy value. Every review written before this migration has one, and the read side
-- treats NULL as "month-keyed, behave exactly as before". Requiring it would invalidate 11 existing
-- rows. `occurrence_month` stays, stays required for links (`link_needs_month` is untouched), and
-- stays the coarse scope; this column only refines it.
--
-- ⚠️ THIS MIGRATION MOVES NO MONEY BY ITSELF. Existing rows keep NULL and keep month-keying, so
-- nothing already confirmed changes. Only links written from now on carry a date, and the only
-- behaviour that changes is the one that was wrong: a second occurrence of the same weekly/biweekly
-- rule in the same month stops being suppressed by the first one's confirmation.

alter table public.synced_transaction_reviews
  add column if not exists occurrence_date date;

comment on column public.synced_transaction_reviews.occurrence_date is
  'Which generated occurrence of the linked rule this charge settled (§1B). NULL = legacy, month-keyed. Always inside occurrence_month.';

-- The date must live inside the month the row already claims. The two columns are a coarse and a
-- fine scope of the SAME assertion, so a row saying "August" and "2026-07-25" would suppress a July
-- occurrence while every month-scoped query counted it as August — the pointer and its label
-- disagreeing silently, which is the failure mode this table's other constraints all guard against.
alter table public.synced_transaction_reviews
  drop constraint if exists synced_transaction_reviews_occurrence_date_in_month;

alter table public.synced_transaction_reviews
  add constraint synced_transaction_reviews_occurrence_date_in_month
  check (
    occurrence_date is null
    or (occurrence_month is not null and to_char(occurrence_date, 'YYYY-MM') = occurrence_month)
  );

-- Mirrors `synced_transaction_reviews_rule_month`, at the finer key the read side now prefers.
create index if not exists synced_transaction_reviews_rule_occurrence_date
  on public.synced_transaction_reviews (user_id, rule_id, occurrence_date)
  where rule_id is not null and occurrence_date is not null;
