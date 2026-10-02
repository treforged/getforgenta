-- One savings goal can track SEVERAL accounts (ask 4674b24a, Tre 2026-10-01: "Brokerage should
-- track my investment accounts that arent 401k or roth").
--
-- `linked_account` stays the PRIMARY link and keeps every job it has today (account type, APY,
-- the double-count exclusions in the engine). `also_linked_accounts` only ADDS the live balances
-- of further accounts to the goal's balance. Additive and nullable-safe: an empty array is
-- exactly today's behaviour. RLS on savings_goals already scopes every row to its owner.
-- Undo: alter table public.savings_goals drop column also_linked_accounts;
alter table public.savings_goals
  add column if not exists also_linked_accounts text[] not null default '{}';
