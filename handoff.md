# Handoff — 2026-08-06 — session 87 — branch `main` — invariant test WRITTEN, §2.4 Phase 2 half-shipped

Continues session 86. `site-walk-findings.md` is still the source list; `.claude/plan/dashboard-expense-truth.md`
is the plan. Plan step 5 is now DONE. Steps 8 is done, **9–11 are not**.

## 0. GOAL

Resume-from-handoff session. Did plan step 5 (the never-written invariant test), then plan step 8
(Option B on the Dashboard). Stopped at the 150k CONTEXT GATE mid-Phase-2, having finished the
atomic action in flight and committed it. **Nothing pushed — 42 local commits ahead** (measured).

**Next agent: LIVE-VERIFY Phase 2 in the browser FIRST (see §4.1), then plan steps 9–10.**

## 1. WHAT SHIPPED

### `d5a649a0` — the month-end cash invariant test (plan step 5)

`src/lib/__tests__/monthEndCash.invariant.test.ts`. Runs the exact
`runDebtCashConvergence` call `CardProjectionContext.tsx:230` makes on the golden fixture, then
compares `month0.endCash` (Dashboard tile) against `projections.data[0].endingCash` (Forecast row 0).
Second case pins the sim-side identity `endCash = cashPreDebt − safeToPay + carReserveHeld`.

⚠️ **MEASURED FINDING — the two surfaces are $1 apart on real data, and it is BY DESIGN.**
$3,146 vs $3,145, both whole dollars, so not a cents artifact. Root cause is the documented
tradeoff at **`useCardProjection.ts:1700-1702`**: `m0Chain.cashPreDebt` is the sum of the ROUNDED
terms (so the drawer's on-screen equation is exact in integer arithmetic) while the engine carries
cents and rounds once — $4,600 vs $4,599.20. That comment already priced this as "at most a dollar";
the test now bounds it at ≤ $1 and anything above is a genuine cash-chain divergence (the §1.1
failure mode).

**Decision needed from Tre (do not fix unilaterally):** two tiles can print $1 apart. Closing it
means spending the drawer's exact-integer property, or rounding the engine to match. I left it and
documented it rather than silently changing which property wins.

### `0239c604` — Option B on the Dashboard (plan step 8)

`MONTHLY EXPENSES` = `expenseModel.expenses` (living + interest); new **`DEBT SERVICE`** tile =
`expenseModel.principal + totalDebtPayments`. Grid went `lg:grid-cols-3` → `lg:grid-cols-4`.
Drawer walks categories → expenses → debt service → total cash out.

**It is a RELABEL, not a revaluation.** `expenses + debtService` is exactly the old
`expensesAllIn + totalDebtPayments`, so **cashFlow, savingsRate and Annual Savings do not move by a
cent**. Verified by the internal-consistency test. Expected on real data:

| Surface | Before (Phase 1) | After (Phase 2) |
|---|---|---|
| MONTHLY EXPENSES | $3,912 | **~$3,629** (= 3,912 − 283 auto principal) |
| DEBT SERVICE | (did not exist) | **~$283 + card payments** |
| SAVINGS RATE / ANNUAL SAVINGS / cash flow | — | **unchanged, to the cent** |
| SPENDING BY CATEGORY | `Auto Loan $423` | **`Auto Loan Interest ~$140`** |

`monthly-expense-model.ts` gained **`byCategoryAllIn`**. `byCategory` is now the EXPENSE view
(sums to `expenses`); `byCategoryAllIn` is the CASH view (sums to `expensesAllIn`, adds an
`Auto Loan Principal` row). Each map backs exactly one headline.

## 2. THE RULE THAT DROVE EVERY CONSUMER DECISION

**Option B changes only what is LABELLED an expense. Every cash-derived number keeps its cash
meaning.** Four consumers therefore deliberately still read `expensesAllIn` / `cashOut`, each with
the reason inline in the code — do not "consistency-fix" them to `expenses`:

1. `month0Snapshot` `spentSoFar` — the donut asks what is *gone*, not what was spent.
2. Emergency runway burn — principal still has to be paid when income stops.
3. Cash Flow Overview month 0 — months 1–5 are all-in actuals from `categorizeExpenses`, which
   knows nothing of Option B; an Option B bar would drop for a purely cosmetic reason.
4. PDF export — it has no DEBT SERVICE row, so Option B there would silently drop the principal.

## 3. ⚠️ CARD INTEREST — READ BEFORE IMPLEMENTING IT

Session 86's handoff says card interest "still needs adding to `model.interest`". **It is not a
simple add, and I deliberately did not do it.** Under Option B a card payment splits into interest
(expense) + principal (not an expense). So adding card interest to `expenses` **requires netting it
out of the debt-service side in the same commit**:

```
expenses    = living + autoInterest + cardInterest
debtService = autoPrincipal + (totalDebtPayments − cardInterest)   // clamp at 0
```

Otherwise cash flow double-counts it and Annual Savings moves for a fake reason. Hazards:
- Source is `cardProjection.monthlyInterest` (`Map<cardId, number[]>`, index 0) **plus**
  `monthlyCyclingInterest` — cycling cards push 0 into `monthlyInterest` and track interest
  separately (`credit-card-engine.ts:1261`). Miss that and cycling cards report no interest.
- It mixes an **engine-derived** figure into a **stream-derived** one (`totalDebtPayments` comes
  from `getDebtPaymentsByCard`). Early in a month the stream may hold no card payment at all, so
  the subtraction can go negative. Clamp, and test that case explicitly.

## 4. NEXT STEPS (in order)

1. **LIVE-VERIFY Phase 2 first.** It has NOT been seen in a browser — only tsc/eslint/384 tests.
   Confirm on Tre's real account: MONTHLY EXPENSES $3,912 → ~$3,629, DEBT SERVICE tile appears,
   **SAVINGS RATE and ANNUAL SAVINGS unchanged** (that is the real pass/fail — if they moved, the
   relabel leaked into a revaluation), and SPENDING BY CATEGORY shows `Auto Loan Interest`.
   Re-derive the expected number before reading the screen (session 86's lesson).
2. **Plan steps 9–10, still untouched.** §9 Transactions: keep `EXPENSES $6,243` but relabel
   **`TOTAL CASH OUT`** + an `of which debt service` sub-line; **`NET −$1,523` is correct, do not
   touch it.** §10 BudgetControl `MONTHLY SPEND` → label "planned (from rules)"; numbers unchanged.
   Both files are backed up already (`backups/2026-08-06_024005/`).
3. Card interest — only with §3 above applied.
4. **§2.9** car-fund earmark (needs Tre).
5. **Tre's three items from session 86, still unstarted. Do these BEFORE the Plaid work.**
   Pointers are from reading code; **grep before trusting a line number**; none is root-caused yet.

   a. **Car goal still shows on the Dashboard after the loan is active.** `Dashboard.tsx` `summary`
      derives `carSaved`/`carGoal` from **`carFunds[0]`** with **no phase filter** (I saw it again
      this session at the `summary` memo — still there, I did not touch it), so it also picks the
      wrong fund when there are several. Contrast `getCarFundEarmark`
      (`vehicle-loan-engine.ts:183`), correctly phase-gated to `'saving'`. His RAV4 is
      `phase: 'loan'`, so it reproduces today.

   b. **A not-yet-owned card's limit must not count toward utilization.** ⚠️ **Open design question
      — ask Tre before coding:** does `accounts.active` already mean this, or is a separate
      "planned / not-yet-opened" flag needed? They are different concepts and overloading `active`
      collides with existing `a.active` filters. `accountSummary.ccLimit` already filters on
      `a.active`, so Dashboard and Debt Payoff may already disagree — check both. Suspect
      **Venture X**. Utilization is a headline metric: pair with a live before/after read.

   c. **Goal transfer plans should auto-stop at 100%.** `recurring_rules(rule_type:'transfer')` ↔
      `savings_goals` via `linked_rule_ids`, which is **already known to go stale** (open since
      session 72) — fix the linkage before building on it. Decide explicitly whether "stopped"
      means deactivating the rule row (destructive, needs undo) or the forecast engine simply
      ceasing to schedule it past the completion month (non-destructive, consistent with
      `estimateGoalCompletionMonths`). Must hold in **both** projection and actual transfer, or
      Goals and Forecast disagree — the §2.4/§2.5 failure mode again.

6. **§1A** Plaid auto-pull + rule matching (a matched actual overrides the rule ONLY for its month,
   never re-bases it).
7. Rest of session 84's list: **§2.1 / §3.2 / §3.4** (may be demo-fixture defects — re-observe
   first); §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor control**
   despite Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation;
   full real-data walk; mobile/Capacitor pass.
8. **§4 of session 84 still unfiled** — `forecast-engine.ts` picks `liquidBal` from
   `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
   `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
   numbers; pair with a live check. **Grep the line number.**
9. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
   `CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`.

## 5. STILL OPEN FROM SESSION 86 (unanswered, carry forward)

- **Checking-sourced plan installments classify `living`, not `principal`** — session 86's judgment
  call, NOT Tre's answer. Still unflagged to him. The Carnival Flex Pay $120 is technically
  borrowing but sits inside no balance anywhere, so classifying it `principal` would make $120/mo
  of real cash appear in no figure at all. One line to flip if he disagrees.
- **`transfers` is structurally always 0** — `EnrichedTransaction` does not carry `rule_type`.
  His HYS $400 is absent from the tile while Owners Contribution $50 and a $25 investment ARE
  counted. Pre-existing inconsistency, untouched.
- **Insurance anchors on `insurance_start_date ?? payment_start_date`** while
  `generateCarLoanTransactions:335` anchors on `payment_start_date` only. Same answer for August;
  they differ for a car insured before its first payment. Not reconciled.

## 6. ⚠️ ENVIRONMENT GOTCHAS (unchanged, all still true)

1. **Tre is signed in; you land on his REAL account — read-only there.** Check with
   `/demo/i.test(document.body.innerText.slice(0,600))` (false = real). **Do not sign him out.**
2. **Wait ~11s after each nav** before reading. Mid-settle reads return plausible-but-wrong numbers.
3. **Dev server is on `localhost:8080`**, serves fresh transforms immediately after edits.
4. Read tiles as a **structured array**: `document.body.innerText.split('\n').map(s=>s.trim())
   .filter(Boolean)`, then index off the label. A long `|`-joined string or a `$`-heavy slice trips
   `[BLOCKED: Cookie/query string data]`. Output truncates ~95 items — use `.slice(n)` for the tail.
5. **In-app nav by link text is unreliable** — use `location.href='/transactions'` in its own call.
   Don't put a long sleep in the same call as the navigation.
6. **Use DOM reads, never screenshots** — the tab is `visibilityState: hidden`, so rAF never fires
   and framer-motion never runs; pages look blank in automation screenshots.
7. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
8. **Vitest suppresses `console.log`** — `--silent=false` did not restore it either. To get values
   out of a test, `writeFileSync` them to a scratch file and `cat` it. (Cost me two round-trips.)
9. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
   `git commit -F -` works.
10. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401, `gemini` exit 41.
    Don't re-probe, ~90s each.

## 7. SUPABASE — his real IDs

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. **Always filter by it** — 45 profiles.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is stored **`account:<uuid>`-prefixed**; account ids are not.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163
  (Prime Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING).
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07,
  insurance $173.23 from 2026-06-25. Month-0 split ≈ $140.23 interest / $282.66 principal.

## 8. FILES

- **`d5a649a0`:** `src/lib/__tests__/monthEndCash.invariant.test.ts` (new).
- **`0239c604`:** `src/lib/monthly-expense-model.ts`, its test, `src/pages/Dashboard.tsx`.
- **Backups:** `backups/2026-08-06_024005/` (monthly-expense-model.ts + test, Dashboard.tsx,
  Transactions.tsx, BudgetControl.tsx — the last two pre-emptively, for steps 9–10).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **384/384 green**.
- `python -m graphify update .` **still NOT run** — carried from session 86, do it.
- **Not pushed.**

## 9. LESSONS WORTH KEEPING

- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- Session 85: *before "make surface A match surface B", find out which one is complete.*
- Session 86: *a plan's predicted number is a measurement too, and it can be stale.*
- Session 86: *answer a question from data before putting it to the user.*
- **This session (a): a test that fails on first run is doing its job — diagnose before you loosen
  it.** The invariant failed at $1. The tempting move was to widen the tolerance and move on; the
  right one was to find the terms ($4,600 vs $4,599.20), which turned a "flaky threshold" into a
  documented design tradeoff and a real question for Tre.
- **This session (b): when a relabel touches a shared figure, the invariant to protect is that
  nothing else moves.** Splitting expenses into expenses + debt service was safe *only* because
  their sum was held constant; every consumer was then classified by whether it means SPEND or
  CASH, and the four CASH ones were deliberately left alone. That question — "does this consumer
  mean spend or cash?" — is the one to ask on every remaining Option B surface (steps 9–10).
