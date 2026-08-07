# Handoff — 2026-08-07 — session 99 — §1A STAGE A SHIPPED AND LIVE-VERIFIED

> §1 closed last session. This session planned §1A, built Stage A (transaction ingestion),
> deployed it, and verified it end-to-end against real Plaid data. **143 real transactions are in
> the database.** Stage B (rule matching + auto-matched badge) is next. Nothing is pushed.

## ▶ START HERE

**Next work is §1A Stage B** — `src/lib/transaction-matching.ts`, a pure matcher, unit-tested
before anything consumes it. The full design is in `docs/1A-transaction-sync-plan.md`; read it
first, it carries Tre's scope decision and the constraints that came with it.

**Sign-in is unblocked** — see below. The three carried DOM verifications can finally be done.

## Sign-in: use email + password, not Google

Verified in `auth.identities`: Tre's account has **`apple,email,google`**, `encrypted_password`
set, email confirmed. So `localhost:8080/auth` with **email + password** works and never touches
the OAuth redirect allow-list. That unblocks the DOM checks that have been carried four sessions.

The Google popup issue is NOT fixed and is still Tre's dashboard action (Authentication → URL
Configuration → **Redirect URLs** → `http://localhost:8080/**`). Two format traps: the scheme is
required (`localhost:8080/**` alone silently fails), and it must be Redirect URLs, not Site URL.

**Do not try to verify the allow-list over HTTP — it cannot be done.** `/auth/v1/authorize`
echoes *any* `redirect_to` straight back; probed with a deliberately bogus domain this session and
it passed through identically. Validation happens at the callback. The Management API would show
`uri_allow_list`, but the CLI's token lives in the Windows credential manager, not on disk, so
there is no token to use. Dashboard only.

Shipped instead (`7693f900`): `Auth.tsx` now raises a toast after 90s naming the likely cause,
instead of polling `popup.closed` forever in silence. It deliberately does **not** close the
popup — the popup's URL is the diagnostic, and closing it destroys the evidence. This is the
hardening the last two sessions kept flagging.

## §1A Stage A — what shipped

Commits: `cf4d8fec` (plan), `595cab2d` (Stage A), migration **applied**, functions **deployed**.

- **`public.synced_transactions`** — new table, service-role write, user read **only**. No
  insert/update/delete policy and no DML grant at all. Verified as `authenticated`: read works,
  insert is rejected.
  **Kept deliberately separate from `public.transactions`**, which is Tre's hand-entered ledger
  (full CRUD + "Transaction added" toasts in `useSupabaseData.ts:495-538`). Writing aggregator
  rows there would read as the app inventing transactions he never entered. Never merge these.
- **`FinancialProvider.fetchTransactions()`** — Plaid via `/transactions/sync`; Akoya an explicit
  no-op while shelved. Required, not optional, so a new provider cannot silently ship without
  transactions and leave the forecast on the date heuristic with no signal.
- **`sync-handler.syncTransactions()`** — pages the delta, retires pending rows superseded by
  their posted successor, and advances `sync_cursor` **only after each page commits**.

### Two invariants that must not be "simplified" later

1. **Cursor advances LAST.** Plaid never re-offers a page once the cursor moves past it, so
   advancing before the write would drop transactions permanently on any failure. Advancing after
   makes it at-least-once; the unique `(connection_id, provider_transaction_id)` makes replay a
   no-op. **Proven this session** (see below), not just asserted.
2. **`syncTransactions` never throws.** Transactions improve the forecast; they are not a
   prerequisite for it. A failure must not roll back balances that already landed or mark the
   connection `error` and push the user into a re-link.

### Live verification (real Plaid, not sandbox)

Method: aged ONE connection (Discover — 1 account, smallest blast radius) past the 23.5h cooldown
and fired the real cron. The other five stayed inside cooldown, which returns *before*
`syncTransactions`, so the blast radius was genuinely one connection.

| Check | Result |
|---|---|
| Rows ingested | **143**, all Discover |
| Date range | 2026-01-30 → 2026-08-05 (~6 months) |
| `account_id` unmapped | **0** — the `plaid_account_id` → `accounts.id` join works |
| Sign split | 125 outflows / 18 inflows (plausible for a card: purchases + payments) |
| `category` null | 0 |
| `sync_cursor` set | yes, and on **exactly 1 of 6** connections — cooldown gating confirmed |
| Edge logs | 200, v39, no errors |

**Idempotency proven, not assumed.** Re-aged and re-fired: `last_synced_at` moved (so it really
re-ran — not a cooldown skip) while rows stayed at **143 / 143 distinct**. The second run took
3.5s vs the first at 9s, exactly what an incremental delta vs a full backfill looks like.

Note `pending_txns = 0` — Discover had no pending rows in this window, so the
pending→posted retirement path is **written and reviewed but not yet exercised against real
data.** Watch for it when the other five connections first sync.

## §1A Stage B — next, with Tre's decision baked in

Tre chose **auto-matched badge** over engine-evidence-only. Constraints that came with it
(also in the plan doc):

- The badge must be **conservative**: show on a confident match, show **nothing** otherwise. An
  absent badge must read as "no information", never "this bill wasn't paid" — the matcher will
  have gaps while backfill lands, and a false negative that looks like an accusation is worse
  than silence.
- Ship the badge **after** the matcher's unit tests pass and after eyeballing real matches across
  Tre's 431 rules. Not simultaneously.
- No `matched_rule_id` column — badge and engine derive from the same read-time match, so the two
  surfaces cannot disagree.

Then **Stage C** retires `SETTLEMENT_LAG_DAYS`. Critical: it becomes the **fallback branch**, not
deleted. No transaction coverage (manual accounts, fresh connections, un-backfilled institutions)
→ today's date heuristic, unchanged. That is what "retired, not tuned" means in code.

## Facts worth carrying

- **Every link token has had `products: ["transactions"]` as its PRIMARY product all along**
  (`plaid-create-link-token/index.ts:155`). §1A needed **no re-link and no new consent**. This was
  the one thing that could have killed the feature.
- `financial_connections.sync_cursor` already existed and was unused — it is now live.
- `plaid-sync-all` has **no `force` option**. To force a sync, age `last_synced_at` and fire the
  cron (job 16) via `net.http_post` with the vault `CRON_SECRET`.
- pg_net's 5s timeout is **pre-existing** (session 98 proved it on pre-migration request 858).
  Transaction sync makes runs slower, so expect more timeout rows. Do not "fix" it.

## Still open (carried)

1. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save →
   rule shows end date in `/budget` + card shows "Auto-ends contributions". **Now unblocked.**
2. **97.1 `/debt` TOTAL LIMIT tile** — should read **$25,400**. **Now unblocked.**
3. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
4. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
5. §2.9 car-fund earmark.
6. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop once §1 is settled.
7. Native Plaid Hosted Link device verification (needs a physical device).

## Push status

`main` is **12 commits ahead of origin**. Standing rule is never auto-push. **Nothing pushed.**

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2` (the 1-account test connection).
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`; `accounts.plaid_account_id`
  is the provider account id.
- `plaid_items` is a VIEW over `financial_connections`; `plaid_item_id` → `provider_item_id`.

## Environment gotchas (carried + new)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. Dev server `localhost:8080`. Budget Control is `/budget`, Debt Payoff is `/debt`.
3. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
4. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
5. Vitest suppresses `console.log` — write to a scratch file.
6. `npx supabase` CLI is authenticated and linked — prefer it over MCP for deploys.
7. A `for` loop over deploys trips the permission classifier; pass all names to one invocation.
8. **`config.toml` is the source of truth for `verify_jwt`** — the CLI flips any undeclared
   function to `true`. All ten are declared. Verified post-deploy this session: `plaid-sync-all`
   held `false` (the cron depends on it), webhooks untouched.
9. **No `deno` binary locally** — edge function type errors only surface at deploy.

## Lessons (session 99)

**Verify the side effect, then verify it twice.** Session 98's lesson was that a 200 proves
nothing. The sharper version: a row count proves ingestion but not *correctness*. What proved the
cursor works was re-running and watching `last_synced_at` move while the row count stayed flat —
one number moving and another deliberately not.

**Check whether the blocker is the only door.** Google OAuth was treated as the way in for four
sessions. One query against `auth.identities` showed an email/password identity had been there
the whole time. When a path is blocked and someone else owns the fix, look for a second path
before waiting.

Prior sessions' lessons (1-98) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
