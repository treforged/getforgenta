# Handoff — 2026-08-07 — session 101 — §1A STAGE C PART 1 SHIPPED (the rule); PART 2 = WIRING

> `isCapturedInBalance` now takes evidence, and `SETTLEMENT_LAG_DAYS` is officially the FALLBACK
> rather than the rule. That is committed, tested, and moves **no** number. The remaining work is
> wiring evidence into the month-0 capture gates — and this session established that **none of
> those gates can move a number yet**, because the only account with synced transactions is a
> credit card and every gate is on the funding checking account. Nothing pushed.

## ▶ START HERE

**Next work is §1A Stage C part 2** — wire `buildCaptureEvidence` into the month-0 capture gates.
The reference gate (car loan payment, forecast-engine) was started and deliberately reverted at
the context gate, so the tree is clean. The full recipe is in "Stage C part 2" below; follow it
rather than re-deriving.

Read **before** touching a gate: "Which gates may take evidence" — one of them (the CC minimum)
must NOT, and wiring it would be a live double-count regression.

## Stage C part 1 — what shipped (`cc05e234`)

Working tree clean, tsc clean, **505/505** (was 489; +26 tests).

### `src/lib/sync-cutoff.ts` — the demotion

```ts
isCapturedInBalance(dueDate, balanceAsOf, evidence?: CaptureEvidence)
```

- `matched` → captured. Honoured even when `hasTxnCoverage` is false: coverage requires the whole
  match window observed, so a real match can land just outside it, and a transaction that exists
  outranks a conservatism about window completeness.
- covered, unmatched → **NOT** captured. This is the only branch that will move a number.
- no coverage → the date heuristic, byte-identical to before.

The parameter is **optional**, so every existing call site is unchanged and part 2 can proceed one
gate at a time. The file header comment that used to say "this heuristic should be retired, not
tuned" was rewritten to describe what actually happened: demoted, not deleted.

### `src/lib/transaction-matching.ts` — evidence primitives

- `matchCharge(charge: ChargeToMatch, txns)` — Stage B's matcher generalised off the rule shape.
  Stage C's gates ask about things that are **not** recurring rules (a `car_funds` loan payment, an
  upfront-plan installment), and inventing fake rules per call site would be worse.
  `matchOccurrence` is now a thin rule-shaped wrapper over it, so Stage B's badge and Stage C's
  gates still share one definition of "matched". All 32 Stage B tests still pass unchanged.
- `hasCoverage(accountId, dueDate, txns)` — requires the WHOLE `± DATE_WINDOW_DAYS` window
  observed in settled rows, **both ends**. Inferred from row min/max because
  `synced_transactions` stores no coverage range and Plaid's cursor is opaque. It deliberately
  under-claims; under-claiming just falls back to the heuristic. Do not "improve" it by dropping
  the lower bound or counting a single row as a range.
- `buildCaptureEvidence(charge, txns)` — the two booleans together. They are not redundant: "no
  match" alone is ambiguous between "this did not happen" and "we have not looked yet", and those
  demand opposite behaviour from a capture gate. That is precisely what the date heuristic could
  never distinguish.

## Stage C part 2 — the wiring recipe

### Which gates may take evidence (READ THIS FIRST)

`matchCharge` needs a **deterministic amount**. Gate by gate:

| Gate | File | Evidence? |
|---|---|---|
| Car loan payment, month 0 | `forecast-engine.ts:287` + `useCardProjection.ts:1276` | **YES** — fixed amount, fixed day, `car_funds.loan_payment_account` |
| Car insurance, month 0 | `forecast-engine.ts:334` + `useCardProjection.ts:486,539` | **YES** — same shape |
| Upfront-plan installments | `payment-plan-generator.ts:203` | **YES** — `plan.payment_amount` is exact |
| Pre-paycheck bill floor | `pay-schedule.ts:813` | **YES** — real rules, so use `matchOccurrence` |
| **CC minimum settled** | `credit-card-engine.ts:201` (`m0MinDueSettled`) | **NO — DO NOT WIRE** |

**Why the CC minimum must not take evidence.** The user pays whatever they choose, not the
minimum, so `matchCharge` against the minimum amount will almost always miss. On a card that DOES
have coverage (Discover, today) that miss becomes `covered + unmatched` → "not captured" → the
minimum gets reserved again in month 0 even though it was paid. That is the exact double-count
`m0MinDueSettled` was built to remove (Q11, `437d9161`). Matching a card payment needs
transfer-linking between two accounts, which §1A does not have. Leave a comment saying so.

### Plumbing (do this once, then each gate is a few lines)

1. `useSyncedTransactions(monthKey)` already exists in `useSupabaseData.ts:518` — read-only,
   `pending=false`, month ±`SYNCED_TXN_FETCH_SLACK_DAYS` (7). 7 > `DATE_WINDOW_DAYS` (5), so a
   month-0 due date's whole match window is always inside the fetch. Truncation can only raise the
   observed earliest and lower the observed latest, i.e. only ever REDUCE claimed coverage — the
   safe direction. Call it with the **current** month key; Stage C is month-0 only.
2. `CardProjectionContext.tsx` — fetch there (next to `syncCutoffDate`, ~line 133) and pass the
   rows into BOTH `useCardProjection(...)` (~line 190) and `useForecastEngineInputs(...)`
   (~line 205). Both surfaces must get the same array or §1.1 cause C returns in a new form.
3. `forecast-engine.ts` — add `syncedTransactions?: readonly MatchableTransaction[]` to
   `ForecastInputs` (after `paymentPlans`, ~line 128) and destructure it. Optional, so the
   captured fixture (`forecast-inputs.real.json`, gitignored) replays identically.
4. `useCardProjection.ts` — same optional field on its options (~line 48).

Then at each YES gate, replace `isCapturedInBalance(due, cutoff)` with a third argument built from
`buildCaptureEvidence({ accountId, amount, dueDate }, syncedTransactions ?? [])`. `accountId` for
the car gates is `cf.loan_payment_account` (uuid column, confirmed present), falling back to
`forecastFundingAccountId`. Remember `normalizePaymentSource` for anything holding an
`account:`-prefixed source.

### It will not move a number yet — verified, not assumed

Live SQL this session:

- Only **Discover it Card** has synced transactions: **143 settled, 2026-01-30 → 2026-08-05**.
- All six connections synced at 13:00 today, but **only Discover has a `sync_cursor`**. The other
  five (Alliant Checking + Savings, Amex General Operations, Chase TOTAL CHECKING + Prime Visa,
  Empower, Robinhood) have `sync_cursor IS NULL` — consistent with `TransactionsNotReadyError`
  (Plaid's initial transactions pull after the product was added), which `sync-handler.ts:260`
  swallows on purpose and retries next sync. Expected and transient; do not "fix" it.
- **Every Stage C gate is on a checking account**, and no checking account has a single synced
  transaction. So `hasCoverage` is false everywhere → heuristic → identical numbers.

**Therefore the live verification for part 2 is "nothing changed"**, not a moved number. Capture
Forecast month-0 END CASH before and after and assert equality. The $1,463 deposit case in the
plan doc **cannot** be exercised until a depository connection's transactions land. Do not
manufacture a match to make it look verified.

The good news: the reference case is ready and waiting. Tre's one `car_funds` row —
2004 Chevrolet C5, `phase='loan'`, **$422.89/mo** from `loan_payment_account`
`933cbc10-bceb-4c20-8227-4a02e6db728a`, `payment_start_date` 2026-08-07, insurance **$173.23**
anchored 2026-06-25 — becomes a real evidence case the moment Alliant's cursor appears. **Re-check
`sync_cursor` on the other five at the start of the next session**; if any depository one has
filled in, part 2 becomes genuinely live-verifiable.

## Facts worth carrying

- `car_funds.loan_payment_account` (uuid) exists and is populated — the car gates do not need to
  fall back to the global funding account for Tre.
- `financial_connections` has **no `status` column** (it is `connection_status`), and
  `plaid_items` is a VIEW over it.
- The Supabase MCP `get_logs` edge-function view returns request lines only, not `console.log`
  output, so it cannot confirm `TransactionsNotReadyError` directly. The `sync_cursor IS NULL`
  pattern is the usable signal.
- `types.ts` is still **overdue a full regen** (predates §1 and §1A, has a hand-written
  `synced_transactions` block). Regenerate on its own commit; a regen rewrites the whole file.

## Still open (carried)

1. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save →
   rule shows end date in `/budget` + card shows "Auto-ends contributions". Sign-in is fixed and
   the Claude-controlled Chrome tab is signed in, so this is unblocked.
2. **97.1 `/debt` TOTAL LIMIT tile** — should read **$25,400**. Same, unblocked.
3. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
4. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
5. §2.9 car-fund earmark.
6. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop once §1 is settled.
7. Native Plaid Hosted Link device verification (needs a physical device).
8. Stage A's pending→posted retirement path is still **not exercised against real data**.

## Sign-in probe (carried — works, do not re-litigate)

Tre added `http://localhost:8080/**` to Supabase → Authentication → URL Configuration → Redirect
URLs. Verify without touching a session by carrying a REAL OAuth `state` from `/authorize` to the
callback with a bogus code; `Location: http://localhost:8080/?error=...Unable+to+exchange+external+code`
means the allow-list accepted it (a rejected redirect bounces to `getforgenta.com` instead). The
redirect lives in the state, which is why a stateless probe always failed.

## Push status

`main` is well ahead of `origin/main`. Standing rule is never auto-push. **Nothing pushed.**
Check the count with `git rev-list --count origin/main..main` rather than trusting a number here.

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2`; Discover account =
  `34c9574b-3557-4729-a812-f0b1b508b882` (still the ONLY account with synced transactions).
- Car loan payment account = `933cbc10-bceb-4c20-8227-4a02e6db728a`.
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`; `accounts.plaid_account_id`
  is the provider account id.

## Environment gotchas (carried)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. The Claude-controlled Chrome tab is a **separate profile**; check, don't assume.
3. Dev server `localhost:8080`. Budget Control `/budget`, Debt Payoff `/debt`.
4. `/budget` rules split across tabs; `cost_type` overrides category ("Dog food" is **Variable**).
5. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
6. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
7. Vitest suppresses `console.log` — write to a scratch file.
8. `npx supabase` CLI has **no config READ path**; never use it to fix a redirect URL.
9. `config.toml` is the source of truth for `verify_jwt`.
10. **No `deno` binary locally** — edge function type errors only surface at deploy.

## Lessons (session 101)

**Check whether the evidence exists before building the thing that consumes it.** Stage C's design
is sound and its primitives are now shipped, but one SQL query — which accounts actually have
synced rows — showed that every gate it targets is on an account with zero coverage. That query
should have come before the wiring, not after the first gate was half-edited. The plan doc's
"live-verify against the $1,463 deposit" was written when nobody had checked which accounts would
have transactions, and a plan's verification step can be stale in exactly the way its design is not.

**An optional parameter is how a risky change ships safely.** Making `evidence` optional meant part
1 could land complete, tested and provably number-neutral, with the behaviour change deferred to
the call sites — instead of one large diff where "the rule changed" and "eight gates changed" fail
together and cannot be bisected apart.

**A gate is not a gate.** Four of the five capture gates take evidence happily; the CC-minimum one
would regress into the exact double-count it was built to fix, because the user pays an amount the
matcher cannot predict. "Update all callers" was the plan's phrasing and it is wrong.

Prior sessions' lessons (1-100) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
