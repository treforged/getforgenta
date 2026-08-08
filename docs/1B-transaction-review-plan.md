# §1B — surfacing synced transactions: review, link, categorize, import

Status: **PLAN — not started.** Written 2026-08-08 (session 113), at Tre's request:

> "i want to pull transactions in and have them also auto connect to user created rule and
> transaction. otherwise it adds a transaction if the user says it doesnt match anything. this
> needs planning. it should go into the transactions tab and integrate with calculations and
> rules. users should be able to categorize if the auto cat is wrong"

This **reverses the 2026-08-07 scope call** in `1A-transaction-sync-plan.md:150` ("server-owned and
unbrowsable — no Transactions view in v1"). That reversal is Tre's to make and is recorded here so
no future session re-applies the old constraint.

---

## Ground state (verified 2026-08-08, not assumed)

| Fact | Source | Value |
|---|---|---|
| Plaid ingestion | `_shared/sync-handler.ts` | **live**, cursor-based `/transactions/sync` |
| Sync cadence | `cron.job` jobid 16 `plaid-daily-sync` | Mon/Wed/Fri/Sat 13:00 UTC |
| `synced_transactions` (Tre) | live SQL | **571 rows**, 2026-01-17 → 2026-08-07, 5 pending |
| Settled rows this month | live SQL | 24 |
| `public.transactions` (Tre's ledger) | live SQL | **22 rows** |
| Active `recurring_rules` | live SQL | 30 |
| Auto-match (Stage B) | `src/lib/transaction-matching.ts` | live, read-time, feeds `/budget` badge |
| Capture evidence (Stage C) | `src/lib/sync-cutoff.ts` | live, feeds forecast/card engines |
| Plaid categories present | live SQL | 18 PFC primaries; `GENERAL_MERCHANDISE` is 183/571 (32%) |

**Two conventions differ and the import path must respect both:**

- `recurring_rules.payment_source` holds a **bare** `accounts.id` uuid.
- `transactions.payment_source` holds the **`account:`-prefixed** form (22/22 rows, 0 bare uuids).
- `normalizePaymentSource()` in `transaction-matching.ts:113` already accepts both. Reuse it; do not
  write a second parser.
- `transactions.account` is a **legacy free-text label** — it reads `"Checking"` on all 22 rows
  including ones whose `payment_source` points at the Discover card. Import must set it from the
  real `accounts.name`, never by copying an existing row's value.

---

## The hazard this feature is built around

`public.transactions` is not a passive log. **Twelve surfaces read it**, including
`useForecastEngineInputs.ts:66` and `CardProjectionContext.tsx:63` — so every row written into it
moves projected numbers across Dashboard, Forecast, Debt Payoff, Vehicles and the AI Advisor at
once.

Three datasets now describe the same dollars:

| Dataset | Meaning | Already in calculations? |
|---|---|---|
| `recurring_rules` | the obligation, projected forward | yes — the whole forecast |
| `public.transactions` | the user's hand-entered actuals | yes — 12 surfaces |
| `synced_transactions` | what the bank says happened | only as **evidence** (Stage C) and a **badge** (Stage B) |

If a synced charge is imported into the ledger **while a rule already projects that same charge**,
the money is counted twice and every downstream number is wrong.

**This is why Tre's instinct — "otherwise it adds a transaction if the user says it doesn't match
anything" — is load-bearing and not merely UX.** Import is offered *only* on rows that matched
nothing. A linked row is an **annotation and creates no money**. That invariant is the spine of the
whole design; if a future session relaxes it, the double-count returns.

---

## Design

### The persistence question, and why §1A's "never persist a match" still holds

§1A says matches are derived at read time and never stored, because rules are edited constantly and
a stored match would need invalidating on every edit. That stays true — **for the matcher's
suggestions**.

A *user decision* is a different object: it is an assertion by the person, not an inference from
data, and it must survive a rule edit precisely because it was not derived from the rule. So:

- **Suggestions** stay derived (`matchCharge`, unchanged, uncached).
- **Decisions** get a new table. `synced_transactions` itself stays user-unwritable at the grant
  layer — that migration's reasoning (`20260807_synced_transactions.sql:8-11`) is still correct:
  a user edit to a provider fact is silently reverted on the next sync.

### New table `synced_transaction_reviews`

```
id                     uuid pk
user_id                uuid not null              -- RLS key
synced_transaction_id  uuid not null unique -> synced_transactions(id) on delete cascade
status                 text not null              -- 'linked_rule' | 'linked_txn' | 'imported' | 'ignored'
rule_id                uuid -> recurring_rules(id)  on delete set null
transaction_id         uuid -> public.transactions(id) on delete set null
occurrence_month       text                       -- 'YYYY-MM', which occurrence of a monthly rule
category_override      text
created_at / updated_at
```

Full owner CRUD via RLS (unlike `synced_transactions`) — these rows *are* the user's.
Absence of a row means **unreviewed**; there is no `'unreviewed'` status to write, so the table
stays small and no backfill is ever needed.

CHECK constraints pin the invariant in the database, not just the UI:
`status='linked_rule'` requires `rule_id` **and** `occurrence_month`; `'linked_txn'` and
`'imported'` require `transaction_id`; `'ignored'` requires both null.

`on delete set null` (not cascade) on both FKs: deleting a rule must not erase the record that this
bank charge was already dealt with, or it reappears in the inbox as new.

### Auto-categorization — `src/lib/plaid-category-map.ts` (new, pure)

Plaid PFC primary → app `CATEGORIES`. Pure lookup, no I/O, unit-tested, unmapped → `'Other'`.

```
FOOD_AND_DRINK → Dining        RENT_AND_UTILITIES → Utilities   LOAN_PAYMENTS → Debt Payments
TRANSPORTATION → Gas           ENTERTAINMENT → Entertainment    MEDICAL → Health
TRAVEL → Travel                PERSONAL_CARE → Personal         INCOME → Income
GENERAL_MERCHANDISE → Shopping GENERAL_SERVICES → Other         BANK_FEES → Other
HOME_IMPROVEMENT → Other       GOVERNMENT_AND_NON_PROFIT → Other
TRANSFER_IN / TRANSFER_OUT / LOAN_DISBURSEMENTS → Other
```

**Be honest about the ceiling:** `GENERAL_MERCHANDISE` is 32% of Tre's rows and means "a store".
Mapping it to `Shopping` is a guess that will often be wrong, which is exactly why Tre asked for the
override. The map is a **first draft the user corrects**, never a claim. Do not chase accuracy by
adding merchant-name heuristics — §1A rejected fuzzy name scoring for reasons that apply here too.

### The review surface — a tab inside `/transactions`

`/transactions` today is a *planning* stream: 22 hand-entered rows merged with generated debt
payments, payment-plan installments and car-loan transactions. Bank activity is a different kind of
thing (what happened, not what will), so it goes in its **own tab on the same page** rather than
being interleaved. Same page as Tre asked; no confusion about which rows are projections.

Each row shows: date · merchant · amount · account · suggested category (editable) · and one of

- **"Matches: `<rule name>`"** — from `matchOccurrence`, with `Confirm` / `Not this`
- **"Matches your entry on `<date>`"** — amount+account+date match against `public.transactions`
- **no suggestion** — `Add to my ledger` / `Ignore`

Per §1A's design bias, an absent suggestion renders as *no information*, never as "unpaid".

**Volume is the real product risk — resolved by separating availability from obligation.**
571 rows across 7 months, against a 22-row ledger.

Tre's call (2026-08-08): **all accounts, all history.** The reasoning that settled it is his:
history is what makes rule discovery possible at onboarding (§1C below), so it is an *input*, not
just an archive. This plan's first draft recommended restricting the inbox; that conflated
*browsing* with *a queue demanding decisions*. Browsing everything is free. So:

- every account, every settled row, **fully browsable and filterable**, all the way back
- filter **defaults** to the current month, switchable to any month or All
- **"unreviewed" is never surfaced as a nagging count or badge.** There is no "24 items need
  review". A row you never touch is simply history. This is what makes all-history safe.
- **pending rows are excluded entirely** — they are not facts yet, and §1A's whole point is that
  pending is not evidence
- bulk `Ignore` on a selection, and `Ignore all from this merchant`

⚠️ **Nothing anywhere may read "unreviewed" as "did not happen".** With all history in scope the
vast majority of rows are permanently unreviewed *by design*, so that inference would be wrong at
scale, not merely occasionally.

---

## Sequencing — four independently shippable stages

Same discipline §1A used, for the same reason: only two of these can move a number, and each of
those ships alone and gets live-verified alone.

| Stage | Scope | Moves a number? |
|---|---|---|
| **1** | Read-only Bank Activity tab: list settled synced rows, show auto-category + auto-match suggestion. No writes at all. | **no** |
| **2** | `synced_transaction_reviews` table + Confirm / Not this / Ignore / category override. Links are annotations. | **no** |
| **3** | `Add to my ledger` → writes a `public.transactions` row, tagged with origin, offered **only** where nothing matched. | **YES — first** |
| **4** | Confirmed links feed `buildCaptureEvidence` as `matched: true`, overriding the auto-matcher. | **YES — second** |

Stage 4 is the "integrate with calculations and rules" half, done at the correct layer: through
`transaction-matching.ts`, the **single existing definition of "matched"** that both the badge and
the capture gate already share. A user confirmation is strictly better evidence than the auto-match,
so it belongs inside that function's result, not in a parallel path that could disagree with it.

Stages 1 and 2 are safe to ship together. **3 and 4 must not be.**

---

## Risks

1. **Double-count on import** — the central one. Mitigated by offering import only on unmatched
   rows, by the DB CHECK constraints, and by a test asserting a linked row never produces a ledger
   row. Test this against the real fixture before Stage 3 ships.
2. **Imported rows and Stage C interact.** An imported ledger row and the synced row it came from
   both describe one charge. Stage C reads `synced_transactions`, the forecast reads `transactions`
   — verify on real data that a Stage-3 import does not both add an actual *and* retire a projected
   charge for the same dollars.
3. **Rule deletion orphans a review.** Handled by `on delete set null` plus a status that survives,
   but the UI must render a link whose rule is gone as "handled" rather than crashing on a null.
4. **Ledger provenance.** Once imports exist, `public.transactions` is no longer purely
   hand-entered, which invalidates a premise stated in three places in the §1A migration and plan.
   An `origin` column (`'manual' | 'synced'`) keeps the distinction legible and lets the UI say
   where a row came from. Cheap now, painful to retrofit.
5. **Volume fatigue** — see above. A half-reviewed inbox is worse than none if any surface ever
   treats "unreviewed" as "didn't happen". Nothing in Stages 1-4 may do that.

---

## ✅ Decisions (Tre, 2026-08-08) — settled, do not re-ask

1. **Scope: all accounts, all history**, with the availability/obligation split above. Tre's
   reasoning — history is the input to §1C's rule discovery — overrode this plan's first draft.
2. **Stage 4 ships: a confirmed link marks the charge captured.** Otherwise confirming is busywork
   the app ignores, and an explicit user confirmation would count for *less* than an automatic
   guess, which is backwards.
3. **Imported rows are fully editable, stamped `origin='synced'`**, with re-import prevented by the
   review row's unique constraint.
4. **Stages 1+2 build first**, alone. 3 and 4 each move numbers and ship separately.

---

## 🆕 §1C — derive recurring rules from transaction history (NOT started)

Tre's onboarding idea, filed here so it is not lost: with months of `synced_transactions` available,
the app can *propose* recurring rules to a new user rather than making them hand-enter 30 of them.

It is a **different consumer of the same data** — a pattern detector (repeated merchant, similar
amount, ~monthly spacing), not an inbox — so it is deliberately out of §1B's scope. It is also the
reason all-history is in scope here: detecting a recurring pattern needs many months.

Do not build without Tre choosing it.
