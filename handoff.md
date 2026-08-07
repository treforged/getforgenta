# Handoff — 2026-08-07 — session 102 — §1A STAGE C PART 2 WIRED; TESTS ARE THE NEXT STEP

> The car-loan month-0 capture gates now take transaction evidence (`5fe4891b`). tsc clean,
> **505/505** — but that count is unchanged because **no test covers the new wiring yet**. That is
> the next step, and it is the only thing between Stage C and done. Nothing pushed.

## ▶ START HERE

**Write the tests for the part-2 wiring.** The code shipped at a context gate before its tests
did. Two files to add:

1. `src/lib/__tests__/capture-evidence.test.ts` — pure, cheap, do this first:
   - no txns / empty array → `undefined` (the "identical to pre-Stage-C" guarantee)
   - `loan_payment_account` null → falls back to the funding account id
   - `loan_payment_account` set → wins over the funding account
   - both null → `undefined`
   - a real matching row → `{ hasTxnCoverage, matched: true }`
2. `src/hooks/__tests__/useCardProjection.captureEvidence.test.ts` — copy the harness from
   `useCardProjection.activeLoanInsurance.test.ts` (same directory; `renderWithCarFund` is exactly
   the shape needed, just add `syncedTransactions` to the params object). The observable is
   `result.current.month0.vehicleInsurance` and `result.current.month0.carLoanPayment`
   (both on `Month0Result`, `src/lib/debt-model-types.ts:44,95`). Three cases per gate:
   - **no rows** → identical to today (the regression guard that matters most)
   - **covered + unmatched** → charge STAYS in month 0 even though the due date is old enough that
     the heuristic would have dropped it. *This is the only case that moves a number.*
   - **matched** → charge is dropped

   Build "covered" carefully: `hasCoverage` needs settled rows spanning the WHOLE
   `± DATE_WINDOW_DAYS (5)` window on both sides of the due date, so seed rows at
   `dueDate − 6` and `dueDate + 6` on the same `account_id`.

Consider an engine-side twin (`forecast-engine`) only if the hook test is cheap to mirror; the two
gates call the identical shared helper, so the hook test already covers the logic.

## What shipped this session (`5fe4891b`)

`src/lib/capture-evidence.ts` (NEW) — `carChargeEvidence(cf, amount, dueDate, fundingAccountId, txns)`.
One definition, imported by BOTH `forecast-engine.ts` and `useCardProjection.ts`, because every
time those two have derived a shared month-0 predicate independently they have drifted (§1.1 cause
C: the $537 payment, then `<=` vs `<`).

It returns **`undefined`**, not `{hasTxnCoverage:false, matched:false}`, when there are no rows.
That is deliberate and worth preserving: it makes the no-transactions path identical to
pre-Stage-C *at the type level*, so an unwired caller and an un-backfilled user take the same
branch of `isCapturedInBalance`.

### Wired — 4 sites, 2 obligations, both loan-phase car charges

| Gate | File |
|---|---|
| Car loan payment, month 0 | `forecast-engine.ts:~295`, `useCardProjection.ts:~1290` |
| Car insurance, month 0 | `forecast-engine.ts:~340`, `useCardProjection.ts:~552` |

- Account = `normalizePaymentSource(cf.loan_payment_account) ?? forecastFundingAccountId`.
- Amount = `getTotalCarLoanMonthly([cf], md)` for the payment — the exact figure the gate is
  deciding whether to charge, so a **final-month true-up** (smaller than the scheduled payment)
  still matches. `getActiveCarLoanPayments` already excludes lump sums; keep it that way, a lump
  sum is a separate debit at the bank.
- Insurance amount = `Number(cf.monthly_insurance || 0)`.

### Plumbing (done, don't redo)

`CardProjectionContext.tsx` fetches `useSyncedTransactions(currentMonthKey)` ONCE and passes the
same array to `useCardProjection` and `useForecastEngineInputs` → `ForecastInputs.syncedTransactions`.
Two independent fetches would be two array identities and, at a refetch boundary, two different
answers for the same car payment. Optional field everywhere, so the gitignored
`forecast-inputs.real.json` fixture replays identically.

## ⚠ The handoff's YES/NO table was wrong on two rows — corrected here

Session 101's table said the pre-paycheck bill floor and upfront-plan installments should take
evidence. Reading the actual call sites says **no**. Both are the card-payment case:

- **`pay-schedule.ts` `dueSynced`** is applied at only two places (~908, ~927) and **both are
  credit-card minimums** — the car loops opt out explicitly. It is not a "real rules" gate at all.
  `getPrePaycheckNextMonthBills` computes the rule-based bills separately and is never gated by it.
- **`payment-plan-generator.ts:~210`** — an `'upfront'` plan is charged to a **CARD** (only card
  ids resolve through `sourceToCardId`), so the installment leaves the funding account folded into
  one lump card payment. No debit for `payment_amount` alone ever posts.

Full NO list, each now carrying an in-place comment saying why:
`credit-card-engine.ts m0MinDueSettled`, `useCardProjection.ts` autopay-full recommendation (~1845),
`pay-schedule.ts dueSynced`, `payment-plan-generator.ts` upfront installments, and
`useCardProjection.ts` `vehicleForecastByMonth` (~490, saving-phase — a hypothetical purchase with
no real charge to match, where a coincidental amount hit would assert a car payment that does not
exist). Every one of them needs transfer-linking between funding account and card, which §1A does
not have.

## Live state — re-verified at the start of THIS session, still number-neutral

`sync_cursor` re-checked: **still only Discover** (143 settled, cursor present). Alliant, Amex,
Chase, Empower, Robinhood all `sync_cursor IS NULL`, last synced 13:00. Every wired gate is on a
checking account with zero synced rows ⇒ `carChargeEvidence` returns `undefined` ⇒ date heuristic
⇒ identical numbers.

**So the live verification for part 2 is "nothing changed."** Capture Forecast month-0 END CASH
before and after and assert equality. Do not manufacture a match to make it look verified.
Re-check `sync_cursor` again next session; Tre's `car_funds` row (2004 Chevrolet C5, `phase='loan'`,
**$422.89/mo** from `933cbc10-bceb-4c20-8227-4a02e6db728a`, insurance **$173.23**) becomes a real
evidence case the moment Alliant's cursor appears.

`financial_connections` uses **`last_synced_at`**, not `last_sync_at`, and `connection_status`, not
`status`.

## Still open (carried)

1. **Tests for the part-2 wiring** — see START HERE. Highest priority.
2. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save → rule
   shows end date in `/budget` + card shows "Auto-ends contributions". Sign-in fixed, unblocked.
3. **97.1 `/debt` TOTAL LIMIT tile** — should read **$25,400**. Unblocked.
4. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
5. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
6. §2.9 car-fund earmark.
7. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop once §1 is settled.
8. Native Plaid Hosted Link device verification (needs a physical device).
9. Stage A's pending→posted retirement path still **not exercised against real data**.
10. `types.ts` still **overdue a full regen** (predates §1/§1A, hand-written `synced_transactions`
    block). Do it on its own commit; a regen rewrites the whole file.

## Sign-in probe (carried — works, do not re-litigate)

Tre added `http://localhost:8080/**` to Supabase → Authentication → URL Configuration → Redirect
URLs. Verify without touching a session by carrying a REAL OAuth `state` from `/authorize` to the
callback with a bogus code; `Location: http://localhost:8080/?error=...Unable+to+exchange+external+code`
means the allow-list accepted it (a rejected redirect bounces to `getforgenta.com`). The redirect
lives in the state, which is why a stateless probe always failed.

## Push status

`main` is well ahead of `origin/main`. Standing rule is never auto-push. **Nothing pushed.**
Check with `git rev-list --count origin/main..main` rather than trusting a number here.

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
11. `tre-forged-conductor/` is untracked and belongs to a PARALLEL session. Never `git add -A`.

## Lessons (session 102)

**Read the call sites before trusting an inherited YES/NO table.** Session 101 wrote a gate table
and explicitly warned that "update all callers" was wrong for one of them — and the table was still
wrong for two more, in the same way, for the same reason. `pay-schedule.ts:813` looked like a
rule-based bill gate from its function name and comment; its two actual call sites are both credit
-card minimums. The name of a helper is not evidence about what it gates.

**One class of charge, one verdict.** The five NO gates are not five judgement calls — they are one
fact wearing five hats: §1A cannot match a card payment, because the money crosses two accounts and
the amount is chosen by the user. Naming the shared cause in each comment is what stops the next
session re-deriving four of them and getting one wrong.

**Put the shared predicate in a module before the second caller needs it.** `carChargeEvidence`
exists as its own file for one reason: `forecast-engine` and `useCardProjection` gate the same car
loan in the same month, and every previous shared predicate between them started as two copies and
became a bug.

Prior sessions' lessons (1-101) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
