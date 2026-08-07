# §1A — Plaid transaction sync + rule matching

Status: **PLAN — not started.** Written 2026-08-07 (session 99), immediately after the §1
`financial_connections` deploy window closed.

Purpose: replace the `SETTLEMENT_LAG_DAYS = 3` date heuristic in `src/lib/sync-cutoff.ts` with
real settled-transaction evidence. That heuristic is the outstanding half of finding 97.4
(pending transactions skewing month-0 projections). `sync-cutoff.ts:24-26` names this work by
number and says the heuristic must be **retired, not tuned** — tuning it re-breaks the
live-verified $1,463 deposit case from 2026-08-05.

---

## Ground state (verified 2026-08-07, not assumed)

| Fact | Source | Value |
|---|---|---|
| Plaid product on link tokens | `plaid-create-link-token/index.ts:155` | `products: ["transactions"]`, `optional_products: ["liabilities"]` |
| Transaction fetch anywhere in the codebase | grep of `_shared/**` | **none** — balances + liabilities only |
| `financial_connections.sync_cursor` | information_schema | exists, `text`, **currently unused** |
| Provider→account join key | `accounts.plaid_account_id` | `text`, holds the provider account id |
| Linked accounts | `accounts where connection_id is not null` | 10 |
| `public.transactions` | 12 cols, 105 rows | **user's manual ledger** — full CRUD in `useSupabaseData.ts:495-538` with "Transaction added" toasts |
| `recurring_rules` | 431 rows | `amount`, `due_day`, `payment_source`, `frequency`, `active`, `start_date`/`end_date` |

**The single most important consequence:** existing items already carry `transactions` consent,
because it has been the *primary* product on every link token. §1A needs **no re-link and no new
user consent**. That was the main thing that could have killed this feature; it doesn't.

**The second:** `public.transactions` is the user's hand-entered ledger, with delete buttons and
success toasts. Plaid rows must **not** go into it. A sync writing into a table the user believes
they own is how you get "the app invented 400 transactions I never entered." New table.

---

## Design

### Stage A — ingestion (server only, zero UI change)

**New table `synced_transactions`.** Service-role write, user read-only via RLS (`select` only —
no user-facing insert/update/delete grant at all, so the table can never be confused with the
manual ledger).

```
id                       uuid pk
user_id                  uuid not null           -- RLS key
connection_id            uuid not null -> financial_connections(id) on delete cascade
account_id               uuid          -> accounts(id) on delete set null
provider_transaction_id  text not null           -- unique (connection_id, provider_transaction_id)
pending_transaction_id   text                    -- Plaid's link from posted row back to its pending row
amount                   numeric not null        -- Plaid sign convention, normalized: outflow positive
date                     date not null           -- authorized_date when present, else date
pending                  boolean not null
name                     text
merchant_name            text
category                 text
created_at / updated_at  timestamptz
```

Indexes: the unique pair above, plus `(user_id, account_id, date)` — that is the exact shape the
matcher queries on.

**Provider contract gains one method** (`_shared/providers/types.ts`):

```ts
fetchTransactions(
  connection: FinancialConnection,
  cursor: string | null,
): Promise<{ added; modified; removed; nextCursor: string; hasMore: boolean }>
```

Plaid implements it with `/transactions/sync`, looping while `has_more`. Akoya gets a no-op
returning an empty delta — it stays shelved and must not become a deploy blocker.

**Cursor discipline.** Persist `nextCursor` to `financial_connections.sync_cursor` **only after
the upsert commits**. That makes the pipeline at-least-once, and the unique
`(connection_id, provider_transaction_id)` makes replay idempotent. Advancing the cursor first
would silently drop a page on any write failure — unrecoverable, since Plaid will never re-offer it.

**Pending → posted.** Plaid stamps the posted transaction with `pending_transaction_id` pointing
at the row it replaces. On upsert, delete any row whose `provider_transaction_id` matches an
incoming `pending_transaction_id`. Without this the same charge is counted twice, which is exactly
the double-count `SETTLEMENT_LAG_DAYS` exists to avoid — the bug would survive its own fix.

**Wiring.** Into `_shared/sync-handler.ts` after the accounts pass, inside the existing
per-connection mutex (`sync_locked_until`). Reuses the lock, the cooldown, and the
`ReauthRequiredError` path already in place.

### Stage B — rule matching (pure, client-side, testable)

`src/lib/transaction-matching.ts` — a pure function, no I/O:

```ts
matchOccurrence(rule, monthKey, txns): { txn, confidence } | null
```

Deterministic, in this order: **account** (`rule.payment_source` → `accounts.name`), then
**amount** within tolerance, then **date** within a window around `dueDateInMonth(monthKey,
rule.due_day)`. No fuzzy merchant-name scoring in v1 — it is unpredictable, hard to test, and the
three hard signals already identify a recurring bill.

Matches are **derived at read time**, not persisted. No `matched_rule_id` column in v1: rules get
edited constantly (431 of them), and a persisted match would need invalidation on every rule
change. Persist only if profiling shows it matters.

### Stage C — retire the heuristic

`isCapturedInBalance` grows an evidence argument:

```ts
isCapturedInBalance(dueDate, balanceAsOf, evidence?: { hasTxnCoverage: boolean; matched: boolean })
```

- Coverage + match → captured.
- Coverage + no match → **not** captured (the charge genuinely has not hit).
- **No coverage → today's date heuristic, unchanged.**

That last branch is non-negotiable. Manual accounts, brand-new connections, and any institution
whose transaction history has not backfilled all have no evidence, and deleting the heuristic
outright would regress every one of them. §1A **demotes** `SETTLEMENT_LAG_DAYS` from the rule to
the fallback — that is what "retired, not tuned" means in code.

Callers to update: `useCardProjection.ts`, `forecast-engine.ts`, `credit-card-engine.ts:188`.
All three already route through `sync-cutoff.ts`, which is why §1.1 consolidated them there.

---

## Risks

1. **`PRODUCT_NOT_READY`.** `/transactions/sync` errors until Plaid finishes the initial pull on
   an item. Handle as a soft skip that leaves the cursor untouched, never as a sync failure.
2. **Backfill window.** The first sync returns up to 24 months. 10 accounts could be thousands of
   rows in one invocation — must page and batch-upsert, not build one giant array.
3. **The pg_net 5s timeout is pre-existing** (session 98, evidence: pre-migration request 858
   timed out identically and still synced). Transaction sync makes the function slower, so expect
   more timeout rows in `net._http_response`. Do not "fix" it in response to those rows.
4. **A 200 is not proof of work** (session 98's `plaid-sync-all` returning `{"synced":10}` from
   cache). Verify Stage A by row count in `synced_transactions` and a `sync_cursor` that moved.
5. **Billing.** Plaid bills transactions per item per month. Already consented, so no new
   surface — but this turns a dormant product line into a live one.

## Sequencing

A → B → C, in that order, each independently shippable. A is invisible to users. B is pure and
lands with unit tests before anything consumes it. C is the only stage that changes a projected
number, so it ships alone and gets live-verified against the $1,463 case on its own.

## Scope decision (Tre, 2026-08-07)

Synced transactions stay **server-owned and unbrowsable** — no Transactions view in v1 — but
Stage B additionally surfaces an **auto-matched badge** on `/budget` rules that matched a real
settled transaction in the current month.

Consequences for Stage B:

- The badge is the matcher's only user-visible output, so it must be **conservative**: show it
  only on a confident match, and show nothing (not a "no match" state) otherwise. An absent badge
  must read as "no information", never as "this bill wasn't paid" — the matcher will have gaps
  while backfill lands, and a false negative that looks like an accusation is worse than silence.
- It exposes matching confidence to a user before the matcher is tuned against real data. Ship
  the badge **after** Stage B's unit tests pass and after eyeballing real matches for Tre's 431
  rules, not simultaneously with the matcher.
- Still no `matched_rule_id` column: the badge derives from the same read-time match as the engine,
  so both surfaces cannot disagree.
