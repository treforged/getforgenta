-- Start the revolving-balance history that the `debt_payoff` leaderboard metric needs.
--
-- debt_payoff is the share of your PEAK revolving balance you have cleared, so it needs a dated
-- series, and none exists (see the UNSOURCED_METRICS header in src/lib/leaderboard-metrics.ts).
-- total_liabilities is the wrong series: it includes the car loan.
--
-- Nullable and additive. NULL means "not recorded", never zero. The client fills it on the newest
-- weekly row once the card projection exists (src/lib/revolving-snapshot.ts). Existing RLS on this
-- table (owner select/insert/update) already covers the column; no policy changes.
--
-- Undo: alter table public.net_worth_snapshots drop column revolving_balance;
alter table public.net_worth_snapshots
  add column if not exists revolving_balance numeric null;

comment on column public.net_worth_snapshots.revolving_balance is
  'Engine month-0 revolving (interest-bearing) card balance on snapshot_date. NULL = not recorded.';
