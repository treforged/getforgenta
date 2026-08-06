# Handoff — 2026-08-06 — session 88 — branch `main` — §2.4 Phase 2 COMPLETE + live-verified

Continues session 87. `site-walk-findings.md` is still the source list; `.claude/plan/dashboard-expense-truth.md`
is the plan. **Plan steps 1–11 are now all DONE.** The §2.4 plan is finished except the deliberately
deferred card-interest work (§3 below).

## 0. GOAL

Resume-from-handoff session. Live-verified Phase 2 (step 8, shipped blind last session), then did
plan steps 9–10, then Tre's item 5a. **Nothing pushed — 48 local commits ahead.**

## 1. WHAT SHIPPED

### Live verification of `0239c604` (step 8) — PASSED, no action needed

Read on Tre's real account. All four checks passed; the relabel did **not** leak into a revaluation.

| Surface | Predicted | Measured |
|---|---|---|
| MONTHLY EXPENSES | ~$3,629 | **$3,630** "spending only" |
| DEBT SERVICE (new) | ~$283 + card pmts | **$2,103** = 282.66 + 1,820 |
| SAVINGS RATE / ANNUAL SAVINGS | unchanged | **−21.4% / −$12,146** = 12 × −$1,012 |
| SPENDING BY CATEGORY | `Auto Loan Interest ~$140` | **`Auto Loan Interest $140`**, total $3,630 |

$1,820 is exactly SAFE TO PAY, which is the cross-check that the debt-service term is the same
figure the engine recommends.

### `1daf2fd6` — Transactions + Budget labels (plan steps 9–10)

**/transactions:** `EXPENSES` → **`TOTAL CASH OUT`**, value unchanged ($6,243), plus an
`of which $X debt service` sub-line. `NET −$1,523` untouched.

**/budget:** `MONTHLY SPEND` gains sub-label **"planned (from rules)"**; drawer retitled
"Monthly Spend Breakdown (planned)". No number moves.

⚠️ **The non-obvious part.** For the sub-line to bridge anything it must define debt service
*exactly* as the Dashboard tile does — card payments in full **plus the PRINCIPAL half only** of a
car-loan payment. A stream row carries only the combined cash amount, so the split now travels with
the row: `generateCarLoanTransactions` sets **`principalPortion`** (new optional field on
`EnrichedTransaction`, `pay-schedule.ts`). Two traps handled:
- `row.principal` from the amortization schedule **includes the lump sum** (it is `payment −
  interest`, and `payment` is regular + lumpSum). The regular row must subtract it or it
  double-counts. A test pins this.
- Negative amortization makes `row.principal` negative; clamped at 0.
- A row **without** `principalPortion` contributes **nothing**, not its full amount — under-report
  a bridge line rather than misstate it.

**Live-verified:** `TOTAL CASH OUT $6,243` / `of which $2,103 debt service` / `NET −$1,523`, and
$2,103 equals the Dashboard tile **to the dollar**. MONTHLY SPEND $2,976 unchanged.

**The residual $510 between the two pages is CORRECT and expected** — $6,243 − $2,103 = $4,140 vs
the Dashboard's $3,630. The gap is the two **CC-sourced plan installments** (Car Amazon Starter Pack
$347 + ExtremeOnlineStore Aero Kit $163 = $510) that the expense model excludes by design, since
they already sit inside the Prime Visa balance. Do **not** "fix" this.

### `b79708d7` — Car Goal only for a saving-phase fund (Tre's item 5a)

`carGoalData` read `carFunds[0]` with no phase filter. Selection now goes through new
**`getSavingPhaseCarFund`** (`vehicle-loan-engine.ts`), phase-gated to `'saving'` exactly as
`getCarFundEarmark` is. Also **deleted `summary.carSaved` / `summary.carGoal`** — nothing read
them and they carried the identical defect (`carFunds` left that memo's dep array with them).

✅ **LIVE-CONFIRMED on Tre's real account** (he signed back in at the end of the session): the
`CAR GOAL` tile is **absent**, and MONTHLY EXPENSES $3,630 / DEBT SERVICE $2,103 / MONTH-END CASH
$2,701 are all unchanged by the removal. He has exactly one car fund (`2004 Chevorlet C5`,
`phase: 'loan'`) and no `goal_type: 'Car Fund'` goal, so absent is correct. Demo mode still shows
`CAR GOAL: 2024 HONDA CIVIC` (its saving-phase fund), so the positive path is intact. **Item 5a is
CLOSED.**

## 2. THE RULE THAT DROVE EVERY CONSUMER DECISION (unchanged, still governs)

**Option B changes only what is LABELLED an expense. Every cash-derived number keeps its cash
meaning.** Four consumers deliberately still read `expensesAllIn` / `cashOut` — do not
"consistency-fix" them: `month0Snapshot.spentSoFar` (donut asks what is *gone*), emergency-runway
burn (principal is still owed when income stops), Cash Flow Overview month 0 (months 1–5 are all-in
actuals), PDF export (no DEBT SERVICE row, so Option B would silently drop principal).

/transactions joined that list this session: it means **CASH**, so its headline kept its value.

## 3. ⚠️ CARD INTEREST — STILL DEFERRED, READ BEFORE IMPLEMENTING

Under Option B a card payment splits into interest (expense) + principal (not an expense). Adding
card interest to `expenses` **requires netting it out of debt service in the same commit**:

```
expenses    = living + autoInterest + cardInterest
debtService = autoPrincipal + (totalDebtPayments − cardInterest)   // clamp at 0
```

Otherwise cash flow double-counts and Annual Savings moves for a fake reason. Hazards:
- Source is `cardProjection.monthlyInterest` (`Map<cardId, number[]>`, index 0) **plus**
  `monthlyCyclingInterest` — cycling cards push 0 into `monthlyInterest` and track interest
  separately (`credit-card-engine.ts:1261`). Miss that and cycling cards report no interest.
- Mixes an **engine-derived** figure into a **stream-derived** one. Early in a month the stream may
  hold no card payment at all, so the subtraction can go negative. Clamp, and test that case.
- **New this session:** /transactions' `of which debt service` sub-line reads the same concept from
  the stream. If card interest becomes an expense, that sub-line must net it out too or the two
  pages stop agreeing — and their agreeing to the dollar is the only reason the line exists.

## 4. NEXT STEPS (in order)

1. **⭐ START HERE — close the $1 gap with ENGINE PRECISION. Tre decided this 2026-08-06, at the
   very end of session 88; nothing is implemented.** See §5 for the full spec. This is the next
   piece of work and it is scoped and unambiguous — it was handed off rather than started only
   because the session hit the context gate.
2. **Tre's remaining two items from session 86.** Neither is root-caused; **grep before trusting
   any line number.**

   a. **A not-yet-owned card's limit must not count toward utilization.** ⚠️ **Open design question
      — ask Tre before coding:** does `accounts.active` already mean this, or is a separate
      "planned / not-yet-opened" flag needed? Different concepts; overloading `active` collides
      with existing `a.active` filters. `accountSummary.ccLimit` already filters on `a.active`, so
      Dashboard and Debt Payoff may already disagree — check both. Suspect **Venture X**.
      Utilization is a headline metric (live now: **38.0%, $17,230 / $45,400**) — pair with a live
      before/after read.
   b. **Goal transfer plans should auto-stop at 100%.** `recurring_rules(rule_type:'transfer')` ↔
      `savings_goals` via `linked_rule_ids`, **already known to go stale** (open since session 72)
      — fix the linkage before building on it. Decide explicitly whether "stopped" means
      deactivating the rule row (destructive, needs undo) or the forecast engine simply ceasing to
      schedule it past the completion month (non-destructive, consistent with
      `estimateGoalCompletionMonths`). Must hold in **both** projection and actual transfer, or
      Goals and Forecast disagree — the §2.4/§2.5 failure mode again.
3. **§2.9** car-fund earmark (needs Tre).
4. Card interest — only with §3 above applied.
5. **§1A** Plaid auto-pull + rule matching (a matched actual overrides the rule ONLY for its month,
   never re-bases it).
6. Rest of session 84's list: **§2.1 / §3.2 / §3.4** (may be demo-fixture defects — re-observe
   first); §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor control**
   despite Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation;
   full real-data walk; mobile/Capacitor pass.
7. **§4 of session 84 still unfiled** — `forecast-engine.ts` picks `liquidBal` from
   `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
   `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
   numbers; pair with a live check. **Grep the line number.**
8. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
   `CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`.

## 5. ⭐ THE $1 GAP — TRE DECIDED: **ENGINE PRECISION**. SPEC, NOT YET IMPLEMENTED.

**His words (2026-08-06): "for the $1 difference lets do engine precision. calculations should use
the full exact values with the decimals."**

So the drawer's exact-integer property is the one being spent, deliberately. `Month0CashChain`
must carry **exact cents** and rounding happens **only at render**.

### What is actually wrong today

`useCardProjection.ts` (~line 1694 raw chain, ~1703-1722 `m0Chain`): each term is `Math.round`ed
individually and `chain.cashPreDebt` is **the sum of those rounded terms**, not a rounding of the
raw `cashPreDebt` used for the cap. On real data that is $4,600 vs $4,599.20, which is why
Dashboard MONTH-END CASH prints $3,146 and Forecast END CASH prints $3,145.

### The change

1. `m0Chain` keeps every term **unrounded** (drop the `Math.round` calls), and computes
   `cashPreDebt` from the exact terms — ideally by reusing the raw `cashPreDebt` variable already
   computed at ~1694 so there is exactly ONE definition, not two expressions that can drift.
2. `src/lib/debt-model-types.ts` — the `Month0CashChain` doc block (~lines 55-65) **states the
   rounded-sum contract as a guarantee**. Rewrite it; do not leave it describing the old behavior.
3. `src/lib/month0-budget-snapshot.ts:88` (`projectedRemaining = c.cashPreDebt`) and whatever
   renders the MONTHLY BUDGET SNAPSHOT drawer — round **at display only**.
4. `src/lib/__tests__/month0-budget-snapshot.test.ts:25` has a helper whose comment and values
   mirror "cashPreDebt is the sum of the rounded terms". Update it to exact-cents.
5. `src/lib/__tests__/monthEndCash.invariant.test.ts` — **tighten the tolerance from ≤ $1 to
   cents** (e.g. ≤ $0.01). That tightening is the real proof the fix worked; if it will not pass at
   cents, the gap was never only rounding and you have found something else. Do not loosen it back.

### Expect this, and warn him if it appears

The drawer's on-screen column may now **visually fail to add up by $1** (rounded terms summing to a
separately-rounded total). That is the accepted cost of his decision, not a bug — but if it shows
up on his real numbers it is worth telling him it is now visible, since that is exactly the
property he traded away. Mitigation if he objects: render one or two decimals in the drawer.

### Verify

`npx vitest run` (394 today), `tsc`, `eslint`, then a **live read** confirming Dashboard MONTH-END
CASH **equals** Forecast END CASH — that equality is the whole point. Both were $3,146/$3,145 in
session 87; today's Dashboard reads **$2,701**, so re-derive rather than expecting the old numbers.

## 5b. DECISIONS STILL NEEDED FROM TRE (carried, none answered)

- **Checking-sourced plan installments classify `living`, not `principal`** — session 86's judgment
  call, not Tre's answer, still unflagged to him. The Carnival Flex Pay $120 is technically
  borrowing but sits inside no balance anywhere, so classifying it `principal` would make $120/mo
  of real cash appear in no figure at all. One line to flip if he disagrees.
- **`transfers` is structurally always 0** — `EnrichedTransaction` does not carry `rule_type`.
  His HYS $400 is absent from the tile while Owners Contribution $50 and a $25 investment ARE
  counted. Pre-existing inconsistency, untouched.
- **Insurance anchors on `insurance_start_date ?? payment_start_date`** while
  `generateCarLoanTransactions` anchors on `payment_start_date` only. Same answer for August; they
  differ for a car insured before its first payment. Not reconciled.

## 6. ⚠️ ENVIRONMENT GOTCHAS

1. **Tre's session EXPIRED mid-session and the app is now on `/auth`.** He must sign himself back
   in — **never sign him in, and never sign him out.** `Try Demo` needs no password and is the
   fallback for verifying anything not tied to his real numbers.
2. Check which account you are on with `/demo/i.test(document.body.innerText.slice(0,600))`
   (false = real). **On the landing page `/` this returns TRUE even when signed in** — the marketing
   copy contains the word. Navigate to `/dashboard` before trusting it.
3. **Wait ~11–13s after each nav** before reading. Mid-settle reads return plausible-but-wrong numbers.
4. **Dev server is on `localhost:8080`**, serves fresh transforms immediately after edits.
5. **Budget Control's route is `/budget`, NOT `/budget-control`** (that 404s). Cost me a round-trip.
6. Read tiles as a **structured array**: `document.body.innerText.split('\n').map(s=>s.trim())
   .filter(Boolean)`, then index off the label — `findIndex` on the label and slice around it is
   cheaper than dumping. A long `|`-joined string or a `$`-heavy slice trips
   `[BLOCKED: Cookie/query string data]`. Output truncates ~95 items — use `.slice(n)` for the tail.
7. **In-app nav by link text is unreliable** — use `location.href='/transactions'` in its own call.
   Don't put a long sleep in the same call as the navigation.
8. **Use DOM reads, never screenshots** — the tab is `visibilityState: hidden`, so rAF never fires
   and framer-motion never runs; pages look blank in automation screenshots.
9. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
10. **Vitest suppresses `console.log`** — `--silent=false` does not restore it. To get values out of
    a test, `writeFileSync` to a scratch file and `cat` it.
11. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
    `git commit -F -` works.
12. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401, `gemini` exit 41.
    Don't re-probe, ~90s each.

## 7. SUPABASE — his real IDs

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. **Always filter by it** — 45 profiles.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is stored **`account:<uuid>`-prefixed**; account ids are not.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163
  (Prime Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING).
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07,
  insurance $173.23 from 2026-06-25. Month-0 split ≈ $140.23 interest / $282.66 principal.
- **Car funds: exactly one**, `2004 Chevorlet C5`, `phase: 'loan'`. **Savings goals: four**, none
  with `goal_type: 'Car Fund'` (401K Roth, Brokerage, Savings, Roth IRA).

## 8. FILES

- **`1daf2fd6`:** `src/lib/pay-schedule.ts` (+`principalPortion`), `src/lib/vehicle-loan-engine.ts`,
  `src/pages/Transactions.tsx`, `src/pages/BudgetControl.tsx`, and its test.
- **`b79708d7`:** `src/lib/vehicle-loan-engine.ts` (+`getSavingPhaseCarFund`),
  `src/pages/Dashboard.tsx`, `src/lib/__tests__/vehicle-loan-engine.savingPhaseFund.test.ts` (new).
- **Backups:** `backups/2026-08-06_093203/` (pay-schedule, vehicle-loan-engine, Transactions,
  BudgetControl), `backups/2026-08-06_094500/` (Dashboard.tsx).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **394/394 green** (was 384; +5 for
  the principal split, +5 for the phase gate).
- `python -m graphify update .` **run this session** (15,734 nodes) — carried debt cleared.
- **Not pushed. 48 commits ahead.**

## 9. LESSONS WORTH KEEPING

- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- Session 85: *before "make surface A match surface B", find out which one is complete.*
- Session 86: *a plan's predicted number is a measurement too, and it can be stale.*
- Session 86: *answer a question from data before putting it to the user.*
- Session 87 (a): *a test that fails on first run is doing its job — diagnose before you loosen it.*
- Session 87 (b): *when a relabel touches a shared figure, the invariant to protect is that nothing
  else moves.*
- **This session (a): a bridge line is only worth adding if it is defined identically on both
  sides.** "of which debt service" was nearly implemented as card payments + the *whole* auto
  payment, which reads fine in isolation but would have printed $2,243 next to a Dashboard tile
  saying $2,103 — two adjacent surfaces contradicting each other under the same word. Making them
  agree cost a new field on the row; that cost is the point of the feature, not overhead.
- **This session (b): when a fix touches a value, check whether anything reads it at all.**
  `summary.carSaved`/`carGoal` had the same bug as the visible tile and zero consumers. Deleting
  beat fixing — a "fixed" dead field is just a slower trap.
- **This session (c): a failing assertion is not automatically a failing implementation.** The
  lump-sum test failed at `977.66 < 500`; the code was right and my assertion was meaningless.
  Re-derive what the invariant actually *is* before touching either side.
