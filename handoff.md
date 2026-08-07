# Handoff — 2026-08-06 — session 94 — branch `main` — 4b DESIGNED, NOT YET CODED

> 🚨 **BEFORE YOU DEPLOY ANY EDGE FUNCTION, READ §1 (below the fold).** `main` is currently not
> deployable: seven edge functions read `financial_connections`, and that table does not exist yet.

## ▶ START HERE — session 94 hit the context gate during RESEARCH, before writing any code

**Zero files changed this session.** Tree is clean, nothing to lose. This session picked up
next-step **4b** (goal transfer plans should auto-stop at 100%) from session 93's handoff, did the
full investigation, and produced a complete design below. **Next agent: implement directly from
this design — do not redo the Explore pass, it already found everything.**

### The bug, restated

A `savings_goals` row can link to one or more `recurring_rules` (`rule_type: 'transfer'` or
`'investment'`) via `linked_rule_ids` (array, current) / `linked_rule_id` (legacy single). Once the
goal reaches its target, the linked transfer rule keeps being scheduled and counted **forever** —
in the 5-year Forecast projection, the Dashboard's current-month tile, the Debt Payoff engine's
"available for debt" math, and the Goals page's own contribution display. Nothing currently checks
"has this goal already hit 100%, or will it during this month?"

### Design decision — ALREADY MADE, don't re-litigate

Per the handoff's own framing and `feedback_customer_first_recommendations` (answer from data,
lead with a recommendation, don't hand Tre a menu): **non-destructive.** The forecast/cash-math
layer simply stops *counting* a goal-linked rule once its goal is complete — the `recurring_rules`
row itself is never touched (no `end_date` write, no `active` flip). This mirrors how `end_date`
already works everywhere (computed exclusion in the read path), just computed instead of stored,
and it's reversible the moment Tre raises the goal's target.

### The shared primitive — NEW FILE, not yet created: `src/lib/goal-linkage.ts`

```ts
import { estimateGoalCompletionMonths, getGoalEffectiveApyPercent, type GrowthGoalInput } from './savings-growth';
// + whatever Goal/Rule/Account row types this file settles on (see "types" below)

/**
 * ruleId -> the first month index (0 = the current month, same base as forecast-engine's `i`
 * and useCardProjection's `idx`) at which that rule should STOP contributing, because every
 * goal it funds has already reached its target by then. Absent from the map = never stops
 * (goal never completes within the horizon, or the rule isn't goal-linked) — i.e. current
 * behavior, unchanged.
 *
 * If a rule funds more than one goal (rare — linked_rule_ids is goal->rules, so this is
 * theoretically possible), takes the MAX cutoff across those goals: keep transferring until
 * the LAST goal it feeds is done, never the first.
 */
export function buildGoalTransferCutoffs(goals, rules, accounts, today = new Date()): Map<string, number> {
  // per goal:
  //   ruleIds = (goal.linked_rule_ids ?? []).length ? goal.linked_rule_ids : (goal.linked_rule_id ? [goal.linked_rule_id] : [])
  //   if ruleIds.length === 0: skip, nothing to cut off
  //   linkedRules = ruleIds.map(id => rules.find(r => r.id === id)).filter(Boolean)
  //   linkedAcct = accounts.find(a => a.id === goal.linked_account)
  //   effectiveApyPercent = getGoalEffectiveApyPercent(linkedAcct)
  //   earliestStart = linkedRules.map(r => r.start_date).filter(Boolean).sort()[0] ?? null
  //   contributionStartDate = earliestStart ?? goal.contribution_start_date ?? null
  //   linkedMonthly = sum toMonthly(r.amount, r.frequency) over linkedRules  (local toMonthly copy —
  //     see "duplication note" below, this is the 4th copy and that's OK, matches existing style)
  //   currentAmount = linkedAcct ? Number(linkedAcct.balance) : Number(goal.current_amount)
  //   lumpSums = Array.isArray(goal.lump_sum_payments) ? goal.lump_sum_payments : []  (same guard forecast-engine.ts:1068 uses)
  //   completionIdx = estimateGoalCompletionMonths({ id: goal.id, name: goal.name, currentAmount,
  //     monthlyContribution: linkedMonthly, annualApyPercent: effectiveApyPercent,
  //     contributionStartDate, lumpSums }, Number(goal.target_amount), { today })
  //   if completionIdx == null: this goal never completes in 600mo — no cutoff from it, skip
  //   cutoffIdx = completionIdx === 0 ? 0 : completionIdx + 1
  //     (0 means "already at/above target with zero contributions simulated" — stop immediately,
  //      including month 0. k>0 means month k's contribution was the one that tipped it over, so
  //      months 0..k still count and only k+1 onward is excluded.)
  //   for each ruleId in ruleIds: map.set(ruleId, Math.max(map.get(ruleId) ?? -Infinity, cutoffIdx))
}
```

**Why `estimateGoalCompletionMonths`'s return value is directly comparable to forecast's month
index `i`:** forecast-engine.ts already does exactly this today (see below) for the "goal complete"
*milestone display* — it calls the same function with `today` = the engine's `nowDate` and treats
the result as a projection-row index. This session is extending an established, already-trusted
mapping, not inventing a new one.

**Duplication note:** `toMonthly` is already copied 3× (`Vehicles.tsx:22`, `SavingsGoals.tsx:254`,
`forecast-engine.ts:31`) and the `linked_rule_ids ?? [linked_rule_id]` resolution is already copied
3× (`forecast-engine.ts:1023-1049`, `useCardProjection.ts:1176-1190`, `SavingsGoals.tsx:354-384`).
Don't try to unify those as part of this fix — that's a separate, riskier refactor (touches files
this fix doesn't need to touch) and it's not what Tre asked for. A 4th small local copy in the new
file is consistent with how this codebase already lives with this duplication.

### Where to wire it in — 6 sites, in priority order. Ordering hazard flagged for #1.

Add ONE extra gate line right next to each site's EXISTING `start_date`/`end_date` check — do not
restructure the loops, do not pre-transform the `rules` array (a global "shadow `rules` with capped
end_date" approach was considered and rejected: too many of these files also use `rules` for
non-transfer, UI-editable purposes, and shadowing risks stale-memo bugs across huge files with many
interdependent `useMemo`s). The additive-gate pattern matches this codebase's own idiom exactly
(`if (tr.end_date && ... ) continue;` already reads like this everywhere).

1. **`src/lib/forecast-engine.ts`** — canonical engine, do this one first and get it right.
   - Per-month transfer loop: `transferRulesAll` at **:569**, consumed **:751-819** (`monthTransfers`,
     `perAccountTransferContribs`, `monthBrokerageContrib`/`RetireContrib`/`SavingsTransferContrib`,
     `transferBreakdown`, `activeTransferDestIds`). Existing gates at **:752-753**. Add:
     `const cutoff = ruleCutoffs.get(tr.id); if (cutoff != null && i >= cutoff) continue;` right after.
   - Companion **:889-897** `monthlySavingsContrib`/`savingsGoalItems` (the *unlinked*-goal path —
     goals with no linked rule, just a raw `monthly_contribution`) needs the SAME stop, gated on the
     goal's OWN completion (not a rule's), since it already skips goals whose `linked_account` is a
     transfer destination.
   - 🚨 **Ordering hazard**: `resolvedGoals`/`goalCompletionIdx` (built **:1023-1077**, PASS 3) run
     *after* the PASS-1 transfer loop at :751 that needs the cutoff map. **Hoist a cutoff-map build
     (call `buildGoalTransferCutoffs(goals, rules, accounts, nowDate)`) to right after `nowDate` is
     defined, above :569** — it only needs `goals`, `rules`, `accounts`, `nowDate`, all already in
     scope that early. Do NOT try to reuse/merge with the later `resolvedGoals` block; they compute
     different things (a rule-keyed cutoff map vs. a goal-keyed display-resolution list) even though
     both call `estimateGoalCompletionMonths` — keep them separate to avoid a second refactor
     tangled into this fix.

2. **`src/hooks/useCardProjection.ts`** — MUST stay byte-identical to #1 (Dashboard MONTH-END CASH
   must equal Forecast END CASH to the dollar — this invariant has broken and been re-fixed multiple
   times per project history, treat it as sacred).
   - Per-month: `simTransferRules` **:541**, loop **:594-602** inside `simulationMonthEvents`
     (**:561-660**, `idx` 1..59; idx 0 passes the engine's own event through untouched — no gate
     needed there, #1 already handles idx 0 upstream). Same gate pattern as #1, keyed on `idx`.
   - Month-0-only: `activeTransferDests` + `goalContrib` at **:1168-1191** (inside the
     `monthlySavingsAndCar`-for-month-0 block). This is the closest existing analogue to the new
     helper — it already resolves `linked_rule_ids ?? [linked_rule_id]` locally. Gate on
     `cutoff != null && cutoff <= 0`.
   - Build the SAME cutoff map here (`buildGoalTransferCutoffs(goals, rules, accounts, now)`) — do
     not try to pass it down from forecast-engine.ts, these are separate call trees. Byte-identical
     means "computes the same numbers from the same inputs," not "shares a JS object across files."

3. **`src/components/debt/CreditCardEngine.tsx`** (Debt Payoff page's own mirror sim):
   - Per-month: `simTransferRules` **:644-646**, loop **:648-673** (`extraExpensesByMonth`, `m` 1..59;
     `m===0` short-circuits elsewhere). Same gate, keyed on `m`.
   - Month-0-only: `monthlySavingsAndCar` useMemo **:833-852**. Same `cutoff <= 0` gate.

4. **`src/pages/Dashboard.tsx`** — `monthlySavingsAndCar` useMemo, **:345-380**, month-0/"now" only.
   ⚠️ This one is structurally different: `activeTransferDests` (**:352-358**) here is used ONLY as a
   double-count guard (skip a goal's own `monthly_contribution` if its `linked_account` is already
   funded by a counted transfer rule) — this memo does NOT itself sum the transfer rule dollars, the
   engine does that upstream. So the fix here is really: (a) make sure a completed goal's rule
   dropping out of `activeTransferDests` doesn't accidentally cause `savingsTotal` to double-add the
   goal's raw `monthly_contribution` once the rule stops counting elsewhere — check this carefully
   against #1/#2's behavior once those land, and (b) this file does NOT resolve `linked_rule_ids`
   (uses raw `g.contribution_start_date`/`g.monthly_contribution` only, unlike useCardProjection.ts)
   — decide whether that's already fine (because the rule-side cutoff in #1/#2 is what actually
   removes the dollars) or whether this memo needs its own gate too. **Do this site last, after #1-3
   are live-verified, so you can actually observe whether double-counting or under-counting occurs.**

5. **`src/hooks/useForecastEngineInputs.ts`** — `currentMonthRecommendedDebt` useMemo, **:101-140**,
   byte-for-byte clone of Dashboard's block (`activeTransferDests0` **:108-114**, `savingsTotal`
   **:116-122**). Same caveat as #4, same "do last" advice — whatever you decide for Dashboard.tsx,
   mirror it here exactly, since this feeds the pinned month-0 debt recommendation.

6. **`src/pages/SavingsGoals.tsx`** — `allGoals` useMemo, **:352-386** (`linkedMonthly` **:364**,
   `monthly_contribution` **:378-380**). Lowest risk (pure display, no engine feedback), do this
   EARLY for a fast visible win: once a goal is complete, its card should show
   `monthly_contribution: 0` (or a "Complete" state) instead of the live rule sum. Everything needed
   is already in scope here (`goals`, `rules`, `accountMap`, and the file already imports
   `estimateGoalCompletionMonths`/`getGoalEffectiveApyPercent`/`buildSavingsGrowthData`/
   `goalCompletionMonthLabel` at **:19**).

### Explicitly DEFERRED — do not touch this session, documented trade-off

- **`src/lib/credit-card-engine.ts:2087-2100`** (`buildCurrentMonthRecommendationSummary`'s
  `monthlyExpenses` filter) and **`src/lib/debt-transaction-generator.ts:12-34`**
  (`calcCashOnlyMonthlyExpenses`, called 7× across the 60-month debt-engine loop at **:87, :96, :253,
  :262, :340, :349**) both count transfer/investment rules as cash outflows for the **debt payoff
  convergence engine** — the same engine with ~12 rounds of hard-won convergence fixes documented in
  memory (`project_cycling_debt_engine`). Neither currently has `goals` in scope at all (would need
  threading through `generateDebtPaymentTransactions`/`getDebtPaymentsByMonth`/
  `getDebtBalancesByMonth`'s call chain). **Leaving these unfixed means the debt engine will slightly
  under-recommend debt payments for the period after a goal completes but before this gets fixed** —
  a real but minor and temporary bug, not a data-integrity issue. Fixing it properly means threading
  a `Map<ruleId, monthIdx>` cutoff into a 60-month loop inside the convergence-sensitive engine, which
  risks reopening old golden-test regressions for a small dollar effect. **Recommendation: ship
  sites 1-6 first, live-verify, THEN decide whether the debt-engine sites are worth the risk** —
  don't bundle them into the same commit.
- **`src/pages/Forecast.tsx:302-339`** (retirement projections, filter **:313-322**) — only touches
  `deposit_account ∈ retireIds` (401k/Roth/IRA/HSA), and retirement accounts are excluded from
  goal-linked savings everywhere else in this codebase. Likely a no-op for this feature. Skip unless
  you find a retirement-linked savings goal in Tre's real data that says otherwise.

### UI-only sites — confirmed, do NOT touch

`SavingsGoals.tsx:396-401` and `Vehicles.tsx:900-905` (both just `transferRuleOptions` dropdowns),
`BudgetControl.tsx:551` (a display list, not a summed total — though a "Complete" badge there could
be a nice follow-up), `BudgetControl.tsx:737` (form-field branch, not a rule filter at all),
`useSupabaseData.ts:101-103` (demo seed data).

### Schema note — `src/lib/schemas.ts` is stale, not load-bearing here

`recurringRuleSchema` (**:72-81**) is missing `'investment'` from its `rule_type` enum and missing
`start_date`/`end_date`/`deposit_account` entirely. `savingsGoalSchema` (**:96-104**) is missing
`linked_rule_id(s)`, `contribution_start_date`, `lump_sum_payments`. Neither schema actually gates
this feature (the real types come from `Tables<'...'>` / the hand-written `RuleRow`/`AccountRow` in
`useSupabaseData.ts:32,111,257`) — noted here only so nobody wastes time thinking the schema needs
updating to unblock this work. It doesn't.

### Before writing code: confirm types

`RuleRow` = `Partial<Tables<'recurring_rules'>> & { id, name, amount, rule_type, frequency, active,
start_date, category }` (`useSupabaseData.ts:111-114`). `recurring_rules` DOES have `end_date:
string | null` (`types.ts:992`). `savings_goals` Row has `linked_rule_id: string | null,
linked_rule_ids: string[]` (non-null array), `linked_account`, `current_amount`, `target_amount`,
`monthly_contribution`, `contribution_start_date`, `lump_sum_payments: Json`
(`types.ts:1078-1095`). There is **no back-pointer from a rule to a goal** — the link is only
goal→rules, which is why the cutoff map has to be built goal-first then inverted into a
ruleId-keyed map (see `buildGoalTransferCutoffs` above).

### After implementing

- Write unit tests for `buildGoalTransferCutoffs` FIRST (TDD, per project rules) covering: a goal
  already at/above target (cutoff=0), a goal completing at month k>0 (cutoff=k+1), a goal that never
  completes (absent from map), a rule funding two goals with different completion months (MAX wins),
  legacy `linked_rule_id` fallback, and a goal with no linked rule at all (must not appear in the
  rule-keyed map).
- Run `npx vitest run` in full — pay special attention to
  `src/lib/__tests__/forecast-engine.goldenTierA.test.ts`,
  `forecast-engine.simAgreement.test.ts`, `forecast-convergence.realData.test.ts`, and
  `forecast-convergence.manualISB.test.ts` (the golden/real-data fixtures) since this touches
  `forecast-engine.ts`'s PASS 1. If any golden number shifts, that's expected ONLY if Tre's real
  fixture (`src/lib/__tests__/fixtures/forecast-inputs.real.json`) contains a goal that's already
  complete or completes within the 60-month window — check before re-pinning, don't just accept a
  new number.
- Live-verify on Tre's real account per §9 below (his 4 savings goals: 401K Roth, Brokerage, Savings,
  Roth IRA — **none currently have `goal_type: 'Car Fund'`**, per prior session notes — check whether
  any of them are ALREADY complete or close to it before/after the fix, since that's the only way to
  observe the bug and the fix in his real numbers).
- `npx tsc --noEmit` / `npx eslint` clean, as always.

---

Everything below this line is carried unchanged from session 93 and still applies.

## 0aa. SESSION 93 — both queued items DONE

**A. Web Plaid regression test after `bc16b4fc` — PASSED, no regression.** On `localhost:8080/accounts`,
real account (`demo:false`). Clicking **Link Bank Account** loads the CDN script, creates the token,
and opens `iframe#plaid-link-iframe-1` showing Plaid's consent screen ("Forgenta uses Plaid to connect
your account") with correct Forgenta branding. Closed it via the X → Plaid's "Are you sure?" → **Yes,
exit**: `onExit` ran, the stored link token was cleared, the iframe went `display:none`, the button
returned to idle (not disabled, no spinner), no error toasts, **zero console errors or warnings**, and
the Accounts page stayed intact. No credentials entered, no link completed, nothing written.
⚠️ Two traps for whoever repeats this: the X needs **two clicks** (first lands during the modal's
open animation), and Plaid interposes an exit-confirmation screen — the widget is not closed until
"Yes, exit". Coordinates came from `computer` `zoom`; the Plaid iframe screenshots fine even though
§8.9 says our own React pages do not.

**B. Next-step 4a (unopened card's limit vs utilization) — ROOT-CAUSED AND SHIPPED as `3c71b3c2`.
Live-verified.** The tile read **38.0% ($17,230 / $45,400)**; it now reads **67.8% ($17,230 /
$25,400)** on Tre's real account. **The handoff's open design question dissolved — the answer was
neither `active` nor a new flag.** `accounts.card_start_date` already means "not opened yet", already
gates the simulation (`cardStartMonths`) and the transaction form, and **Tre had already set it on
both cards**: Venture X `2026-12-20`, Apple Card `2028-02-28`. Each was donating a phantom $10,000.
So it was **two** cards, not just the suspected Venture X.
- **`active` would have been actively harmful** and this is worth remembering: it means "exclude from
  ALL calculations", and Venture X carries a live **$300/mo Groceries rule starting 2027-03-03** plus a
  **Bucket Seats** payment plan. Deactivating it silently deletes planned spend from the forecast.
- Fixed at the right layer: `src/lib/card-start-date.ts` gained `isCardOpenAsOf()` +
  `cardStartMonthOffset()` (the engine's own inline month arithmetic, now shared and deduplicated).
  Three read surfaces were wired to it: **Dashboard** utilization (both sides of the ratio, so the
  `$debt / $limit` sub-line stays consistent), **AiAdvisor** (was handing the model $20k of credit that
  does not exist), and the **engine's utilization milestones** (now measure against the limit open in
  each projected month, via new exported `openCreditLimitAtMonth`).
- **436/436 tests green** (+13 new, TDD — both suites proven RED first), `tsc --noEmit` clean,
  `eslint` clean. Backups `backups/2026-08-06_213726/`. **Not pushed — 58 commits ahead.**

## 1. 🚨🚨 DO NOT DEPLOY EDGE FUNCTIONS — `main` IS NOT DEPLOYABLE

*Section rewritten 2026-08-06 by the Akoya session.*

### The hazard, in one paragraph

Commit **`aabdcdbd`** changed **seven edge functions** to read a table named **`financial_connections`**.
**That table does not exist in the database** — `supabase/migrations/20260806_financial_connections.sql`
was written but **deliberately never applied**. So **any `supabase functions deploy` right now breaks
Plaid sync in production.** The affected functions:

```
plaid-sync            plaid-sync-all        plaid-exchange-token    plaid-create-link-token
delete-account        stripe-webhook        revenuecat-webhook
```

**This is coupled in BOTH directions:**
- Deploy without the migration → new code queries a table that doesn't exist.
- Apply the migration without deploying → the currently-live functions break, because the migration
  turns `plaid_items` into a **view that deliberately omits `access_token`**, and the deployed code
  still reads that column.

**The migration and the function deploy must ship TOGETHER, migration first.** In a quiet window.
This matters most for **Plaid Hosted Link** (shipped `bc16b4fc`, still unverified — see the
"4 unverified steps" below), which touches `plaid-create-link-token`.

The migration itself is safe on its own terms: it **renames `plaid_items` in place**, drops nothing,
copies nothing, and live Plaid access tokens stay exactly where they are. A compatibility view keeps
`plaid_items` readable. It also closes a real hole — the old RLS policy was `FOR ALL TO public`, which
let an authenticated user `SELECT` their own `access_token` straight through PostgREST.

### Status: Akoya is BUILT but SHELVED

Tre's decision 2026-08-06: **Akoya requires a $2,000/month minimum.** Not justifiable for a fallback
covering one institution at current scale. **Revisit when subscriber count supports it.** The code is
committed and dormant. `AKOYA_CONNECTOR_FIDELITY` is intentionally unset, so the Fidelity fallback
returns a clean 503 rather than guessing. Reactivating later = two env vars + a redeploy.

`npx tsc --noEmit` IS CLEAN (Akoya types hand-added to `src/integrations/supabase/types.ts`), tree is
clean (Akoya landed as `aabdcdbd`), and `git add -A` is safe again for that reason — but still use
targeted `git add <path>` since a second session may be sharing this tree.

### Two known defects in the shelved Akoya code (fix before Akoya ever goes live, not urgent now)

- `src/config/akoya-institutions.ts` matches `/\bfidelity\b/i`, which also matches unrelated
  community banks (Fidelity Bank, Fidelity Bank and Trust, Fidelity Bank Iowa, Fidelity Bank PA).
  Tighten to `[/^fidelity$/i, /\bfidelity\s+(investments|netbenefits)\b/i]` plus a negative guard.
- Nothing in the UI reads `connection_status === 'reauth_required'` — stored and exposed through
  `useFinancialConnections` but never rendered; a dead connection fails silently.

### Provider specifics are NOT in this repo

Akoya's Data Recipient Hub content is Confidential under §7 of the evaluation license, and **this
repo is public**. Fidelity's token lifetime/limits/connector id live in
`C:\Users\tvonh\Desktop\claudecontext\akoya-provider-notes-PRIVATE.md`. Do not paste Hub specifics
into the repo.

## 2. ⭐ NEXT STEPS (in order) — item 4b is now IN PROGRESS (designed, see top of file)

0. 🚨 **Apply the migration + deploy the edge functions together — see §1.** Needs Tre and a quiet
   window. Migration first, functions immediately after. Verify Plaid sync afterward.
3. **Plaid in-app popup safe-area** — SHIPPED `bc16b4fc`, still **UNVERIFIED**. Before it can be
   trusted, in this order: (1) enable Hosted Link on the Plaid client dashboard, (2) deploy
   `plaid-create-link-token` (modified) + `plaid-hosted-link-result` (new) — bundled with §1's
   migration, (3) test on a real device — sheet insets, redirect to
   `com.treforged.forged://plaid-complete`, dismiss-by-hand doesn't leave the button spinning,
   (4) no automated tests needed (browser-sheet + edge-function glue, no pure logic to isolate).
   `npx vitest run` 423/423, `tsc`/`eslint` clean as of `bc16b4fc`.
4. **Tre's remaining two items from session 86.**
   a. ~~Unopened card's limit shouldn't count toward utilization~~ **DONE `3c71b3c2`.**
   b. **Goal transfer plans should auto-stop at 100%.** **IN PROGRESS — full design at the top of
      this file. Implement sites 1-6 in the order given, defer the debt-engine sites, TDD the new
      `buildGoalTransferCutoffs` helper first.**
5. **§2.9** car-fund earmark (needs Tre).
6. **Card interest** — see the still-deferred design note further down (search "CARD INTEREST").
7. **§1A** Plaid auto-pull + rule matching (blocked by §1).
8. Rest of session 84's list: §2.1/§3.2/§3.4 (may be demo-fixture defects — re-observe first);
   §2.3 leftovers (Debt tab $1,000 copy; Settings exposes no cash-floor control despite Forecast's
   "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation; full real-data walk;
   mobile/Capacitor pass.
9. `forecast-engine.ts` picks `liquidBal` from `forecastFundingAccountId` with no account-type check
   while `useCardProjection.ts` uses `resolveFundingAccountId`. Route the engine through
   `src/lib/funding-account.ts`. Moves real numbers; pair with a live check. Grep the line number.
10. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
    `CreditCardEngine.tsx:1338`+`:1720`, `credit-card-engine.ts:319`+`:455`. Re-grep line numbers.

## 3. ⚠️ CARD INTEREST — STILL DEFERRED, READ BEFORE IMPLEMENTING

Under Option B a card payment splits into interest (expense) + principal (not an expense). Adding
card interest to `expenses` **requires netting it out of debt service in the same commit**:

```
expenses    = living + autoInterest + cardInterest
debtService = autoPrincipal + (totalDebtPayments − cardInterest)   // clamp at 0
```

Hazards: source is `cardProjection.monthlyInterest` (index 0) **plus** `monthlyCyclingInterest`
(cycling cards push 0 into `monthlyInterest`, `credit-card-engine.ts:1261`); mixes an
engine-derived figure into a stream-derived one (can go negative early in a month, clamp + test);
`/transactions`' "of which debt service" sub-line must net it out too or the pages disagree.

## 4. THE RULE THAT DROVE EVERY CONSUMER DECISION (unchanged, still governs)

**Option B changes only what is LABELLED an expense. Every cash-derived number keeps its cash
meaning.** Five consumers deliberately still read `expensesAllIn`/`cashOut`: `month0Snapshot.spentSoFar`,
emergency-runway burn, Cash Flow Overview month 0, PDF export, `/transactions`.

**The residual $510 between /transactions and Dashboard is CORRECT** (two CC-sourced plan
installments the expense model excludes by design). Do not "fix" it.

## 5. DECISIONS STILL NEEDED FROM TRE (carried, none answered)

- Checking-sourced plan installments classify `living`, not `principal` — session 86's judgment
  call, unflagged to him.
- `transfers` is structurally always 0 (`EnrichedTransaction` lacks `rule_type`).
- Insurance anchors on `insurance_start_date ?? payment_start_date` while
  `generateCarLoanTransactions` anchors on `payment_start_date` only. Not reconciled.

## 6. ⚠️ ENVIRONMENT GOTCHAS

1. Chrome safety classifier is up. Browser automation works.
2. **Tre is SIGNED IN on the real account.** Never sign him in or out.
3. Check `/demo/i.test(document.body.innerText.slice(0,600))` on `/dashboard`, NOT `/` (marketing
   copy trips it on the landing page even when signed in).
4. Wait ~13-15s after each nav before reading.
5. Dev server `localhost:8080`.
6. Routes: Budget Control is `/budget`, Debt Payoff is `/debt`. `/debt-payoff` 404s.
7. Read tiles as `document.body.innerText.split('\n').map(s=>s.trim()).filter(Boolean)`, index off
   the label. Output truncates ~95 items — use `.slice(n)` for the tail.
8. Nav via `location.href='/path'` in its own call, not combined with a sleep.
9. Use DOM reads, never screenshots (tab is `visibilityState: hidden`, framer-motion never runs).
10. To fire a click, call the React onClick prop directly — real/synthetic clicks silently fail:
    `const el=[...document.querySelectorAll('*')].find(e=>{const k=Object.keys(e).find(k=>k.startsWith('__reactProps$'));return k&&e[k].onClick&&/LABEL/.test(e.innerText.slice(0,30))&&e.innerText.length<200;});`
    then `el[Object.keys(el).find(k=>k.startsWith('__reactProps$'))].onClick({stopPropagation(){},preventDefault(){}})`.
11. Forecast's `CalcDrawer` is `div.fixed.inset-0`, not a portal — query that, not `[role="dialog"]`.
    Debt Payoff's breakdowns ARE `[role="tooltip"]`.
12. `resize_window` does NOT change the tab's viewport — use a same-origin injected iframe instead.
13. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
14. Vitest suppresses `console.log` — write to a scratch file instead.
15. Don't put a PowerShell here-string in a compound `;`-chained command — use Bash heredoc + `git
    commit -F -`.
16. `/multi-plan`'s external models (codex, gemini) are both unauthenticated. Don't re-probe.

## 7. SUPABASE — his real IDs

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it — 45 profiles.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is `account:<uuid>`-prefixed; account ids are not.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163 (Prime
  Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING).
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07, insurance
  $173.23 from 2026-06-25.
- Car funds: exactly one, `2004 Chevorlet C5`, `phase: 'loan'`. **Savings goals: four** — 401K Roth,
  Brokerage, Savings, Roth IRA — **none `goal_type: 'Car Fund'`**. Check whether any are linked to a
  transfer rule and already complete/near-complete before live-verifying 4b.

## 8. FILES

- Session 93: `3c71b3c2` touched `src/lib/card-start-date.ts`, `src/pages/Dashboard.tsx`,
  `src/components/AiAdvisor.tsx`, `src/lib/forecast-engine.ts` (grep before trusting line numbers).
- Backups: `backups/2026-08-06_213726/`.
- `npx vitest run` **436/436 green**, `tsc --noEmit` clean, `eslint` clean, as of `3c71b3c2`.
- `python -m graphify update .` NOT run — carried debt from session 90.
- **Not pushed. 69 commits ahead** (confirmed via `git status` this session).

## 9. LESSONS WORTH KEEPING

- Session 84: a stale bug report is as misleading as a stale measurement — re-observe, then fix.
- Session 85: before "make surface A match surface B", find out which one is complete.
- Session 86: a plan's predicted number is a measurement too, and it can be stale. Answer a question
  from data before putting it to the user.
- Session 87: a test that fails on first run is doing its job. A relabel touching a shared figure
  must protect the invariant that nothing else moves.
- Session 88: a bridge line is only worth adding if it is defined identically on both sides. Check
  whether anything reads a value at all before "fixing" it.
- Session 89: verifying a $1 fix is what exposed a $172.50 one. Read both sides of an agreement.
- Session 90: prove a new test RED before trusting it. "Add decimals" was a data question, not a
  formatting one. Unrounding is safe exactly where rounding was cosmetic — not where a rounded value
  feeds logic (it's pinned into the engine).
- Session 91: check whether the feature already exists before building it. Measure a layout instead
  of arguing about it. `git status` before every commit, not just at session start — a second live
  session can add files mid-session.
- Session 92: if a fix means styling someone else's node, read their shipped CSS/bundle first —
  three sessions assumed a Capacitor config problem that a `curl` of Plaid's own JS disproved in ten
  minutes. A viewport you can't resize, you can still nest (same-origin iframe).
- Session 93: standing instruction — before asking Tre a product/UX question, first ask "what would
  be best for my customers?" and lead with a recommendation (saved to memory as
  `feedback_customer_first_recommendations`). A single flag (`card_start_date`) already existing and
  already set is easy to miss when you're hunting for a NEW flag to add — check what already exists
  and is already gating other calculations before inventing a new field.
- **Session 94: a feature that "sounds like one flag" can secretly be nine call sites** if the
  codebase runs the same projection through multiple parallel engines that must stay byte-identical
  (Forecast vs. Dashboard vs. Debt Payoff). The fix here is worth doing as ONE additive gate line
  repeated at each existing `start_date`/`end_date` check, not a rewrite of any of those loops —
  matching the existing idiom is what keeps the diff reviewable and the byte-identical invariant
  intact. When a fix's blast radius reaches into the debt-convergence engine specifically, that's a
  signal to split the commit and defer the risky half, not to bundle it for completeness.
