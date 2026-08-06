# Handoff — 2026-08-06 — session 90 — branch `main` — $172.50 gap FIXED (not yet live-verified)

Continues session 89. `site-walk-findings.md` is still the source list; `.claude/plan/dashboard-expense-truth.md`
is the plan (steps 1–11 all DONE).

## 0. GOAL

**Session 90 (this one):** implemented and unit-proved the §5b fix (the sim dropped month-0 one-time
transactions dated after the sync cutoff, so Dashboard read $172.50 below Forecast) — commit
`361e4d87`. Then Tre asked for decimals on Forecast/Debt Payoff and a mobile bottom tab bar;
Forecast decimals shipped in `9f2e4ced`.

**⚠️ NEITHER COMMIT IS LIVE-VERIFIED.** The Chrome tool's safety classifier was down all session
(`claude-sonnet-5[1m] is temporarily unavailable`), so no browser read happened. That is the single
most important next step — see §1.

**Nothing pushed — 53 local commits ahead.**

## 1. ⭐ START HERE — LIVE-VERIFY `361e4d87`. IT MOVES REAL NUMBERS.

Retry the browser tools; if the classifier is back, read Tre's real account (he must sign himself
back in — **never sign him in or out**).

**Predicted, all four together in one pass** (reading only the tile you changed is what hid the
$172.50 gap for a whole session):

| Surface | Before | Predicted after |
|---|---|---|
| Dashboard MONTH-END CASH | $2,700 | **$2,873** (2,872.74) |
| Forecast Aug 2026 END CASH | $2,873 | **$2,873** (unchanged — the engine was already right) |
| Dashboard SAFE TO PAY | $1,820 | **may rise** — `cashPreDebt` gains $172.50, so `availableForRevolving` rises. Not a bug if it moves; a bug if the two cash figures still disagree. |
| Snapshot drawer chain | ends 4,520.24 | ends **4,692.74**, with a new `One-time transactions +172.50` row |

If Dashboard and Forecast agree to the dollar, the fix is good. If SAFE TO PAY moved, that is
expected and Tre should be told the number changed and why.

## 2. WHAT SHIPPED THIS SESSION

### `361e4d87` — sim counts post-cutoff month-0 one-times (the §5b fix)

`useCardProjection.ts` hard-zeroed `oneTimeArr[0]`, justified as "month-0 one-times are already in
the live balance". **That only holds up to the sync cutoff.** The engine's builder encodes exactly
that distinction (`useForecastEngineInputs.ts`: skip current-month txns dated `<= syncCutoffDate`,
keep the rest), so future-dated money this month reached Forecast but never the Dashboard. On Tre's
data that was a $172.50 income row dated 2026-08-23 to TOTAL CHECKING.

`oneTimeArr[0]` is now built by the same loop as every other month, gated to dates after the cutoff.
**Three downstream `m === 0 ? 0` guards dropped** for the same reason (their engine counterparts all
count month 0): the floor-protection look-ahead's `oneTimeNetByMonth`, and both PASS-3 cash walks
(`mOneTimeNet`, `mOneTimeNet2`).

⚠️ **`credit-card-engine.ts`'s Step 5 term stays month-0-exempt on purpose.** Month-0 debt capacity
is `month0Remaining*`'s job, and `debt-transaction-generator.ts` passes an index 0 containing ALL
month-0 income (pre-cutoff included) — unrounding that guard would double-count for that caller.
But **Step 7 always did advance cash by index 0**, so the doc block now states the asymmetry and
the filtering it demands of callers. Read it before touching either.

**Test:** `monthEndCash.invariant.test.ts` gains a third case that injects a post-cutoff month-0
one-time into BOTH sides the way the app builds them — `transactions` (sim) and `oneTimeByMonth`
(engine). **Verified RED without the fix** (delta 0 vs 172.50). The two pre-existing cases passed at
CENTS while the live app was $172.50 apart, because the golden fixture has no month-0 one-time.

### `9f2e4ced` — exact cents in Forecast's two drawers (Tre's new item, part 1 of 3)

Tre asked for decimals on Forecast + Debt Payoff. **Flipping the formatter alone would have printed
".00" everywhere** — nearly every `ForecastRow` field was `Math.round`'d in the engine, so the
decimals would have been false precision, the opposite of what he asked for. He was shown the
tradeoff and chose **"real cents (engine + UI)"** scoped to **"breakdown drawers only"**.

Engine now carries exact cents on the cash-walk terms, rounding at render only (same shape as
`d1f0c16c`). Unrounded: `startingCash`, `takeHome`, `totalExpenses`, `baseExpenses`,
`savingsContrib`, `carContrib`, `carReserveHeld`, `carLoanPayment`, `vehicle*`, `projectedCarLoan`,
`carLoanExtraPayment`, `mortgagePayment`, `transfersTotal`, `lumpSum*`, `businessContrib`,
`oneTimeNet`, `paycheckIncome`, `otherIncome`, `bonusIncome`, `taxReturnIncome`,
`prePaycheckBillsTotal`.

**Deliberately still rounded — do not "finish the job" without re-reading this:**
- **balance-style fields** (`netWorth`, assets, liabilities, CC balances) are projections, not a
  reconciled cash walk. Cents imply precision the model lacks, and they feed charts + exports.
  The drawer's balance lines therefore also stay whole dollars.
- **`debtPayment` / `plannedDebtPayment` / `revolvingDebtCash`** feed `forecast-convergence.ts`'s
  gap test (`Math.abs(row.debtPayment - …) <= toleranceDollars`). Leaving them rounded keeps this
  change **entirely out of the convergence machinery** — worth preserving given the Q4/Q10 history.
- **`endingCash` / `monthMinSafe`** stay the whole-dollar DISPLAY fields the month table renders.
  The drawers read **`rawEndingCash` / `rawMonthMinSafe`**, which already existed unrounded.

The engine unrounding moved **no test** — the expected result when rounding only ever happened at
the display boundary. That is also why it is safe.

## 3. ⭐ NEXT STEPS (in order)

1. **Live-verify `361e4d87`** — §1 above. Blocked on the Chrome classifier only.
2. **Live-verify `9f2e4ced`** — open a Forecast month row, confirm the walk prints two decimals and
   visibly balances to Ending Cash, and that the month TABLE behind it still shows whole dollars.
3. **Debt Payoff drawer decimals** (part 2 of 3, NOT STARTED). ~31 `formatCurrency(x, false)` sites
   in `src/pages/DebtPayoff.tsx`. **Same trap as Forecast: check the source first.** Several figures
   there are pre-rounded too — `useCardProjection.ts`'s `perCardAdjusted` payments are
   `Math.round`ed, and `formatCurrency(Math.round(bal), false)` appears in the CC balance path. Find
   the drawers/accordions, confirm which values carry cents, unround only the cash-walk ones, and
   leave balances whole. Do not blanket-flip.
4. **Mobile bottom tab bar** (part 3 of 3, NOT STARTED). Tre: *"for mobile sized view make the main
   tabs at the bottom of the screen dashboard, transactions, debt payoff, forecast, then the more
   section."* ⚠️ **Read the mobile-detection memory first**: `use-mobile.tsx` has `useIsTouch`
   (hover:none, gates drag-and-drop) and `useIsViewportBelow` (layout) and they are deliberately
   SEPARATE — a test blocks merging them. This is a **layout** concern, so `useIsViewportBelow`.
   Never read `window.innerWidth` in a render body. Capacitor/native safe-area insets matter here.
5. **NEW (Tre, this session): the mobile Plaid in-app popup ignores device boundaries.** *"on mobile
   the in app popup for plaid is not respecting the device boundries like the rest of the app. the
   close and back button are unusable at the top."* The Plaid Link webview/modal is rendering under
   the status bar / notch, so its own chrome is unreachable — the rest of the app handles this, so
   **find what the rest of the app does and apply it, don't invent a second mechanism** (grep for
   the safe-area / `env(safe-area-inset-*)` handling and the Capacitor `StatusBar` config).
   📸 **Tre sent a screenshot (iOS, 1179×2556) and it pins the diagnosis:** Plaid's own header row —
   back chevron left, PLAID wordmark centre, `X` right — is drawn at **y = 0**, so it collides with
   the iOS status bar. The `X` overlaps the battery indicator and the chevron sits under the clock;
   both are unusable. The content below it (`Fidelity`, `2 associated institutions`) is fine. So the
   **webview/sheet is not inset by `safe-area-inset-top`** — it is not a Plaid-content problem, it
   is how we present the container. This is the **native iOS** surface, so look at the Capacitor
   side first (`StatusBar` overlay config + the Link presentation), not the web modal CSS.
   ⚠️ **Native vs web are different bugs here** — the web Link modal and the Capacitor in-app
   browser have separate containers, and the memory notes an existing minor OAuth tab-switch UX
   issue on mobile Safari. Verify which surface Tre hit before fixing. **Pairs naturally with the
   bottom tab bar (item 4)** — same safe-area concern, so do them together and test insets once.
6. **NEW (Tre, this session): Transactions tab should remember its collapsed/expanded state.**
   *"on transactions tab, save the state the user leaves the tab in, meaning if payment plans was
   collapsed or not."* Persist per-section collapse state across visits. Decide where: localStorage
   (per-device, no migration, consistent with `tre:debt:fundingAccount`) vs profile column
   (cross-device). **localStorage is the recommendation** — it is UI preference, not financial data.
   Tre wants this **before** any further transactions work.
7. **Tre's remaining two items from session 86.** Neither is root-caused; **grep before trusting any
   line number.**
   a. **A not-yet-owned card's limit must not count toward utilization.** ⚠️ **Open design question
      — ask Tre before coding:** does `accounts.active` already mean this, or is a separate
      "planned / not-yet-opened" flag needed? Overloading `active` collides with existing
      `a.active` filters. `accountSummary.ccLimit` already filters on `a.active`, so Dashboard and
      Debt Payoff may already disagree — check both. Suspect **Venture X**. Utilization is a
      headline metric (live: **38.0%, $17,230 / $45,400**) — pair with a live before/after read.
   b. **Goal transfer plans should auto-stop at 100%.** `recurring_rules(rule_type:'transfer')` ↔
      `savings_goals` via `linked_rule_ids`, **already known to go stale** (open since session 72) —
      fix the linkage first. Decide explicitly whether "stopped" means deactivating the rule row
      (destructive, needs undo) or the forecast engine simply ceasing to schedule it past the
      completion month (non-destructive, consistent with `estimateGoalCompletionMonths`). Must hold
      in **both** projection and actual transfer, or Goals and Forecast disagree.
8. **§2.9** car-fund earmark (needs Tre).
9. **Card interest** — only with §4 below applied.
10. **§1A** Plaid auto-pull + rule matching (a matched actual overrides the rule ONLY for its month,
   never re-bases it).
11. Rest of session 84's list: **§2.1 / §3.2 / §3.4** (may be demo-fixture defects — re-observe
    first); §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor control**
    despite Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation;
    full real-data walk; mobile/Capacitor pass.
12. **§4 of session 84 still unfiled** — `forecast-engine.ts` picks `liquidBal` from
    `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
    `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
    numbers; pair with a live check. **Grep the line number.**
13. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
    `CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`.

## 4. ⚠️ CARD INTEREST — STILL DEFERRED, READ BEFORE IMPLEMENTING

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
- /transactions' `of which debt service` sub-line reads the same concept from the stream. If card
  interest becomes an expense, that sub-line must net it out too or the two pages stop agreeing —
  and their agreeing to the dollar is the only reason the line exists.

## 5. THE RULE THAT DROVE EVERY CONSUMER DECISION (unchanged, still governs)

**Option B changes only what is LABELLED an expense. Every cash-derived number keeps its cash
meaning.** Five consumers deliberately still read `expensesAllIn` / `cashOut` — do not
"consistency-fix" them: `month0Snapshot.spentSoFar` (donut asks what is *gone*), emergency-runway
burn (principal is still owed when income stops), Cash Flow Overview month 0 (months 1–5 are all-in
actuals), PDF export (no DEBT SERVICE row, so Option B would silently drop principal), and
/transactions (it means **CASH**, so its headline kept its value).

**The residual $510 between /transactions and Dashboard is CORRECT** — the two CC-sourced plan
installments (Car Amazon Starter Pack $347 + ExtremeOnlineStore Aero Kit $163) that the expense
model excludes by design, since they already sit inside the Prime Visa balance. Do **not** "fix" it.

## 6. DECISIONS STILL NEEDED FROM TRE (carried, none answered)

- **Checking-sourced plan installments classify `living`, not `principal`** — session 86's judgment
  call, not Tre's answer, still unflagged to him. The Carnival Flex Pay $120 is technically
  borrowing but sits inside no balance anywhere, so classifying it `principal` would make $120/mo
  of real cash appear in no figure at all. One line to flip if he disagrees.
- **`transfers` is structurally always 0** — `EnrichedTransaction` does not carry `rule_type`. His
  HYS $400 is absent from the tile while Owners Contribution $50 and a $25 investment ARE counted.
- **Insurance anchors on `insurance_start_date ?? payment_start_date`** while
  `generateCarLoanTransactions` anchors on `payment_start_date` only. Same answer for August; they
  differ for a car insured before its first payment. Not reconciled.

## 7. ⚠️ ENVIRONMENT GOTCHAS

1. **The Chrome tool's safety classifier was DOWN this whole session** —
   `claude-sonnet-5[1m] is temporarily unavailable, so auto mode cannot determine the safety of …`.
   Retry it first thing; nothing browser-based worked. File reads/searches were unaffected.
2. **Tre's session had EXPIRED and the app was on `/auth`.** He must sign himself back in —
   **never sign him in, and never sign him out.** `Try Demo` needs no password and is the fallback
   for verifying anything not tied to his real numbers.
3. Check which account you are on with `/demo/i.test(document.body.innerText.slice(0,600))`
   (false = real). **On the landing page `/` this returns TRUE even when signed in** — the marketing
   copy contains the word. Navigate to `/dashboard` before trusting it.
4. **Wait ~11–13s after each nav** before reading. Mid-settle reads return plausible-but-wrong numbers.
5. **Dev server is on `localhost:8080`**, serves fresh transforms immediately after edits.
6. **Budget Control's route is `/budget`, NOT `/budget-control`** (that 404s).
7. Read tiles as a **structured array**: `document.body.innerText.split('\n').map(s=>s.trim())
   .filter(Boolean)`, then index off the label. A long `|`-joined string or a `$`-heavy slice trips
   `[BLOCKED: Cookie/query string data]`. Output truncates ~95 items — use `.slice(n)` for the tail.
8. **In-app nav by link text is unreliable** — use `location.href='/transactions'` in its own call.
   Don't put a long sleep in the same call as the navigation.
9. **Use DOM reads, never screenshots** — the tab is `visibilityState: hidden`, so rAF never fires
   and framer-motion never runs; pages look blank in automation screenshots.
10. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
11. **Vitest suppresses `console.log`** — `--silent=false` does not restore it. To get values out of
    a test, `writeFileSync` to a scratch file and `cat` it.
12. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
    `git commit -F -` works.
13. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401, `gemini` exit 41.
    Don't re-probe, ~90s each.

## 8. SUPABASE — his real IDs

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. **Always filter by it** — 45 profiles.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is stored **`account:<uuid>`-prefixed**; account ids are not.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163
  (Prime Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING).
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07,
  insurance $173.23 from 2026-06-25. Month-0 split ≈ $140.23 interest / $282.66 principal.
- **Car funds: exactly one**, `2004 Chevorlet C5`, `phase: 'loan'`. **Savings goals: four**, none
  with `goal_type: 'Car Fund'` (401K Roth, Brokerage, Savings, Roth IRA).
- The two Aug one-time rows behind the §5b bug: `2026-08-23 income $172.50` "GF half of cruise
  excursions" → TOTAL CHECKING (`933cbc10…`), and `2026-08-18 expense $145.00` "Cruise Exursions" →
  a CREDIT CARD (`34c9574b…`, so CC-sourced and correctly excluded from the cash one-time).

## 9. FILES

- **`361e4d87`:** `src/hooks/useCardProjection.ts`, `src/lib/credit-card-engine.ts` (doc block only),
  `src/lib/__tests__/monthEndCash.invariant.test.ts`. Backup `backups/2026-08-06_120000/`.
- **`9f2e4ced`:** `src/lib/forecast-engine.ts`, `src/pages/Forecast.tsx`.
  Backup `backups/2026-08-06_121500/` (also holds an untouched `DebtPayoff.tsx` for step 3).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **397/397 green** (was 396; +1 for
  the month-0 one-time case).
- **`python -m graphify update .` NOT run this session — carried debt.**
- **Not pushed. 53 commits ahead.**

## 10. LESSONS WORTH KEEPING

- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- Session 85: *before "make surface A match surface B", find out which one is complete.*
- Session 86: *a plan's predicted number is a measurement too, and it can be stale.*
- Session 86: *answer a question from data before putting it to the user.*
- Session 87 (a): *a test that fails on first run is doing its job — diagnose before you loosen it.*
- Session 87 (b): *when a relabel touches a shared figure, the invariant to protect is that nothing
  else moves.*
- Session 88: *a bridge line is only worth adding if it is defined identically on both sides.*
- Session 88: *when a fix touches a value, check whether anything reads it at all* —
  `summary.carSaved`/`carGoal` had the same bug and zero consumers; deleting beat fixing.
- Session 89: *verifying a $1 fix is what exposed a $172.50 one.* Read both sides of an agreement,
  every time — and stash-and-re-read before blaming your own diff.
- Session 89: *a passing invariant test is only as good as its fixture.*
- **Session 90 (a): prove the new test RED before trusting it.** Stashing the fix and re-running
  showed delta `0` vs `172.50` — that one step is what separates "a test that pins the bug" from
  "a test that happens to pass". It cost one command.
- **Session 90 (b): "add decimals" was a data question, not a formatting one.** The obvious change
  (flip `showCents`) would have printed `.00` on every Forecast figure, because the engine had
  already rounded them — more digits, zero more accuracy, and it would have looked done. Checking
  where the number is BORN before changing how it is PRINTED is what turned a 2-minute cosmetic
  edit into the right fix.
- **Session 90 (c): unrounding is safe exactly where rounding was only ever cosmetic.** The engine
  change moved no test — which is the evidence that those `Math.round`s were display concerns
  living in the wrong layer. Where a rounded value feeds LOGIC (convergence's gap test) it was
  left alone deliberately, and that boundary is the whole reason the change was low-risk.
