# Handoff — 2026-08-06 — session 96 — branch `main` — 4b: sites 1,2,3,6 DONE + committed; 4-5 next

## ▶▶ START HERE — SESSION 96 (supersedes session 95's "START HERE" below)

Committed sites 3 and 6, and **unblocked sites 4-5 by answering the live-data question that was
gating them**. Tree CLEAN, nothing half-finished.

### Commits

- `517fcbd7` **site 3/6 — `src/components/debt/CreditCardEngine.tsx`.** Session 95's line numbers
  were all still accurate. Three gates: the `simTransferRules` loop and the `monthSavings` reduce
  inside `variableSim`'s `extraExpensesByMonth` (both keyed on `m`), plus the month-0
  `savingsTotal` reduce in the separate `monthlySavingsAndCar` useMemo (`ownCutoff <= 0` form,
  own cutoff-map build since it's a different closure). 445/445, tsc + eslint clean.
- `c126f02b` **site 6/6 — `src/pages/SavingsGoals.tsx`.** Uses shared
  `buildGoalOwnCompletionCutoffs` to add a derived `is_complete` to `EnrichedGoal`; completed
  goal cards read "Target reached · contributions no longer counted".
  ⚠️ **Deliberate deviation — do not revert it.** The design said set `monthly_contribution: 0`.
  That is **destructive**: `openEdit` (:412) and `handleDuplicate` (:427) read
  `EnrichedGoal.monthly_contribution` and write it back to `savings_goals` on save, so zeroing it
  turns 4b's read-path exclusion into a DB write. Field keeps its live value; only display
  branches. No new tests — cutoff logic is covered by `goal-linkage.test.ts`, and there is **no
  page-component test harness** in this repo (`src/pages/__tests__` doesn't exist).

### 🔑 Live-data answer that unblocks sites 4-5

Sites 4-5 were deferred until 1-3 were "live-verified so you can observe double-counting."
**That gate is MOOT — live observation cannot discriminate.** Both are month-0-only, and no goal
is near complete today:

| Goal | Balance / target | Funding | Completes? |
|---|---|---|---|
| 401K Roth | $6,348 / $50,000 | **unlinked**, own $236.82/mo | ~month 184 — no |
| Brokerage | $1,452 / $10,000 | `Robinhood Contributions` $25/mo from 2027-07-05 | ~month 342 — no |
| Savings | $106 / $20,000 | `HYS` $500/mo from 2027-08-21 | **~month 52 — YES, in window** |
| Roth IRA | $991 / $7,000 | `Roth IRA` $25/mo from 2026-07-15 | ~month 240 — no |

1. Sites 1-3 ARE observable, but only in the **TAIL**: months ~52-59 of Forecast / Debt Payoff
   should show **~$500/mo more surplus** than before `f605f79a` (HYS stops once Savings hits
   $20,000). **Month-0 tiles must be unchanged — a moved month-0 number is a BUG.**
2. Sites 4-5 are no-ops for Tre's data today; reason from the code, don't wait for an
   observation that cannot happen.

Incidental, NOT fixed (outside 4b, flag to Tre): the **Savings** goal's `linked_rule_ids` holds
two ids but `9f2c0934-5963-4cef-a7ce-9a2476870711` **does not exist in `recurring_rules`** — an
orphaned link. Harmless today (all consumers filter unresolved rules out), worth cleaning up.

### Sites 4-5 — RESOLVED, just implement

`Dashboard.tsx` `monthlySavingsAndCar` (:345-380) and its clone
`useForecastEngineInputs.ts` `currentMonthRecommendedDebt` (:101-140). Re-grep line numbers.

- **(a) Double-add risk? NO — because you must NOT gate `activeTransferDests`.** It's built from
  `rules` with only start/end-date checks; leave it as is. The rule stays in the set, so a linked
  goal's own contribution stays suppressed. Gating that set would BE the bug: the goal falls out
  of the guard and its raw contribution gets added back. **Don't touch `activeTransferDests` /
  `activeTransferDests0`.**
- **(b) Does `savingsTotal` need its own gate? YES.** For an **unlinked** goal (Tre's 401K Roth
  exactly — $236.82/mo, `linked_rule_ids: []`) the engine now stops counting it at completion
  (site 1) while these month-0 memos keep adding it. This memo is the structural twin of
  `CreditCardEngine.tsx`'s `monthlySavingsAndCar`, already gated in `517fcbd7`.

Both sites, one map build + one gate line, identical to `517fcbd7`'s month-0 half:

```ts
import { buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';
// inside the memo, after `now` / `activeTransferDests`:
const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);
// inside the savingsTotal reduce, AFTER the retire/transfer-dest checks:
const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
if (ownCutoff != null && ownCutoff <= 0) return s;
```

Confirm `accounts` is in scope in each memo (it is in Dashboard's; verify the hook) and add to the
dep array if newly referenced. Then `npx tsc --noEmit`, `npx eslint <file>`, `npx vitest run`
(expect **445/445** unchanged). Commit as `(sites 4-5/6)`. Backups exist:
`backups/2026-08-06_222234/`.

### Then, to close out 4b

1. Live-verify per the table: month-0 UNCHANGED, Forecast tail ~52-59 up ~$500/mo (§6 gotchas).
2. Separately, NOT same commit: decide whether the deferred debt-engine sites
   (`credit-card-engine.ts:2087-2100`, `debt-transaction-generator.ts:12-34`) are worth the
   convergence risk.
3. `npx eslint` repo-wide, `python -m graphify update .` (carried debt since session 90).

### State: tree CLEAN, 445/445, tsc + eslint clean. Not pushed — 72 commits ahead.

### Lesson (session 96)

**"Verify against real data before doing the risky site" can itself be a stale instruction — check
whether the real data can even show the difference.** Two sessions deferred 4-5 waiting on an
observation one Supabase query proved impossible. Answer the data question first, then resolve the
design from the code. Also: before making a derived field authoritative for display, grep who
WRITES it back — `SavingsGoals.tsx` would have persisted a display-only zero into the database.

---

# (session 95's handoff follows, unchanged)

# Handoff — 2026-08-06 — session 95 — branch `main` — 4b: sites 1-2 DONE + verified, site 3 next

> 🚨 **BEFORE YOU DEPLOY ANY EDGE FUNCTION, READ §1 (below the fold).** `main` is currently not
> deployable: seven edge functions read `financial_connections`, and that table does not exist yet.
> (Unrelated to this session's work — carried from session 94/Akoya.)

## ▶ START HERE — session 95 implemented sites 1-2 of the 4b design, hit context gate before site 3

**This session did NOT redesign anything** — it implemented directly from session 94's design
(scroll down to "§0 SESSION 94" below for the full original design doc, still authoritative for
sites 3-6). Sites 1 and 2 are done, tested, and live-verified against the full suite. Tree has
UNCOMMITTED changes — see "Files changed" below. **Next agent: commit sites 1-2 first (they're
complete and green), then continue with site 3.**

### What shipped this session (uncommitted, on `main`)

1. **NEW FILE `src/lib/goal-linkage.ts`** — the shared primitive from session 94's design, plus
   one addition not in the original design: a second exported function,
   `buildGoalOwnCompletionCutoffs`, needed because both forecast-engine.ts and
   useCardProjection.ts have an "unlinked goal" code path (a goal with no `linked_rule_ids`,
   summed by its own `monthly_contribution` directly) that ALSO needs a stop-counting gate, and
   that gate has to be keyed by **goal id**, not rule id, since there's no rule to key it by.
   - `buildGoalTransferCutoffs(goals, rules, accounts, today)` → `Map<ruleId, cutoffMonthIdx>`
     (original design, unchanged in shape).
   - `buildGoalOwnCompletionCutoffs(goals, rules, accounts, today)` → `Map<goalId, cutoffMonthIdx>`
     — internally calls the same per-goal `computeGoalCutoffIdx` helper for EVERY goal (not just
     rule-linked ones): if the goal has linked rules it uses their combined monthly amount, else
     falls back to the goal's own `monthly_contribution`/`contribution_start_date`. This means
     `buildGoalOwnCompletionCutoffs` alone gives a goal-keyed cutoff for ALL goals, linked or not
     — useCardProjection.ts's month-0 block (see below) uses ONLY this one function for that
     reason, it didn't need `buildGoalTransferCutoffs` at all there.
   - Both functions are pure re-implementations of the exact resolution logic already used at
     forecast-engine.ts:1023-1049 (`resolvedGoals`) and useCardProjection.ts:1176-1190
     (`goalContrib`) — `linked_rule_ids ?? [linked_rule_id]`, `toMonthly`, earliest-start-date
     resolution — nothing new invented, just centralized per session 94's design note.
   - Cutoff semantics unchanged from design: `completionIdx === 0 → cutoff 0` (stop immediately),
     `completionIdx === k > 0 → cutoff k+1` (months 0..k still count), `completionIdx === null →
     absent from map` (never stops, current behavior).
2. **NEW FILE `src/lib/__tests__/goal-linkage.test.ts`** — 9 tests, TDD (proven RED first: ran
   against the not-yet-created file, got `Cannot find module`). Covers: already-at-target
   (cutoff=0), completes at month k>0, never completes (absent), MAX-wins when one rule funds two
   goals, legacy `linked_rule_id` fallback, no-linked-rule goal absent from the rule-keyed map,
   plus the same three shapes for `buildGoalOwnCompletionCutoffs`. All 9 green.
3. **`src/lib/forecast-engine.ts`** (site 1, canonical engine) — three changes:
   - Import `buildGoalTransferCutoffs, buildGoalOwnCompletionCutoffs` from `@/lib/goal-linkage`.
   - Right after `const nowDate = new Date();` (was line 262, now a few lines later — grep
     `nowDate` to re-find): build `goalTransferCutoffs` and `goalOwnCutoffs`, both called with
     `(goals, rules, accounts, nowDate)`. Comment explains why this is hoisted above the PASS-1
     loop and kept separate from the later `resolvedGoals`/`goalCompletionIdx` block (PASS 3,
     unchanged, still does its own separate thing for the "goal complete" milestone display).
   - Transfer loop (`for (const tr of transferRulesAll)`, was ~line 751): added
     `const goalCutoff = tr.id ? goalTransferCutoffs.get(tr.id) : undefined; if (goalCutoff != null && i >= goalCutoff) continue;`
     right after the existing `start_date`/`end_date` gates, before any other logic in the loop.
   - Unlinked-goal reduce (`monthlySavingsContrib`, was ~line 890): added
     `const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined; if (ownCutoff != null && i >= ownCutoff) return s;`
     right after the existing `retireAccountIds`/`activeTransferDestIds` gates.
4. **`src/hooks/useCardProjection.ts`** (site 2, must stay byte-identical to site 1) — four
   changes:
   - Import added, same as site 1.
   - Right after `const now = new Date();` / `todayStr` (line ~89-90 in `useCardProjection`'s main
     `useMemo`): build the same two cutoff maps, called with `(goals, rules, accounts, now)`.
   - Per-month loop inside `simulationMonthEvents` (`idx` 1..59, was ~line 596-608): the
     `simTransferRules` loop got the same rule-keyed gate (keyed on `idx` instead of `i`); the
     `monthSavings` reduce right below it got the same goal-keyed gate. **This second gate is NOT
     in session 94's original design doc** — the design only mentioned the transfer loop and the
     month-0 block for this file, but `monthSavings` (this per-month, non-month-0 reduce) is the
     exact analogue of forecast-engine's unlinked-goal companion at site 1, and skipping it would
     have broken the byte-identical invariant the moment a goal without a linked rule completes.
     Judgment call, not re-litigated with Tre — flag if it turns out to be wrong.
   - Month-0-only `goalContrib` block (was ~line 1175-1191): added
     `const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined; if (ownCutoff != null && ownCutoff <= 0) return s;`
     right after the existing retire/transfer-dest gates, inside the single reduce that already
     handles BOTH linked and unlinked goals in one pass (unlike forecast-engine, which has two
     separate code paths) — so only one gate line was needed here, not two.

### Verification done this session

- `npx tsc --noEmit` clean after every file's edits (ran 3x, once per file plus once at the end).
- `npx vitest run` — **445/445 green** (436 carried + 9 new from goal-linkage.test.ts). Ran the
  four golden/real-data fixture suites in isolation first
  (`forecast-engine.goldenTierA`, `forecast-engine.simAgreement`, `forecast-convergence.realData`,
  `forecast-convergence.manualISB`) — all passed unchanged, confirming Tre's real fixture has no
  goal that completes within the 60-month window (as session 94 predicted, not re-verified against
  his live Supabase data this session — that's still open, see "Live-verify" below).
- **NOT live-verified against Tre's real account yet.** Session 94's note stands: check whether
  any of his 4 savings goals (401K Roth, Brokerage, Savings, Roth IRA) are already complete or
  close to it, before AND after this fix, since that's the only way to observe the bug/fix in his
  real numbers. Do this after sites 3-6 land, not per-site (per session 94's own advice: "do this
  site last, after #1-3 are live-verified" applies to sites 4-5; sites 1-3 can be verified
  together in one pass since they're the engine-numeric sites).

### NOT done yet — resume here

**Site 3 — `src/components/debt/CreditCardEngine.tsx`.** Two edits, matching the pattern above
exactly. Re-grep line numbers before trusting these (file wasn't edited this session, but other
sessions may have touched it since):
- Add the same import: `import { buildGoalTransferCutoffs, buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';` (this file already imports lots of `@/lib/...` modules around line 14-35, drop it in there).
- **`variableSim` useMemo** (starts ~line 470, its own `const now = new Date();` at ~line 477):
  - `simTransferRules` filter at ~line 644, consumed in the `extraExpensesByMonth` loop at
    ~line 648-685 (`m` 1..59, `m===0` short-circuits to 0 already). Build
    `const goalTransferCutoffs = buildGoalTransferCutoffs(goals, rules, accounts, now);` and
    `const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);` once,
    right after `simTransferRules` is defined (~line 646), then:
    - In the `for (const tr of simTransferRules)` loop (~line 655-661): add the same
      `goalCutoff`/`if (... && m >= goalCutoff) continue;` gate (keyed on `m`), right after the
      existing `start_date`/`end_date` checks.
    - In the `monthSavings` reduce right below it (~line 663-668): add the same `ownCutoff`/
      `if (... && m >= ownCutoff) return s;` gate, after the existing retire/transfer-dest checks.
- **`monthlySavingsAndCar` useMemo** (separate memo, ~line 833-852, its own `const now = new
  Date();` at ~line 838) — month-0-only, mirrors useCardProjection.ts's `goalContrib` block:
  - Build `const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now);`
    once in this memo (it's a SEPARATE memo from `variableSim`, so it needs its own cutoff-map
    build — do not try to share the one from `variableSim`, different closures).
  - In the `savingsTotal` reduce (~line 846-851): add
    `const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined; if (ownCutoff != null && ownCutoff <= 0) return s;`
    after the existing retire/transfer-dest checks.
- After both edits: `npx tsc --noEmit`, then `npx vitest run` (full suite, expect 445/445 still —
  no test targets CreditCardEngine.tsx's internals directly by these exact line numbers, so a
  regression here would most likely show up in the convergence/golden suites if it breaks
  anything shared).

**Then sites 4-6, exactly as session 94 designed them** (full original text preserved below,
unedited) — `Dashboard.tsx`, `useForecastEngineInputs.ts` (do last, after 1-3 are live-verified,
per the design's own caveat about double-counting risk), then `SavingsGoals.tsx` (lowest risk,
can be done any time, good fast visible win).

**Then, per session 94's "After implementing" section** (still fully applicable, unedited below):
live-verify on Tre's real account, check whether any golden numbers shifted for a real reason,
`tsc`/`eslint` clean.

### Files changed this session (uncommitted)

- NEW: `src/lib/goal-linkage.ts`
- NEW: `src/lib/__tests__/goal-linkage.test.ts`
- MODIFIED: `src/lib/forecast-engine.ts` (site 1)
- MODIFIED: `src/hooks/useCardProjection.ts` (site 2)
- Backups: `backups/2026-08-06_222234/` (pre-edit copies of forecast-engine.ts,
  useCardProjection.ts, CreditCardEngine.tsx, Dashboard.tsx, useForecastEngineInputs.ts,
  SavingsGoals.tsx — taken up front for the whole 6-site change, most are still untouched copies).

**Recommend committing sites 1-2 now** (they're complete, tested, tsc-clean) as their own commit
before continuing to site 3, rather than batching all 6 sites into one commit — matches this
project's general preference for reviewable, scoped diffs and gives a rollback point if site 3+
turns up a problem. Commit message suggestion:
`feat(goals): stop counting a goal-linked transfer rule once its goal hits target (sites 1-2/6)`.
Not pushed (never push without being asked).

---

Everything below this line is session 94's original design doc, carried unchanged for sites 3-6.

## 0. SESSION 94 — original design (still authoritative for sites 3-6)

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

### The shared primitive — session 95 built this as `src/lib/goal-linkage.ts` (see above, DONE)

Session 94's original sketch is superseded by the actual shipped implementation described in the
"What shipped this session" section above — read that instead, it reflects what's actually in the
file (including `buildGoalOwnCompletionCutoffs`, which the original sketch below did not
anticipate).

### Where to wire it in — 6 sites, in priority order. Sites 1-2 DONE (session 95). Ordering hazard flagged for #1, already handled.

Add ONE extra gate line right next to each site's EXISTING `start_date`/`end_date` check — do not
restructure the loops, do not pre-transform the `rules` array (a global "shadow `rules` with capped
end_date" approach was considered and rejected: too many of these files also use `rules` for
non-transfer, UI-editable purposes, and shadowing risks stale-memo bugs across huge files with many
interdependent `useMemo`s). The additive-gate pattern matches this codebase's own idiom exactly
(`if (tr.end_date && ... ) continue;` already reads like this everywhere).

1. ~~`src/lib/forecast-engine.ts`~~ **DONE session 95.**
2. ~~`src/hooks/useCardProjection.ts`~~ **DONE session 95.**

3. **`src/components/debt/CreditCardEngine.tsx`** (Debt Payoff page's own mirror sim) — **NEXT,
   see exact instructions in session 95's section above** (line numbers already re-verified this
   session, more precise than the original text below):
   - Per-month: `simTransferRules` **:644**, loop **:648-673** (`extraExpensesByMonth`, `m` 1..59;
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
   Session 95 note: since site 2 (useCardProjection.ts) DOES now gate its own unlinked-goal path,
   the analogous question here is whether Dashboard.tsx's raw (unresolved) `g.monthly_contribution`
   sum also needs a `buildGoalOwnCompletionCutoffs`-based gate — very likely yes, by the same logic,
   but confirm against real behavior before assuming.

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
   `goalCompletionMonthLabel` at **:19**). Session 95 note: `buildGoalTransferCutoffs`/
   `buildGoalOwnCompletionCutoffs` from the now-shipped `src/lib/goal-linkage.ts` should replace
   this file's local re-derivation rather than duplicating it a 4th time — the original session 94
   design said a 4th local copy was fine, but now that the shared primitive exists and is proven,
   prefer importing it here instead of hand-rolling again. Use whichever of the two functions
   matches: probably `buildGoalOwnCompletionCutoffs` keyed by goal id, since this page iterates
   goals directly.

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

### After implementing (all 6 sites)

- ~~Write unit tests for `buildGoalTransferCutoffs` FIRST~~ **DONE session 95** — 9 tests in
  `src/lib/__tests__/goal-linkage.test.ts`, covering both exported functions.
- Run `npx vitest run` in full — pay special attention to
  `src/lib/__tests__/forecast-engine.goldenTierA.test.ts`,
  `forecast-engine.simAgreement.test.ts`, `forecast-convergence.realData.test.ts`, and
  `forecast-convergence.manualISB.test.ts` (the golden/real-data fixtures) since this touches
  `forecast-engine.ts`'s PASS 1. If any golden number shifts, that's expected ONLY if Tre's real
  fixture (`src/lib/__tests__/fixtures/forecast-inputs.real.json`) contains a goal that's already
  complete or completes within the 60-month window — check before re-pinning, don't just accept a
  new number. **Session 95 confirmed these 4 suites unchanged after sites 1-2** — re-run after
  sites 3-6 land too, they touch different files but the same fixture data.
- Live-verify on Tre's real account per §9 below (his 4 savings goals: 401K Roth, Brokerage,
  Savings, Roth IRA — **none currently have `goal_type: 'Car Fund'`**, per prior session notes —
  check whether any of them are ALREADY complete or close to it before/after the fix, since that's
  the only way to observe the bug and the fix in his real numbers). **Not yet done as of session
  95** — do this once sites 3-6 are in.
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

## 2. ⭐ NEXT STEPS (in order) — item 4b: sites 1-2/6 DONE, site 3 next

0. 🚨 **Apply the migration + deploy the edge functions together — see §1.** Needs Tre and a quiet
   window. Migration first, functions immediately after. Verify Plaid sync afterward.
3. **Plaid in-app popup safe-area** — SHIPPED `bc16b4fc`, still **UNVERIFIED**. Before it can be
   trusted, in this order: (1) enable Hosted Link on the Plaid client dashboard, (2) deploy
   `plaid-create-link-token` (modified) + `plaid-hosted-link-result` (new) — bundled with §1's
   migration, (3) test on a real device — sheet insets, redirect to
   `com.treforged.forged://plaid-complete`, dismiss-by-hand doesn't leave the button spinning,
   (4) no automated tests needed (browser-sheet + edge-function glue, no pure logic to isolate).
   `npx vitest run` 445/445 (was 423/423 as of `bc16b4fc`, +22 since from sessions 93-95), `tsc`/
   `eslint` clean as of session 95.
4. **Tre's remaining two items from session 86.**
   a. ~~Unopened card's limit shouldn't count toward utilization~~ **DONE `3c71b3c2`.**
   b. **Goal transfer plans should auto-stop at 100%.** **Sites 1-2/6 DONE this session
      (uncommitted — see top of file), site 3 next, exact instructions above.**
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

- Session 95: uncommitted — `src/lib/goal-linkage.ts` (new), `src/lib/__tests__/goal-linkage.test.ts`
  (new), `src/lib/forecast-engine.ts`, `src/hooks/useCardProjection.ts`. See "Files changed" at top.
- Session 93: `3c71b3c2` touched `src/lib/card-start-date.ts`, `src/pages/Dashboard.tsx`,
  `src/components/AiAdvisor.tsx`, `src/lib/forecast-engine.ts` (grep before trusting line numbers).
- Backups: `backups/2026-08-06_213726/` (session 93), `backups/2026-08-06_222234/` (session 95, all
  6 site files pre-edit).
- `npx vitest run` **445/445 green**, `tsc --noEmit` clean, `eslint` NOT re-run this session (was
  clean as of `3c71b3c2`) — run it before the eventual commit that closes out all 6 sites.
- `python -m graphify update .` NOT run — carried debt from session 90.
- **Not pushed. 70 commits ahead** (confirmed via `git status` at session 95 start, before any
  edits — uncommitted changes on top of that now).

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
- Session 94: a feature that "sounds like one flag" can secretly be nine call sites if the codebase
  runs the same projection through multiple parallel engines that must stay byte-identical (Forecast
  vs. Dashboard vs. Debt Payoff). The fix here is worth doing as ONE additive gate line repeated at
  each existing `start_date`/`end_date` check, not a rewrite of any of those loops. When a fix's
  blast radius reaches into the debt-convergence engine specifically, that's a signal to split the
  commit and defer the risky half, not to bundle it for completeness.
- **Session 95: a design doc's site list can undercount its own sites** — session 94's plan for
  useCardProjection.ts named 2 edit points but a 3rd (the per-month `monthSavings` reduce at
  ~line 603-608, the exact analogue of forecast-engine's "unlinked goal" companion gate) was needed
  to keep the byte-identical invariant intact, and only turned up by reading the code the design
  pointed at rather than trusting the design's site count. When two engines must stay byte-identical
  by construction, grep for every place the sibling engine does the equivalent thing, don't just
  follow a checklist written from one engine's read-through.
