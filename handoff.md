# Handoff — 2026-08-07 — session 102 — §1A STAGE C PART 2 SHIPPED + TESTED

> The car-loan month-0 capture gates take transaction evidence (`5fe4891b`) and are covered on both
> surfaces (`495db0fa`). tsc clean, **528/528** (+23). Mutation-checked. Stage C is code-complete;
> what remains is the live "nothing changed" check. Nothing pushed.

## ▶ START HERE

**Live-verify part 2 as "nothing changed"** — capture Forecast month-0 END CASH, confirm it is
unchanged. No checking account has synced transactions, so every wired gate falls back to the date
heuristic; a moved number here would be a BUG, not a success. Do not manufacture a match to make it
look verified.

Then pick up the carried items below (97.3 and 97.1 live verification are both unblocked).

## Tests (`495db0fa`) — what they pin, so they are not weakened later

- `src/lib/__tests__/capture-evidence.test.ts` (13) — asserts the VALUE `undefined` for the no-rows
  case, not merely its effect. `undefined` and `{hasTxnCoverage:false,matched:false}` take the same
  branch of `isCapturedInBalance` today, so an effect-only test would pass either way; the value is
  what makes number-neutrality provable at the type level. **Do not relax this to a behaviour check.**
- `useCardProjection.captureEvidence.test.ts` (9) + `forecast-engine.captureEvidence.test.ts` (1,
  self-skips without the gitignored fixture) — the same contract on BOTH surfaces, because §1.1
  cause C was exactly these two disagreeing about one car loan in one month.
- Loan payment and premium are asserted **separately, never summed** — same due date, same account,
  differing only in amount, so a total would let one gate's regression hide inside the other's.
- Each file opens with a baseline assertion that the heuristic ALONE drops both charges. Without it
  the evidence assertions could pass for the wrong reason.
- Dates anchor to a cutoff on the 28th with the charge due on the 1st, **not** to "today", so the
  baseline does not depend on the day the suite runs.
- Observable for the loan payment is `month0.chain.carLoanPayment` (`Month0CashChain`), NOT
  `month0.carLoanPayment` — that does not exist. `vehicleInsurance` is on both.
- Mutation-checked: making both gates ignore evidence fails 6 of the 10.

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

1. **Live-verify part 2 as "nothing changed"** — see START HERE.
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
