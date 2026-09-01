# Recapturing the golden forecast fixture, offline

`src/lib/__tests__/fixtures/forecast-inputs.real.json` is the real-data fixture every money
measurement in this repo runs on. It is gitignored: it is Tre's actual financial data and this
repo is public.

Until 2026-08-31 there was exactly one way to make it: open the app signed in on localhost and
read `window.__convergenceDebug.engineInputs` out of the DEV hook in `CardProjectionContext`.
That needs a browser and a session, which is why three separate sessions measured 2026-08 questions
against a 2026-07-20 capture and wrote "this is not evidence about his today" in the handoff.

This is the offline path. Two steps, no browser.

## Step 1 - dump the raw rows

Run two queries through the Supabase MCP against project `mdtosrbfkextcaezuclh`, then assemble
them. Both queries return ONE row with ONE `dump` column holding a JSON string.

**The rows must never enter the session's context.** They do not have to: an MCP result over the
size cap is spilled to a file under `.claude/projects/<project>/<session>/tool-results/` and only
the path comes back. Both queries below are comfortably over the cap (67 KB and 101 KB on
2026-08-31), so this happens by itself. If a future dump is ever small enough to come back inline,
add a table to the query rather than reading it.

Query A (the small tables, plus the two that are column-filtered):

```sql
with u as (select '<user-id>'::uuid id)
select json_build_object(
 'debts', (select coalesce(json_agg(to_jsonb(d) order by d.created_at),'[]'::json) from debts d, u where d.user_id=u.id),
 'savings_goals', (select coalesce(json_agg(to_jsonb(g) order by g.created_at),'[]'::json) from savings_goals g, u where g.user_id=u.id),
 'car_funds', (select coalesce(json_agg(to_jsonb(c) order by c.created_at),'[]'::json) from car_funds c, u where c.user_id=u.id),
 'budget_items', (select coalesce(json_agg(to_jsonb(b) order by b.created_at),'[]'::json) from budget_items b, u where b.user_id=u.id),
 'payment_plans', (select coalesce(json_agg(to_jsonb(p) order by p.created_at),'[]'::json) from payment_plans p, u where p.user_id=u.id),
 'profile', (select to_jsonb(pr) from profiles pr, u where pr.user_id=u.id limit 1),
 'plaid_items', (select coalesce(json_agg(json_build_object('id',f.id,'plaid_item_id',f.provider_item_id,'provider',f.provider,'institution_id',f.institution_id,'institution_name',f.institution_name,'last_synced_at',f.last_synced_at,'created_at',f.created_at)),'[]'::json) from financial_connections f, u where f.user_id=u.id),
 'synced_transactions', (select coalesce(json_agg(json_build_object('id',s.id,'account_id',s.account_id,'amount',s.amount,'date',s.date,'pending',s.pending,'name',s.name,'merchant_name',s.merchant_name)),'[]'::json) from synced_transactions s, u where s.user_id=u.id and s.pending=false and s.date>='<month start minus 7d>' and s.date<='<month end plus 7d>'),
 'synced_transaction_reviews', (select coalesce(json_agg(json_build_object('status',r.status,'rule_id',r.rule_id,'occurrence_month',r.occurrence_month,'occurrence_date',r.occurrence_date)),'[]'::json) from synced_transaction_reviews r, u where r.user_id=u.id and r.status='linked_rule')
)::text as dump;
```

Query B (the three big ones, in the app's own sort order):

```sql
with u as (select '<user-id>'::uuid id)
select json_build_object(
 'accounts', (select coalesce(json_agg(to_jsonb(a) order by a.sort_order, a.created_at),'[]'::json) from accounts a, u where a.user_id=u.id),
 'transactions', (select coalesce(json_agg(to_jsonb(t) order by t.date desc),'[]'::json) from transactions t, u where t.user_id=u.id),
 'recurring_rules', (select coalesce(json_agg(to_jsonb(r) order by r.created_at),'[]'::json) from recurring_rules r, u where r.user_id=u.id)
)::text as dump;
```

Two of the tables are deliberately narrowed, and both narrowings are bounded by what the code
actually reads:

- `synced_transaction_reviews` is filtered to `status = 'linked_rule'` and four columns, because
  `buildConfirmedOccurrences` (`src/lib/confirmed-capture.ts`) ignores every other status and reads
  only `rule_id`, `occurrence_month` and `occurrence_date`. Unfiltered it is 623 rows / 289 KB.
- `synced_transactions` mirrors `useSyncedTransactions`: the current month plus and minus
  `SYNCED_TXN_FETCH_SLACK_DAYS` (7), `pending = false`, and the seven columns that hook selects.

The orderings are load-bearing. `useAccounts` orders by `sort_order` then `created_at` and
`src/lib/account-order.ts` depends on it; `useTransactions` orders by `date` descending.

Then assemble the two result files into the dump the harness reads:

```
node scripts/fixture-recapture/assemble-raw.mjs <user-id> <resultA.txt> <resultB.txt> src/lib/__tests__/fixtures/raw-rows.real.json
```

The shape it writes is the contract:

```json
{ "dumpedAt": "<ISO>", "userId": "<uuid>", "tables": { "accounts": [], "...": [] } }
```

`raw-rows.real*.json` is gitignored.

## Step 2 - rebuild the fixture

```
RECAPTURE=1 npx vitest run src/lib/__tests__/recapture-forecast-fixture.test.tsx
```

The harness renders the REAL `CardProjectionProvider` with `@/hooks/useSupabaseData` and
`@/hooks/usePlaidItems` mocked to serve the dump, and writes whatever the provider hands its
consumers. That is the point: `payConfig`, `cashFloor`, `syncCutoffDate`,
`forecastFundingAccountId`, the scheduled events and the assumptions hydration are all derived by
the provider, and a harness that re-derived them would be measuring itself. The clock stamped into
the capture is the dump's `dumpedAt`.

It self-skips without `RECAPTURE=1`, so `npm test` can never overwrite the fixture, and it copies
the fixture it replaces to `forecast-inputs.real.replaced-<date>.json` first.

## What recapturing costs

**Every pinned real-data assertion in the suite is measured against one particular capture, and a
recapture invalidates them.** On 2026-08-31, moving from the 2026-07-20 capture to a live one broke
10 assertions across 6 files (`forecast-convergence.floorDeficit`, `forecast-convergence.floorFlicker`,
`forecast-convergence.manualISB`, `forecast-engine.goldenTierA`, `monthEndCash.invariant`,
`step3-display`). None of them is a code regression; each is a number that legitimately moved, and
each needs re-pinning with the dump date stated in the commit. Some are anti-vacuous guards
("the fixture must actually exercise this path") that may no longer hold on newer data, and those
need judgement rather than a new number.

CI never sees any of this. The fixture is absent there, so all of these tests skip.
