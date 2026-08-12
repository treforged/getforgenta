# §1 deploy runbook — `financial_connections` migration + edge functions

**Status: NOT YET RUN. Step 0 pre-flight WAS completed 2026-08-07 15:00 UTC — see below.**
Prepared 2026-08-07 (session 97). Tre has AUTHORIZED the window ("after the backup go ahead");
it was deferred only because that session hit its context limit. Until it runs, `main` is not
deployable.

### Pre-flight results captured 2026-08-07 15:00 UTC (session 97)

- `plaid_items`: **7 rows, 7 with `access_token`** — both counts must be identical after step 1.
- `accounts`: 31 rows, 10 with a non-null `plaid_item_id`.
- `financial_connections` and `oauth_states`: did not exist → migration definitely unapplied.
- `plaid_items` relkind `r` (real table); RLS policy named exactly `Users own plaid items`;
  `accounts.provider` / `connection_id` absent. All match the migration's assumptions.
- Tree clean, on `main`, migration byte-identical to `aabdcdbd`.
- Cron `plaid-daily-sync` is `0 13 * * *` (UTC) — every day. Start the window right after a run.
- Tre was taking a manual backup / PITR checkpoint. **Confirm that exists before step 1.**

Re-run the pre-flight SQL anyway if any real time has passed — treat the numbers above as the
expected answer, not as a substitute for checking.

## Why this is one atomic window

Commit `aabdcdbd` rewrote the Plaid edge functions to read `financial_connections`, a table
that does not exist yet. The migration `supabase/migrations/20260806_financial_connections.sql`
creates it by **renaming `plaid_items`** and putting `plaid_items` back as a view *without*
`access_token`.

So the two halves are mutually blocking:

- Deploy functions **without** the migration → they query a table that does not exist. Plaid
  sync breaks for every user.
- Apply the migration **without** deploying → the currently-live functions read
  `plaid_items.access_token`, which the view no longer exposes. Plaid sync breaks for every user.

Migration first, then functions, back to back. Nothing else in the same window.

## Blast radius

Every Plaid-connected user's balance sync, plus account delete and both subscription webhooks
(they revoke connections). Treat any failure here as user-visible.

## Step 0 — pre-flight (do this BEFORE touching anything)

1. Confirm the tree is clean and on `main`, and that `supabase/migrations/20260806_financial_connections.sql`
   is unchanged from `aabdcdbd`.
2. Capture rollback state — the rename is the only hard-to-reverse step:
   ```sql
   select count(*) from public.plaid_items;                      -- row count before
   select count(*) from public.plaid_items where access_token is not null;
   ```
   Write both numbers down. They must be identical after step 1.
3. Take a Supabase backup / PITR checkpoint note (time-stamp it) so the rename can be undone.
4. Confirm no sync is mid-flight: `plaid-sync-all` runs on a cron. Check recent invocations and
   start the window right after one completes, not before one is due.

## Step 1 — apply the migration

Apply `supabase/migrations/20260806_financial_connections.sql` (project `mdtosrbfkextcaezuclh`)
as ONE transaction — the file already wraps itself in `begin; ... commit;`, so do not split it.

Verify immediately, before deploying anything:

```sql
select count(*) from public.financial_connections;               -- must equal the pre-count
select count(*) from public.financial_connections where access_token is not null;
select provider, connection_status, count(*) from public.financial_connections group by 1,2;
select count(*) from public.plaid_items;                         -- the view still resolves
select provider, count(*) from public.accounts group by 1;       -- plaid vs manual attribution
```

If the row counts moved, STOP and roll back before deploying. From here until step 2 finishes,
Plaid sync is down — this is the window to keep short.

## Step 2 — deploy the functions

**Seven live functions must be redeployed** (they are deployed today and their code in `main`
already assumes the new schema):

| Function | Why it is in the set |
|---|---|
| `plaid-sync` | bundles `_shared/sync-handler.ts` |
| `plaid-sync-all` | bundles `_shared/sync-handler.ts` + `_shared/providers/index.ts` |
| `plaid-create-link-token` | reads the base table directly (view hides `access_token`) |
| `plaid-exchange-token` | writes connections |
| `delete-account` | bundles `_shared/revoke-connections.ts` |
| `revenuecat-webhook` | bundles `_shared/revoke-connections.ts` |
| `stripe-webhook` | bundles `_shared/revoke-connections.ts` |

⚠️ The last three are easy to miss: they touch the schema only through a shared module, but a
stale copy breaks account deletion and subscription revocation.

**Two functions exist in `main` but have never been deployed** (confirmed against the live
function list 2026-08-07) — deploy them in the same window:

| Function | Note |
|---|---|
| `financial-sync` | the provider-agnostic sync entrypoint; never deployed |
| `plaid-hosted-link-result` | **shipped in `bc16b4fc` but never deployed — this is why native Hosted Link is still unverified.** Verify its `verify_jwt` setting explicitly on deploy; the MCP deploy path ignores `config.toml` (see the Reddit Scout lesson). |

### ⚠️ `verify_jwt` — the landmine in this step

The MCP `deploy_edge_function` tool **defaults `verify_jwt` to `true`** and ignores
`config.toml`. Four of the seven live functions run with it **false** today. Redeploying any of
them without passing `verify_jwt: false` explicitly would start rejecting Stripe/RevenueCat
webhooks and the pg_cron sync call, which cannot mint a JWT.

`config.toml` is NOT the source of truth here — it declares only two of them. These values were
read off the LIVE function list on 2026-08-07:

| Function | `verify_jwt` to pass |
|---|---|
| `plaid-create-link-token` | **false** |
| `plaid-sync-all` | **false** |
| `revenuecat-webhook` | **false** |
| `stripe-webhook` | **false** |
| `plaid-sync` | true |
| `plaid-exchange-token` | true |
| `delete-account` | true |
| `financial-sync` | not yet deployed — called by cron/server, decide before deploying (likely false) |
| `plaid-hosted-link-result` | not yet deployed — Plaid redirect target, decide before deploying |

Re-read the live list at deploy time and match it; do not trust this table blindly if time has
passed.

**Do NOT deploy** `akoya-auth-url` / `akoya-exchange-token`. Akoya is built but shelved
($2,000/mo minimum). They are not deployed today; leaving them undeployed keeps an unused
provider path off the internet.

## Step 3 — verify (all of it, in order)

1. `plaid-sync` for one account: run it, then confirm `accounts.balance` and
   `financial_connections.last_synced_at` moved.
2. App loads: Accounts page still lists Plaid accounts, no console errors from
   `usePlaidItems` / `useFinancialConnections` (the view is what keeps these working).
3. Edge function logs clean for all nine deploys — specifically no "relation does not exist"
   and no "column access_token does not exist".
4. Subscription webhook path: check `stripe-webhook` and `revenuecat-webhook` logs for a real
   event, or replay one. Do not assume they are fine because they were not touched by hand.
5. Native Hosted Link: with `plaid-hosted-link-result` finally deployed, run the device
   verification that has been blocked since 2026-08-06.

## Step 4 — what this unblocks

- **§1A — Plaid transaction sync + rule matching**, which is the real fix for 97.4 (pending
  transactions skewing projections). Once settled transactions are available, the
  `SETTLEMENT_LAG_DAYS = 3` heuristic in `src/lib/sync-cutoff.ts` should be **retired, not
  tuned** — the file says so itself, and tuning it would re-break the live-verified $1,463 case.
- Native Plaid Hosted Link verification.
- `main` becomes deployable again.

## Rollback

If step 1 verification fails: restore from the PITR checkpoint taken in step 0. Do not attempt
to hand-reverse the rename while the compatibility view exists.

If step 2 fails partway: the functions are independent deploys, so redeploy the failed one. The
schema is already migrated at that point, so rolling the DB back would break the ones that
succeeded — go forward, not back.
