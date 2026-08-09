# Handoff — 2026-08-09 — session 115 — §1B Stages 1+2 LIVE-VERIFIED; Stage 3 STARTED (`53609165`)

> **START HERE.** Session 115 did two things: it **live-verified Stages 1+2 on Tre's real account**
> (all green — see the session-114 section below, which now carries the verification table), and it
> **began Stage 3**. The context gate fired partway through Stage 3. **Nothing is half-applied:**
> what shipped is a migration + a pure module + 15 tests, all green, and **no UI calls it yet**, so
> the app's behaviour is byte-identical to `1a9fa956`.
>
> Tre asked for Stage 3 directly ("fix the flagged items then stage 3"). Neither flagged item was a
> defect — item 1 was the `'categorized'` design call (now verified working), item 6 is a bank wait —
> and that was said to him plainly. **Stage 3 is the live instruction; keep building it.**

## 🔨 Stage 3 — `Add to my ledger` (IN PROGRESS)

### ✅ DONE and committed `53609165` — green (15 new tests, tsc 0, eslint clean)

1. **`supabase/migrations/20260809_transactions_origin.sql`** — written **AND APPLIED LIVE**
   (`apply_migration` → success). `public.transactions.origin` `'manual'|'synced'`, NOT NULL,
   **default `'manual'`** so the 22 existing rows are correct with no backfill, plus a CHECK.
2. **`src/lib/synced-transaction-import.ts`** (new, pure) + its test file — **15/15**.
   `planLedgerImport(txn, ctx)` returns `{ok:true, draft}` or `{ok:false, reason}`.

### Why it is a PLAN and not a builder — do not split this

"May this be imported at all" and "what row would it be" are deliberately **one function**. Splitting
them is exactly how a future caller checks the guard and forgets it, or vice versa. Everything below
is enforced inside it and pinned by a test:

- **The double-count guard**: `hasSuggestion` → refuse. Import exists ONLY for charges nothing else
  in the app already describes.
- **`'categorized'` does NOT block an import** (the other four statuses do). A user who only fixed a
  label has taken no position on the charge — that is the entire reason the fifth status exists.
- **Sign flip**: `synced_transactions` is **outflow-positive** (Stage A); the ledger stores a
  **positive amount + direction in `type`**. Negative → `income`. Getting this backwards files
  income as spending on twelve surfaces. `Number()` first — PostgREST returns `numeric` as a string.
- **`payment_source` gets the `account:` prefix** (all 22 live ledger rows use it; bare uuid is the
  `recurring_rules` spelling).
- **`account` comes from the real `accounts.name`, or the import REFUSES.** It is a dead legacy
  free-text label reading `"Checking"` on every live row including credit-card ones, and
  ⚠️ **`useTransactions().add` coerces a falsy account to the literal `'Checking'`** — so falling
  through to a default would reproduce the exact bug. (All 571 live rows do resolve; the guard is
  for correctness, not a live case.)

### ⬜ NEXT — the three pieces left, in order

1. **`useSupabaseData.ts` — an `importToLedger` mutation** inside `useSyncedTransactionReviews`
   (it owns the review write, and this touches two tables):
   insert the draft into `transactions` → `.select().single()` → upsert the review as
   `status:'imported'` with that `transaction_id`.
   ⚠️ **If the review write fails, DELETE the just-inserted ledger row before throwing.** An orphan
   imported row with no review is money in the ledger that is also still offered for import — the
   double-count, arrived at by a partial failure instead of a bad button.
   Invalidate **both** `['transactions']` and `['synced_transaction_reviews']`.
2. **Undo of an import must delete the LEDGER ROW, not the review.** Verified in SQL this session:
   `synced_transaction_reviews.transaction_id` is **`ON DELETE CASCADE`**, so deleting the
   transaction removes the review for free and returns the charge to unreviewed/re-importable.
   The existing `remove` (deletes the review only) would **leave the money behind** — it must not be
   the Undo path for `status='imported'`.
3. **`BankActivity.tsx`** — call `planLedgerImport` per unhandled row; render
   `Add to my ledger` when `ok`, nothing when not (never a disabled button asserting a reason the
   user did not ask for). Imported rows get an `added to ledger` badge + the Undo from (2), with copy
   saying it removes the entry.

**"Not this" ships here too, and the decision is: a TRANSIENT client-side dismissal, no DB row.**
Rejecting a suggestion is only a step toward "then it's a new charge" — and both destinations
(`Add to my ledger`, `Ignore`) write their own row. A persisted rejection would need a sixth status
carrying `rule_id` to know *which* suggestion was rejected, which the `ignored_is_clean` CHECK
forbids today. On reload the suggestion returns; that is honest, because no assertion was recorded.
**Mention this to Tre** — it is a judgement call, not a spec item.

### Then: live-verify Stage 3 alone

It is the **first §1B code that moves a projected number**, so verify it by itself, on the real
account, and check the plan's **risk 2**: an imported row must not both add an actual *and* retire a
projected charge for the same dollars. Clean up every test row (separate statements, then re-SELECT).

---

# Handoff — 2026-08-09 — session 114 — §1B Stages 1+2 BUILT + committed `1a9fa956`; LIVE-VERIFIED session 115

> **START HERE.** Session 114 finished §1B Stages 1+2. **All code is committed and green** —
> 626/626 tests, tsc 0, eslint clean on every changed file. The one thing NOT done is **live
> verification in the browser**, which is the next session's whole job. See "Next" below.
>
> Nothing is half-applied. Read the §1B plan (`docs/1B-transaction-review-plan.md`) and the session
> 113 section below for the design; this section only records what changed since.

## ✅ Shipped `1a9fa956` — the Bank Activity tab

**Still writes no money.** Nothing in this commit creates a `public.transactions` row; a confirmed
link is an annotation. Stage 3 (import) and Stage 4 (feed `buildCaptureEvidence`) are NOT built and
each must ship and be live-verified alone.

Files:
- **`src/components/transactions/BankActivity.tsx`** (new) — the tab. Month filter defaults to the
  current month (`all` available), account filter, 100-row pages, pending excluded, **no
  "N need review" count anywhere**.
- **`src/lib/synced-transaction-review.ts`** (new, pure) + its test file — **18 tests**.
- **`src/hooks/useSupabaseData.ts`** — `useAllSyncedTransactions()` and
  `useSyncedTransactionReviews()` added next to the §1A block.
- **`src/pages/Transactions.tsx`** — `usePersistedState('tre:transactions:tab')` Planning/Bank tabs.
  Planning content wrapped in `{activeTab === 'planning' && (<>…</>)}`; the modals below it stay
  mounted (they are already state-gated). Export/Add-Transaction buttons hide on the Bank tab.
- **`src/integrations/supabase/types.ts`** — regenerated. Diffed first: the ONLY change is the new
  table, nothing else drifted.
- **`supabase/migrations/20260809_synced_transaction_reviews_categorized.sql`** — written **AND
  APPLIED LIVE** (`apply_migration` → success).

### ⚠️ NEW DECISION this session — a FIFTH status `'categorized'`

The plan's four statuses could not express "the user fixed the label and took no other position".
All four assert something: three say *handled*, `'ignored'` says *dismissed*. So changing a wrong
auto-category would have forced a decision out of someone who only wanted to fix a word — in a
feature explicitly designed not to be a queue demanding decisions, and against Tre's "users should
be able to categorize if the auto cat is wrong". Since `GENERAL_MERCHANDISE` is 32% of the rows and
the map is wrong *by construction*, that path is the common one, not an edge case.

`'categorized'` carries no FKs (same cleanliness rule as `'ignored'`) and **`isHandledReview()`
deliberately returns FALSE for it** — pinned by a test whose comment says why. Absence of a row
still means unreviewed. **Tre has not seen this call yet — mention it.**

### Design calls worth not re-litigating

- **No second matcher was written.** Rule suggestions invert `matchOccurrence` (ask every rule "which
  txn settles you", index the answer); ledger suggestions adapt `transactions` rows into
  `MatchableTransaction` shape and call `matchCharge`. One definition of "matched", app-wide.
  The ledger adapter re-signs to Stage A's **outflow-positive** convention and routes
  `payment_source` through `normalizePaymentSource` (the two tables disagree — see below).
- **`due_day` guard**: `RuleRow` has it optional, the matcher requires it. Same guard + spread
  adapter as `BudgetControl.tsx:549`. Copy that, don't invent one.
- **`useAllSyncedTransactions` pages explicitly** in 1000-row batches. PostgREST truncates silently,
  and a history browser that stops at row 1000 hides months with no indication.
- **"Not this" (reject a suggestion) was deliberately NOT built.** Rejecting a suggestion is only
  actionable once "Add to my ledger" exists to receive the row, and adding a sixth status for it now
  would be guessing. It belongs to Stage 3.
- `setCategory` upserts a `'categorized'` row when no decision exists, and otherwise patches
  `category_override` **without disturbing an existing link**.

## ✅ LIVE-VERIFIED session 115 — on Tre's REAL account. Do not re-verify.

Signed in as `tre@treforged.com` on the Claude-controlled Chrome at `http://localhost:8080`
(**the profile is signed in again** — gotcha #2's "SIGNED OUT" note is stale; probe anyway).
Tab left parked and open. Zero console errors throughout.

Every claim below was checked in the browser AND against SQL:

| Check | Result |
|---|---|
| Planning / Bank Activity tabs | both render; Radix pointer sequence switches; `tre:transactions:tab` persists across reload |
| Export CSV / Export PDF / Add Transaction on the Bank tab | present in DOM but **not visible** — hiding works |
| Rows for 2026-08 | **24 settled**, matches SQL exactly |
| Month filter | 9 options; 2026-07 → **134**, All Time → **566** = 571 total − 5 pending. Pending exclusion and the 1000-row paging are both correct at full history |
| Paging | progressive **"Show 100 more"**; 100 → 200 rows |
| Auto-categories | landing per the map (Utilities / Shopping / Car / Bills), `Other` where the map declines |
| `Confirm` on a rule suggestion ($54.07, 2026-08-03) | wrote `status='linked_rule'` with **`rule_id` present**, `transaction_id` null |
| `Undo` | deleted the row; the suggestion re-appeared |
| Category override | wrote **`status='categorized'`**, `category_override='Groceries'`, **no FKs** — the new fifth status works end to end |
| Override persistence | survived a full page reload |
| `Ignore` | wrote `status='ignored'`, no FKs; `Undo` removed it |
| Nag text | **zero** matches for "need review" / "unreviewed" / "unpaid" anywhere on the page |
| **Money written** | `public.transactions` still **22 rows** — the tab creates no money, as designed |
| Rule matching over history | 5 distinct rule suggestions across All Time, not just the current month |

**Cleanup verified:** all test writes removed, `synced_transaction_reviews` re-SELECTed at **0 rows**.
(The `'categorized'` row was deleted in SQL — resetting the dropdown would have left the row behind.)

⚠️ **The native-`<select>` find:** the category/month/account controls are plain `<select>`, **not**
Radix comboboxes. Drive them with the native value setter + `change` event, not a pointer sequence:
```js
Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'Groceries');
s.dispatchEvent(new Event('change',{bubbles:true}));
```
The page *tabs* still need the pointer sequence. Both patterns are in play on one page.

## ⬜ NEXT SESSION — Tre's call

Nothing is queued. Ask Tre: **Stage 3** (import — "Add to my ledger", the first thing here that
writes money, and the prerequisite for "Not this"), **Stage 4** (feed `buildCaptureEvidence`),
**§1C**, or the roadmap's **FB.6-13**.

**"Not this" was re-confirmed as NOT buildable now** (session 115, Tre re-raised it): rejecting a
suggestion is only actionable once import exists to receive the row, and a sixth status invented
before that would be a guess. It ships **with Stage 3**, not before.

## Item 6 re-checked (session 115) — STILL HAS NOT FIRED

$422.89 on `933cbc10…` still `pending: true`, `updated_at` **still unmoved at 2026-08-08 13:00:08
UTC**. Fifth session with the same answer. Bank settlement lag. Re-run the query; do not investigate.

## Item 6 re-checked (session 114) — STILL HAS NOT FIRED

$422.89 on `933cbc10…` still `pending: true`, dated 2026-08-07, `updated_at` **unmoved at
2026-08-08 13:00:08 UTC**. Bank settlement lag, not a sync failure. Fourth session with the same
answer — re-run the query, but do not re-investigate.

---

# Handoff — 2026-08-08 — session 113 — §1B PLANNED + APPROVED; build Stages 1+2 next

> **START HERE.** Session 113 planned §1B, got Tre's approval on all four open questions, and
> **began building Stages 1+2**. Read `docs/1B-transaction-review-plan.md` in full first — it
> carries the ground-state audit, the double-count hazard, the schema, and the staging.
>
> Session 113 was cut by the context gate partway through the build. **Nothing is half-applied:**
> what shipped is additive and inert (a pure module + an empty table). See "Build progress" below.

## 🔨 Build progress — §1B Stages 1+2 (IN PROGRESS)

### ✅ DONE and committed

1. **`src/lib/plaid-category-map.ts`** (new, pure) + `src/lib/__tests__/plaid-category-map.test.ts`
   — **15/15 green**. `suggestCategory()` / `hasCategorySuggestion()` / `isValidCategory()`.
   ⚠️ **Non-obvious find that shaped it:** `synced_transactions.category` is the Plaid PFC
   **primary**, but `providers/plaid.ts:100` falls back to the **legacy title-case `category[0]`**
   (`"Food and Drink"`) on older items. So the map is keyed on a NORMALISED form (upper, non-alnum
   → `_`) and both vocabularies collapse onto one key. Legacy keys (`SHOPS`, `PAYMENT`,
   `HEALTHCARE`, …) are in the map too.
   Deliberate calls pinned by test, do not "fix": **`TRANSPORTATION` → `'Car'`, NOT `'Gas'`**
   (Plaid's TRANSPORTATION spans gas/parking/tolls/transit/ride-share; `Gas` is wrong 5 times in
   6). `FOOD_AND_DRINK` → `Dining` and `RENT_AND_UTILITIES` → `Utilities` each pick the more
   frequent of two inseparable members. Transfers → `Other` on purpose.
2. **`supabase/migrations/20260808_synced_transaction_reviews.sql`** — written **AND APPLIED LIVE**
   (`apply_migration` → success). Empty table, RLS on, full owner CRUD. Inert until the UI reads it.

### ⚠️ The FK trap this schema is built around — read before touching it

`ON DELETE SET NULL` fires an **UPDATE** on the referencing row, and Postgres **evaluates CHECK
constraints on UPDATE**. So a CHECK of the form "status='linked_rule' implies rule_id is not null"
would make *deleting a rule* fail with a constraint violation. Hence the deliberate asymmetry:

- `rule_id` → **SET NULL**, and that CHECK is **intentionally absent**. The degraded state
  (`linked_rule`, `rule_id` null) is legitimate and means *"handled, but the rule is gone"*. **The
  UI must render it as handled and must not assume `rule_id` is present.** Creation-time presence
  is the hook's job + a test.
- `transaction_id` → **CASCADE** (not set null), so deleting the imported ledger row deletes the
  review and returns the synced txn to unreviewed — re-importable. That is also what makes the
  `txn_present` CHECK safe to enforce.

### ✅ ALL DONE session 114 — see the top section. Kept for the design notes only.

3. **Regenerate `src/integrations/supabase/types.ts`** — it has no `synced_transaction_reviews`
   yet, so the hooks below will not typecheck. (Gotcha #15: `generate_typescript_types` returns an
   envelope too large to paste; read the persisted tool-result file and extract `.types` with node.)
4. **`useSupabaseData.ts`** — add two hooks next to the existing §1A block (line ~494):
   - a filterable/all-history synced-transaction hook. **`useSyncedTransactions(monthKey)` at :518
     must be left ALONE** — it is month-scoped on purpose for the `/budget` badge and Stage C;
     add a SEPARATE hook rather than widening it.
   - `useSyncedTransactionReviews()` with full CRUD (this table *is* user-writable).
5. **`src/components/transactions/BankActivity.tsx`** (NEW FILE — do not grow `Transactions.tsx`,
   already **998 lines** against the 800 max in the coding rules).
6. **`src/pages/Transactions.tsx`** — a tab switch mounting it. The page is currently one flat
   render with **no tab pattern at all** (`return (` at :451); `usePersistedState` is already
   imported and is how the repo persists that kind of toggle (see :76).

### UI rules that are decisions, not polish

- Bank activity gets its **own tab**, never interleaved: `/transactions` is a *planning* stream (22
  manual rows merged with generated debt/plan/car-loan rows); bank activity is what happened.
- Filter **defaults to current month**, switchable to any month or All. **Pending rows excluded.**
- **"unreviewed" is NEVER a nagging count or badge**, and nothing may read it as "did not happen".
- An absent match suggestion renders as **no information**, never "unpaid" (§1A design bias).
- `hasCategorySuggestion()` false → say **"uncategorised"**, not "Other" — do not assert.

## §1B — surface synced Plaid transactions in `/transactions` (review / link / categorize / import)

Tre's ask, verbatim: *"i want to pull transactions in and have them also auto connect to user
created rule and transaction. otherwise it adds a transaction if the user says it doesnt match
anything… it should go into the transactions tab and integrate with calculations and rules. users
should be able to categorize if the auto cat is wrong"*

**Plaid ingestion was already fully live** — §1A Stages A/B/C all shipped, cron `plaid-daily-sync`
(jobid 16) runs Mon/Wed/Fri/Sat 13:00 UTC, 571 rows for Tre. The missing piece was only the UI, which
the 2026-08-07 scope call had deliberately excluded. **§1B reverses that call — Tre's decision.**

### ⚠️ The hazard the whole design hangs on

`public.transactions` is read by **12 surfaces**, incl. `useForecastEngineInputs.ts:66` and
`CardProjectionContext.tsx:63` — every row written there moves projected numbers app-wide, while
`recurring_rules` already projects the same bills. So:

**Import is offered ONLY on rows that matched nothing. A linked row is an annotation and creates no
money.** If a future session relaxes that, the double-count returns. Tre's phrasing ("otherwise it
adds a transaction") is load-bearing, not UX.

### Tre's decisions (2026-08-08) — do not re-ask

1. **Inbox scope: ALL accounts, ALL history.** His reasoning, better than my initial
   recommendation: history is the *input* to discovering recurring rules at onboarding. I had
   conflated *browsing* with *a queue demanding decisions*. Resolution: everything browsable +
   filterable, filter **defaults to current month**, and **"unreviewed" is NEVER a nagging count or
   badge** — no "24 items need review". Most rows stay permanently unreviewed by design, so
   **nothing anywhere may read "unreviewed" as "did not happen".**
2. **Stage 4 = YES.** A confirmed link feeds `buildCaptureEvidence` as `matched: true`, overriding
   the auto-matcher. Rationale: otherwise an explicit user confirmation counts for less than an
   automatic guess, which is backwards.
3. **Imported rows: fully editable, stamped `origin='synced'`** on `public.transactions`. Re-import
   blocked by the review row's unique constraint.
4. **Build now: Stages 1+2 only** (zero effect on any projected number). 3 and 4 ship separately and
   get live-verified separately.

### 🆕 §1C (new, NOT started, do not build without Tre)

Tre's onboarding idea: **derive recurring rules from transaction history.** A pattern detector over
`synced_transactions`, a different consumer from the review inbox. Filed as §1C so it isn't lost.
This is the reason all-history is in scope.

### Facts verified session 113 (don't re-query)

- `synced_transactions` (Tre): **571 rows**, 2026-01-17 → 2026-08-07, 5 pending; 24 settled this month.
- `public.transactions` (Tre): **22 rows**. Active `recurring_rules`: **30**.
- ⚠️ **The two tables disagree on a convention.** `recurring_rules.payment_source` = **bare uuid**;
  `transactions.payment_source` = **`account:`-prefixed** (22/22 rows, 0 bare). Reuse
  `normalizePaymentSource()` (`transaction-matching.ts:113`) — it accepts both. Do NOT write a second parser.
- ⚠️ `transactions.account` is a **dead legacy free-text label** — reads `"Checking"` on all 22 rows
  *including* ones whose `payment_source` points at the Discover card. Import must set it from the
  real `accounts.name`, never by copying an existing row.
- Plaid categories present: 18 PFC primaries. **`GENERAL_MERCHANDISE` is 183/571 (32%)** and only
  means "a store" — mapping it to `Shopping` is a guess that will often be wrong. That is precisely
  why the override exists. **Do not add merchant-name heuristics to paper over it** — §1A rejected
  fuzzy name scoring for reasons that apply here too.

### Item 6 re-checked (session 113) — STILL HAS NOT FIRED

$422.89 on `933cbc10…` still `pending: true`, dated 2026-08-07, `updated_at` unmoved at
**2026-08-08 13:00:08 UTC**. Latest settled on that account still **2026-08-05**. Bank settlement
lag, not a sync failure. Same conclusion as sessions 111/112.

---

# Handoff — 2026-08-08 — session 112 — Stage 6 FULLY DELIVERED (deployed v51); item 6 not yet fired

> Session 112 **deployed the `ai-advisor` edge function** (Tre approved; v50 → **v51**, ACTIVE,
> `verify_jwt: true`) and smoke-tested it live. **Stage 6 is now closed end to end.**
>
> It re-ran item 6's watch: the $422.89 car payment is **still pending, unchanged** — no flip yet.
>
> ⚠️ **The work queue is now empty.** Items 4 and 6 are waits, not tasks. There is no §2.11 and no
> queued plan item — picking the next workstream is Tre's call. See "Next" below.
>
> Push status: run `git rev-list --count origin/main..main` — do not trust a number written here.

## ✅ Stage 6 CLOSED — `ai-advisor` deployed v51 and verified booting

Deployed 2026-08-08 via Supabase MCP with the 3-file set (`ai-advisor/index.ts` +
`_shared/cors.ts` + `_shared/rate-limit.ts`; every other import is a remote esm.sh URL Deno
fetches itself). `verify_jwt: true` passed explicitly, since MCP ignores `config.toml` — and
`config.toml` has **no `ai-advisor` entry at all**, so the explicit flag is the only thing
preserving the live setting.

**Boot verified, not assumed.** POSTing `{}` with the **anon key as the Bearer token** passes the
gateway (the anon key is itself a valid JWT), so the request reaches the function body, which
returns its own `{"error":"not_authenticated"}` / 401. That single call proves the module graph
loaded, both `_shared` imports resolved, the `rate_limit_check` RPC path works, and
`GEMINI_API_KEY` is set — a missing key returns 503 *before* the auth check. **Reuse this trick for
any `verify_jwt: true` function**: it is a free, no-side-effect boot test that reaches real code.

The client and edge function now agree on `payoffMonthsFromNow`; the renamed-field intermediate
state is over.

## Item 6 — first live Stage C flip: re-checked 2026-08-08, HAS NOT FIRED

Nothing to do; the bank has not settled the charge. Re-run the two queries next session.

- The $422.89 row on `933cbc10…` is **still `pending: true`**, dated 2026-08-07, with `updated_at`
  still **2026-08-08 13:00 UTC** — no sync has touched the row since session 111 looked at it.
- The account still holds **138 rows / 4 pending**, latest **settled** still **2026-08-05**.
- Because `updated_at` has not moved, this is bank settlement lag, not a sync failure.

⚠️ **Column name trap:** `synced_transactions` has **`date`**, not `transaction_date`. Full column
list: `id, user_id, connection_id, account_id, provider_transaction_id, pending_transaction_id,
amount, date, pending, name, merchant_name, category, created_at, updated_at`. Also watch
`updated_at` alongside `pending` — it is what distinguishes "bank hasn't settled" from "sync is
stale", in one query.

Both Stage C conditions therefore still evaluate exactly as traced in session 110 (`matched: false`
via the pending skip, `hasTxnCoverage: false` since 08-05 < 08-12). **Still number-neutral, still
for the verified reason.** The prediction in the section below stands unchanged.

## ⚠️ Correction to session 110's connection table — one row was NOT Tre's

The session-110 table listed **7 connections as if all were Tre's**. Filtering
`financial_connections` by `user_id = a72f416e…` returns **6**. The second Chase connection,
**`eaddb4e3-4d07-4554-b207-d2cacbdda106` (128 rows, 5 pending)**, belongs to a **different user**
(`25e2e6bf-4c62-4313-8a26-99c44d8dfce6`) — another account on the app, not Tre's.

Not a bug, and it changes no Stage C conclusion (the car fund's account `933cbc10…` is on Tre's
`de492512…` Chase connection). But **any live tracing must filter by Tre's `user_id`**, or it will
silently read a stranger's rows. `synced_transactions` totals in the old table were cross-user.

## ✅ Item 5 CLOSED — pending→posted retirement verified against real data

`synced_transactions` is now **699 rows across 6 connections** (was 143, Discover only). That is
enough real traffic to test the retirement path directly, and it is clean:

- **270** posted rows carry a `pending_transaction_id`, and **0** of those pointers resolve to a
  still-live row. Every superseded pending row was retired. (Self-join on
  `connection_id + provider_transaction_id`.)
- **0** pointer-less duplicates — no (same account, same amount, one pending + one posted, within
  6 days) pair exists anywhere, so the path is not missing charges where Plaid omits the pointer.
- The **10** surviving pending rows are all **1-2 days old** (dated 08-06/08-07). Legitimately
  in-flight, not stranded.

The double-count `SETTLEMENT_LAG_DAYS` exists to prevent is not occurring in live data.

## ⚠️ The standing re-check FIRED — Stage C is no longer a structural no-op

Previous handoffs said "only Discover has a `sync_cursor`… the moment a checking-account cursor
appears, §1A Stage C stops being a no-op." **That moment has arrived.** All 7 connections now have
cursors; 6 synced 2026-08-08 13:00 UTC:

| Institution | conn | rows | pending |
|---|---|---|---|
| Chase | `de492512…` | 376 | 4 |
| Discover | `881f3807…` | 143 | 0 |
| Chase | `eaddb4e3…` | 128 | 5 |
| American Express | `6e1f30db…` | 34 | 1 |
| Alliant | `12dd917f…` | 18 | 0 |
| Robinhood / Empower | — | 0 | 0 |

The car-loan funding account `933cbc10…` (**Chase TOTAL CHECKING**) went **0 → 138 rows**, settled
range **2026-01-17 → 2026-08-05**, `account_id` resolved on every row (0 untracked).

### Stage C is still number-neutral today — and now for a VERIFIED reason

Traced by hand for the live car fund (`0f75dec9…`, 2004 Chevorlet C5, `loan_payment_account` =
`933cbc10…`, `actual_monthly_payment` **$422.89**, `payment_start_date` **2026-08-07**):

- **The real payment is sitting PENDING** — matching amount and date, on the loan payment account.
  There is **no settled** row near that amount on that account. (Descriptor deliberately not quoted:
  this repo is PUBLIC. Re-read it from `synced_transactions` if a future session needs it.)
- `matchCharge` skips pending rows → `matched: false`.
- `hasCoverage` needs latest **settled** ≥ dueDate+5 = **2026-08-12**; latest settled is
  **2026-08-05** → `hasTxnCoverage: false`.
- Both false → `isCapturedInBalance` falls through to the date heuristic, byte-identical to
  pre-Stage-C. **No projected number moves.**

This is the design working, not a gap: pending is not settled evidence, and the gate declines to
conclude anything rather than guess.

### 🔜 Predicted FIRST real Stage C number move — worth watching

`matched` is honoured **without** coverage (`sync-cutoff.ts:102-105`), so the moment that $422.89
settles, the August car payment flips to **captured** and drops out of month 0. Under the heuristic
alone that drop would not occur until `balanceAsOf ≥ 2026-08-11` (dueDate 08-07 `<` basis−3). So
Stage C should retire the charge **~2 days earlier than the old rule**, which is the entire point
of §1A. If the payment settles and the August car payment does **not** drop, that is a real bug —
check that the settled row kept a date within ±5 days of 08-07.

## ✅ §2.10 SHIPPED — `80f72c2d` — percent-of-linked-account saved source

**The audit corrected the spec, and this is the part worth carrying forward.** Car funds ALREADY
derive from the linked account at nine read sites — but only when that account is *separate* from
the funding account. That guard is load-bearing (`forecast-engine.ts:406-408`): when the linked
account IS the funding account, its balance is already offered as available cash, so calling it
"saved" too double-counts. Therefore the originally specced **`account_balance` mode was dropped** —
it already exists where it is valid and would be actively wrong in the exact case §2.9's drift lives
in. **Do not re-propose it.**

`getCarFundSaved(cf, fundingAccountId, linkedAccountBalance)` in `vehicle-loan-engine.ts` is now THE
single source; both rules (percent, and separate-account-derives-live) live in it, and all ten call
sites route through it including `getCarFundEarmark`. Under `'fixed'` it returns exactly what each
site computed inline before — pinned across all six link/funding/balance shapes, so §2.10 **moves no
existing cash figure**.

DB (migration `car_funds_saved_source`, applied live): `saved_source` (`'fixed'|'account_percent'`,
default `'fixed'`) + `saved_percent`, with three CHECKs (enum, 0-100, percent requires a linked
account). **All existing rows are `'fixed'`** — verified, zero behavior change.

Gate: **578/578 tests (18 new), tsc 0**, eslint unchanged (the 1 `useCardProjection` exhaustive-deps
warning is PRE-EXISTING — verified by stashing).

Deliberate calls, do not re-litigate:
- **Demo stays on `'fixed'`.** The only percent reproducing §2.9's live-verified $1,200 against d1's
  $2,800 is 42.857…%, which puts float noise into an on-screen money figure. Percent mode is
  covered by unit tests instead.
- **Two divergences preserved, not unified**: the fallback purchase-date estimator
  (`forecast-engine.ts`) and the lump-sum path (`useCardProjection.ts`) have always derived from ANY
  linked account, funding one included. They pass a **null funding id** so percent mode is added
  without changing which account they read. Unifying them is a separate, behavior-changing decision.

Files: `vehicle-loan-engine.ts`, `types.ts`, `forecast-engine.ts`, `useCardProjection.ts`,
`Dashboard.tsx`, `Vehicles.tsx`, `demo-data.ts`, `integrations/supabase/types.ts` + 7 test files.
Backups: `backups/2026-08-08_105248/`.

### ✅ §2.10 UI — LIVE-VERIFIED (session 109, demo mode + DB round-trip). Do not re-verify.

On screen in demo, Vehicles → Saving for Down Payment → edit the Civic:
- Form labels include **"Amount Saved"**; **"Current Saved" is correctly absent** (d1 is linked).
- Its select carries exactly `['fixed','account_percent']`, defaulting to `fixed`.
- Switching to `account_percent` reveals **"Percent of Balance Saved for This Vehicle"** and swaps the
  hint to *"Tracks the balance, so it can never claim more than the account holds."*
- The Civic card reads **$2,800 / $5,600 (50%)** — the linked-balance derivation, unchanged by §2.10
  (stored `current_saved` is $1,200; the card correctly shows d1's live $2,800).

DB round-trip verified against the real project: a throwaway `account_percent` row inserted and
**deleted** (only Tre's `2004 Chevorlet C5` remains, untouched — confirmed by SELECT), and the
`car_funds_saved_percent_requires_account_check` constraint correctly **rejected** percent mode with
a null linked account.

⚠️ **CTE gotcha, cost a cleanup call:** `WITH ins AS (INSERT…), del AS (DELETE … WHERE id IN (SELECT
id FROM ins))` reports `rows_deleted: 0` and **leaves the row behind** — the DELETE reads the same
snapshot and cannot see the just-inserted row. Insert-then-verify-then-delete needs SEPARATE
statements. Always re-SELECT to confirm cleanup actually happened.

Not exercised: clicking Save in demo (demo mode does not write to the DB). The payload construction
is plain code and the DB constraints are verified; this is not worth a real-account write.

## Still open (carried, renumbered)

1. ~~Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`~~ — **CLOSED session 110 as SKIP, now measured rather than
   assumed.** The item is 4b's goal auto-stop: both sites count a transfer/investment rule as a cash
   outflow after its savings goal is fully funded, because `goals` are not in scope on either call
   chain, so the debt engine slightly UNDER-recommends payments in that window.

   **Live effect is $0, and structurally so.** Two things close it: (a) both sites already honour
   `recurring_rules.end_date`, and 97.3's auto-end toggle WRITES that date on a goal's linked rules,
   so every toggle-on goal is correct by construction; (b) the gap only bites if a goal completes
   inside `PROJECTION_MONTHS` (60). Measured 2026-08-08 — **none of the four goals does**:
   Brokerage ~month 335, Roth IRA ~month 280, 401K Roth has no linked rule at all, and Savings
   (the nearest) lands ~**month 62**, just past the horizon — and its HYS rule already carries a
   user-set `end_date` of 2031-06-30 (~month 58) that both sites honour anyway.

   Fixing it means threading a completion cutoff into the 60-month convergence loop — the engine
   with ~12 rounds of hard-won fixes — for zero dollars. Not a trade worth making. Both sites now
   carry the analysis in place so it is not re-derived a fourth time.

   **REOPEN WHEN:** a goal's linked contributions complete it inside 60 months while its rule
   carries no `end_date`. **This is now AUTOMATED** (`347d051f`, Tre's call — "you should just test
   for that"): `src/lib/__tests__/goal-contribution-overrun.test.ts` fails the moment that becomes
   true, so nobody has to remember to re-measure it. The real-data half reads the gitignored
   fixture and skips where it is absent (CI); the synthetic half always runs.

   ⚠️ **`computeGoalCompletionIdx` is NOT bounded by `PROJECTION_MONTHS`.** It returns indices
   9-14 years out on Tre's real goals. The first version of this guard treated "returns a date" as
   "completes in-horizon" and flagged all three linked goals; it must bound the index against
   `PROJECTION_MONTHS` explicitly. It also has its OWN much-longer internal cap (a $100k goal at
   $25/mo returns null), so a test case meant to sit "past 60" needs to land in the gap — ~100
   months works. Both traps are now pinned by tests.
2. ~~§2.10 UI live-verification~~ — **DONE session 109**, see above. §2.10 fully closed.
3. ~~`backup.plaid_items_20260807` / `backup.accounts_20260807`~~ — **CLOSED AS KEEP. Tre decided
   2026-08-08: "don't drop them — close the item as keep." Do NOT re-propose dropping these.**
   They are the 2026-08-07 §1 snapshot (7 + 31 rows), kept because the org is on the **free plan —
   no PITR, no automated backup**, so this is the only copy of pre-§1 state. Live counts match
   exactly (31/31, 7/7) and the `backup` schema has **no grants to anon/authenticated/public**, so
   it is not an exposure. 38 rows is not worth an irreversible drop.
4. Native Plaid Hosted Link device verification (needs a physical device).
5. ~~Stage A's pending→posted retirement path not exercised against real data~~ — **CLOSED session
   110**, verified clean at 699 rows / 270 pointers. See above. Do not re-verify.
6. **Watch the first live Stage C flip** (see prediction above). Not a task; a check to run each
   session: has the $422.89 settled, and did the August car payment drop from month 0?
   **Re-checked session 112 — still pending, has not fired.** See the item 6 section at the top.

## ✅ Stage 6 — shipped `0b66da3c`, DEPLOYED session 112 (see the top section)

**Tre picked Stage 6 (session 111).** Code committed locally, **593/593 green, tsc 0, eslint
clean**. Backup `backups/2026-08-08_124500/`. Edge function **deployed session 112 (v51)**.
The design notes below are kept because they record decisions, not pending work.

### The audit corrected the plan's premise — carry this forward

- **The "Goals" half of Stage 6 is already done and should NOT be built.** SavingsGoals has no
  ad-hoc projection; it was extracted into `src/lib/savings-growth.ts` (pure, shares
  `PROJECTION_MONTHS`) and its contribution-stop rule already matches the Forecast/Dashboard/debt
  engine. Pointing it at `calculateForecast()` would be churn — goal APY growth is not something
  that engine models. **Do not re-propose it.**
- **The AI Advisor was the whole of the real work.** `AiAdvisor.tsx:736-744` ran its own
  closed-form amortization (`-ln(1 - rB/P)/ln(1+r)`) per `debts` row.
- **Root cause is the `debts` table: it has NO `account_id`.** It is a standalone user-entered
  tracker, which is why line 700 already excludes it from `totalDebt` as a double-count. Matching
  to engine cards is by case-insensitive name — the convention the loans block at :680 already used.

### Live defect this fixed (measured, not hypothetical)

| Debt | Advisor told the LLM | Reality |
|---|---|---|
| Prime Visa $5,037.73 @ 27.49%, target $500 | payoff in **12 months** | full APR applied, 0% promo installment ignored |
| Discover $3,734.71 @ 19.49%, target **$52** | **never pays off** (null) | $52 < $60.65/mo interest, so the guard fell through — while the app shows a real payoff date |

An advisor that contradicts the page it is embedded in is worse than one that stays quiet.

### Design (Tre delegated: "do what you believe is best for my customers")

`src/lib/advisor-debt-context.ts` (**new, pure, 10 tests**) is the single source:
- Engine-modelled cards are authoritative, payoff from `firstRevolvingPayoffMonth` — **the same
  helper Debt Payoff uses**, so it cannot drift. Covers Venture X / Apple, which `debts` never had.
- `debts` rows with **no** engine match are preserved (nothing typed is lost) but carry
  `payoffMonthsFromNow: null` + `source: 'user_entered'`, and the prompt explicitly tells the model
  not to estimate their payoff. A failed name match degrades to "listed once, no claim" rather than
  "payoff silently dropped".
- Adds `creditCardDebtFreeMonthsFromNow` to the prompt as the authoritative figure.

⚠️ **Off-by-one trap, pinned by test:** `firstRevolvingPayoffMonth` returns a **1-indexed** month
where index 0 is the CURRENT month, so months-from-now is `payoffMonth - 1`. `DebtPayoff.tsx:96`'s
`debtFreeDate()` takes a **duration** (`now + months`) — different semantics, do NOT reuse it
directly. That is why the conversion lives in `payoffMonthsFromNow()` with its own tests.

### ✅ Deploy DONE (session 112)

The field rename `projectedPayoffMonths` → `payoffMonthsFromNow` is now live on both sides.
Also fixed in passing: `body.debtDetails.sort()` mutated the request body; now `[...].sort()`.

## Next

Items 4 and 6 are **waits** (physical device / bank settlement), not work. Everything else is
closed. There is no §2.11 — the §2.x series ended at §2.10. Forecast-engine **Stages 4-5 remain
deliberately on hold**.

**The queue is empty.** The only queued candidate is the roadmap's **FB.6-13** UX items. **Do not
start without Tre choosing** — it changes scope. A fresh session should run item 6's two queries,
report, and then ask Tre what to pick up.

## Closed previously (do not reopen)

§2.10 (session 109, code+DB+UI, fully live-verified), §1A Stage C (all parts, session 103), 97.1 `/debt` TOTAL LIMIT tile ($25,400), `types.ts` regen
(session 104), remote access (Tailscale+RDP, sessions 104/107 — lives OUTSIDE this repo in
`C:\Users\tvonh\Desktop\remote-access\`; **this repo is PUBLIC**), **97.3** (all parts, incl. the
goal chart earning interest after contributions stop, live-verified session 107), **§2.9**, and now **§2.10**.

**~~Re-check each session~~ — RESOLVED session 110.** This said "only Discover has a `sync_cursor`
(143 rows); the car-loan funding account `933cbc10…` has 0 synced transactions." **All of that is
now stale** — every connection has a cursor, TOTAL CHECKING has 138 rows, and Stage C's evidence
path is live. See the Stage C section above. Do not carry the old wording forward.

## Live drift worth knowing (not a bug, do not chase)

Live shows **CC Debt Free Oct 2028**; the fixture golden pins **Jul 2027**. The fixture is from
2026-07-20 and live balances have moved. The golden asserts against the fixture, not live.
Do not "fix" the golden to match live.

## Push status

**Run `git rev-list --count origin/main..main`.** Do not trust a number written here — this line
has gone stale within a single session before, because parallel sessions push. Session 112 found 3
unpushed and added its own commits on top; it did **not** push.

Standing rule unchanged: **never auto-push** — session 107's push was a one-off explicit
authorization and does NOT carry forward.

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Savings goal's linked rule (97.3's stamped one) = `73a5c998-d99d-4418-9578-c9d8d9f5dc10` (HYS).
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2`; Discover account =
  `34c9574b-3557-4729-a812-f0b1b508b882` (still the ONLY account with synced transactions).
- Car loan payment account = `933cbc10-bceb-4c20-8227-4a02e6db728a` (**Chase TOTAL CHECKING**).
- `sync_cursor` lives on **`financial_connections`**, NOT on `accounts`.
- `financial_connections` uses **`last_synced_at`** and **`connection_status`**.
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`.

## Environment gotchas (carried)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. ⚠️ **CHANGED 2026-08-08:** the Claude-controlled Chrome is now **SIGNED OUT** — session 107's
   parked signed-in tab is gone. `localStorage` had **no `sb-*` key**. Probe before assuming.
3. **Demo mode is in-memory React state, NOT a URL or a flag.** There is no `/demo` route and no
   localStorage toggle. Go to `/auth` and dispatch the full pointer sequence on the **"Try Demo"**
   button; it navigates to `/dashboard`. `useSupabaseData` then serves `demoAccounts`
   (`useSupabaseData.ts:19-29`, Chase Checking `d1` = **$2,800**) + `demo-data.ts`.
4. ⚠️ **`javascript_tool` returns `[BLOCKED: Cookie/query string data]`** when the result is a large
   array of page strings. It is not a page error. Fix: return a **small structured object of just
   the values you need** (label → amount map), not a dump of every text leaf. Cost me 2 calls.
5. Dev server `localhost:8080`, `strictPort`. Start with `node scripts/dev-session.mjs up`.
6. `/budget` rules split across tabs; `cost_type` overrides category ("Dog food" is **Variable**).
7. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
8. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
9. Vitest suppresses `console.log` — write to a scratch file.
10. `.env.local` (not `.env`) holds the VITE_ keys — all publishable/client-side.
11. `npx supabase` CLI has **no config READ path**; never use it to fix a redirect URL.
12. `config.toml` is the source of truth for `verify_jwt`.
13. **No `deno` binary locally** — but edge functions are **NOT unverifiable**. Type-check one with
    the TypeScript compiler API using `noResolve` (which skips the unresolvable remote imports)
    and a `lib` of `es2022 + dom`. Everything then resolves except `Deno` itself, which the
    runtime provides — so **4 × TS2304 `Cannot find name 'Deno'` is the clean result**:
    ```js
    const ts=require('typescript');
    const prog=ts.createProgram(['supabase/functions/<fn>/index.ts'],{noResolve:true,
      skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
      moduleResolution:ts.ModuleResolutionKind.Bundler,
      lib:['lib.es2022.d.ts','lib.dom.d.ts'],noEmit:true});
    // ignore 2307/2688/2792 (module resolution); anything else is real
    ```
    This catches exactly the class of bug hand-review misses (undeclared names, wrong field
    types). ⚠️ **There is no `esbuild` in this repo** — Vite 8/rolldown replaced it; `typescript`
    is present.
14. `tre-forged-conductor/` belongs to a PARALLEL session. Never `git add -A`; list files explicitly.
15. Supabase MCP `generate_typescript_types` returns a JSON envelope too large to paste; read the
    persisted tool-result file and extract `.types` with node.
16. ⚠️ **`handoff.md` is committed to a PUBLIC repo.** It is a working note, but it ships to GitHub.
    Amounts, account UUIDs and `user_id` are the established (accepted) level of detail. Do NOT add
    raw bank transaction descriptors, merchant/counterparty names, or anything pulled verbatim out
    of `synced_transactions` — cite the amount and date and let the next session re-query the row.
    Session 110 pasted one descriptor and had to scrub it after pushing.

## Browser-verification recipes (reusable)

Radix tabs do **not** switch on `element.click()`. Dispatch the full pointer sequence — this is also
how you enter demo mode (gotcha #3):

```js
for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
  el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(
    t, {bubbles:true, cancelable:true, button:0, pointerId:1}));
```

**Verifying a snapshot/chain equation on screen** (session 108, better than parsing SVG): pair each
known row label with the next money-shaped text leaf, then fold it yourself and compare to the
rendered total. Proves the column adds up in the units Tre sees:

```js
const leaves=[...document.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>e.textContent.trim());
const i=leaves.indexOf('Balance on hand');
const amt=leaves.slice(i+1,i+4).find(t=>/^[−+-]?\$[\d,]/.test(t));
```

For a recharts line, read exact rows off the **React fiber** (walk up from `.recharts-surface` via
`__reactFiber$` until `memoizedProps.data` has `month`) rather than parsing `d` geometry.
`computer{action:'hover'}` does not populate the recharts tooltip; do not burn calls on it.

## Lessons

**Session 112 — "no local toolchain" is usually "no local toolchain I reached for."** Four handoffs
carried gotcha #13 as "edge function type errors only surface at deploy", and Stage 6 shipped its
edge-function edit reviewed *by hand* on that basis. But `typescript` is a dependency of this repo,
and its compiler API type-checks a Deno file fine once `noResolve` takes the remote imports out of
play. The blocker was never the missing binary; it was accepting the missing binary as the end of
the question. **Before recording something as unverifiable, name the specific tool you tried.**

**Session 112 — a deploy that succeeds is not a deploy that runs.** The MCP call returning
`version: 51, ACTIVE` only says the upload was accepted; a bad import path or a missing env var
still fails at first invocation, in front of a customer. On a `verify_jwt: true` function the anon
key is itself a valid JWT, so POSTing with it as the Bearer token clears the gateway and lands in
the function body, which rejects it as not-a-user. **One free call with no side effects proves the
module graph loaded and the env is populated.** Always spend it.

**Session 111 — a surface that TALKS about the numbers is a surface that computes them.** Stage 6
was filed as "wire Goals + AI Advisor to the engine", which reads like plumbing. The actual find was
an LLM being fed a fabricated payoff timeline that contradicted the app's own screen. When auditing
for duplicate math, **include the surfaces that only narrate** — a chat answer is as much a number
the customer acts on as a tile is, and it is the one place a wrong number arrives phrased
persuasively.

**Session 111 — check the OTHER side of the wire before renaming a field.** Renaming
`projectedPayoffMonths` in the client would have silently broken the deployed edge function that
formats it into the prompt: no crash, no error, the payoff line just vanishes. `grep` for the field
name across `supabase/functions/` is the whole check, and it costs one call.

**Session 111 — a multi-tenant table does not owe you a single tenant.** Session 110 grouped
`synced_transactions` by `connection_id` with no `user_id` filter, got 7 connections, and wrote them
up as Tre's. One of them is another user's. Every count in that table was cross-user. The app has
real users now, so **the unfiltered query is the wrong query by default** — the standing "always
filter by Tre's `user_id`" rule exists for reads, not just writes, and grouping by a foreign key is
exactly where it gets forgotten.

**Session 111 — a stale push-status line is worse than none.** The handoff asserted "8 ahead" as
fact; it was 0 by the time it was read, because another session pushed. Anything about mutable
external state should be written as a command to run, not a value to trust.

**Session 110 — if a deferral rests on a property of the DATA, encode it as a test, not a note.**
Tre's call, and the right one: item 1's skip was justified by "no goal completes inside 60 months",
which can stop being true with no code change and no one noticing. A note asks a future session to
re-measure; a test just fails. Writing it also caught a real error in my own reasoning
(`computeGoalCompletionIdx` is not horizon-bounded), which the prose version would have preserved
indefinitely — **a claim you can execute gets checked; a claim you can only read does not.**

**Session 110 — price a deferral before re-carrying it.** Item 1 rode four handoffs as
"Recommendation: skip" with the reasoning compressed out of it. Reading the original entry showed it
was 4b's goal auto-stop, and four SQL queries showed the effect is $0 because no goal completes
inside the projection horizon and 97.3's `end_date` writes already cover the toggle-on case. A
deferral with its reasoning stripped is indistinguishable from an unexamined one — either restate
the cost or close it.

**Session 110 — a "blocked on real data" item can unblock itself while you aren't looking.** Item 5
sat carried for sessions as un-exercisable because only Discover had synced rows. One `count(*)`
showed the table had grown 143 → 699 and the checking accounts had backfilled; the item was
verifiable in three queries and closed the same session. **Re-measure a blocking condition before
re-carrying it** — the handoff records what was true when it was written, not what is true now.

**Session 110 — "number-neutral" from an untested path and from a traced one are different facts.**
Stage C shipped number-neutral because no checking account had transactions; it is *still*
number-neutral, but now because the real payment is pending, `matched` is false, and coverage ends
2026-08-05. Same observable, completely different confidence. When the precondition for a
no-op changes, re-derive the no-op instead of assuming it held.

**Session 109 — audit the premise before building the spec.** The handoff said car funds "never got"
the derive-from-account treatment savings goals have. One grep showed they had it at nine sites, and
that the guard those sites share made one of the three proposed modes actively wrong. Three modes
became one, and the feature got smaller and more correct. A spec inherited from a previous session
is a hypothesis, not a requirement — cheapest possible check, run it first.

**Session 109 — a guard repeated at every call site is a rule with no home.** `!== fundingAccountId`
appeared at nine sites and was missing from the tenth, which is exactly where §2.9's bug was. Same
shape as session 108's clamp: when you see the same condition copied everywhere, the one place it
was forgotten is where the bug lives.

**Session 108 — a clamp is not a model.** `Math.max(0, …)` at two call sites looked like defensive
arithmetic; it was actually the app deciding, silently, that a data inconsistency didn't exist. When
you find the same clamp duplicated at every caller, the thing being clamped away is usually
information someone needs. Move the clamp into one helper and **return what it discarded**.

**Session 108 — prove a refactor moves nothing.** The risky part of §2.9 was re-expressing a cash
figure the entire debt engine is built on. A test asserting the old and new expressions agree across
the sign boundaries turns "should be equivalent" into a pinned fact, and it costs six lines.

**Session 105 — when one surface disagrees with three others, fix the outlier by making it CALL
them.** Not by re-implementing the rule in the outlier.

**Session 105 — prove the fix in the units the user sees.** "The slope drops" is a shape claim;
"$20,548 not $25,000" is the claim Tre can check.

Prior sessions' lessons (1-107) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
