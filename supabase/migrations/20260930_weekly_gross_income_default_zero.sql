-- Ask 9f385515: an account that never entered a salary was projected $1,875/week ($97,500/yr),
-- because this column DEFAULTED to 1875 and the client fell back to 1875 as well. New rows now
-- start at 0, which the app reads as "no salary entered".
--
-- EXISTING ROWS ARE DELIBERATELY NOT REWRITTEN. A user who typed 1875 and a user who inherited
-- the default hold the same value, so no query can tell them apart. That is a decision for Tre,
-- not a migration.
--
-- Undo: alter table public.profiles alter column weekly_gross_income set default 1875;
alter table public.profiles alter column weekly_gross_income set default 0;
