-- Connect a build (the car you are working on) to the car_funds row that is that
-- car's SAVING PLAN or LOAN, so the Build page can show what the car itself costs
-- alongside what the build costs. Nullable and additive: every existing build is
-- simply unconnected, which is exactly today's behaviour.
--
-- `on delete set null`, not cascade — deleting a loan plan must never delete the
-- build log that took months to write. It just disconnects.
--
-- SECURITY. car_builds and car_funds are both user-scoped by RLS and neither
-- policy is changed here. The FK cannot enforce that both rows share a user_id,
-- so a hand-crafted update could in principle point a build at a stranger's fund
-- id — but nothing would come of it: every reader resolves the id against the
-- caller's OWN car_funds query, so a foreign id resolves to nothing and the build
-- renders as unconnected. See src/lib/build-loan-link.ts, which is written to
-- return null rather than trust the id.
--
-- The public share path needs no change: supabase/functions/public-build selects
-- an explicit column list, so this column is never served to a shared page.
alter table public.car_builds
  add column if not exists car_fund_id uuid references public.car_funds(id) on delete set null;

create index if not exists car_builds_car_fund_id_idx
  on public.car_builds (car_fund_id)
  where car_fund_id is not null;
