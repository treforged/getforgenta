# Handoff — 2026-08-07 — session 97 — 97.1 + 97.2 DONE + pushed. 97.3 IN PROGRESS (RED test only). 97.4 not started.

> **Next agent: jump to "▶ START HERE" below.** Tre asked to push before starting the transaction-
> sync work (97.4/§1A), so this session stops here to do that. 97.3's pure-logic test file is
> written and proven RED (module doesn't exist), but zero implementation code exists yet.

## ▶ START HERE — session 97 continues 97.3, then 97.4

### What's DONE and pushed this session

**97.1 — `/debt` TOTAL LIMIT tile fixed.** `d48ad37b`. Both the summary tiles
(`totalBalance`/`totalLimit`/`overallUtil`) and the `utilizationMilestones` chips in
`src/components/debt/CreditCardEngine.tsx` now exclude cards not yet open
(`cardStartMonthOffset`/`openCreditLimitAtMonth` from `card-start-date.ts` / `credit-card-engine.ts`,
same rule session 93 used elsewhere). 445/445, tsc + eslint clean. Not live-re-verified in browser
this session (only unit-tested) — worth a quick DOM check next time you're in the app: `/debt`
TOTAL LIMIT should read **$25,400**, matching Dashboard.

**97.2 — orphaned goal→rule link fixed, root cause closed.** `d534e4f2`.
- Data: removed the dangling `9f2c0934-5963-4cef-a7ce-9a2476870711` from Tre's **Savings** goal's
  `linked_rule_ids` via direct SQL (Supabase MCP `execute_sql`, project `mdtosrbfkextcaezuclh`).
  Verified: `Savings` now links only `73a5c998-…` (`HYS`), and both remaining `linked_rule_id`
  scalars on other goals (`Brokerage`→Robinhood Contributions, `Roth IRA`→Roth IRA) resolve cleanly.
- Root cause: `useRecurringRules().remove` in `src/hooks/useSupabaseData.ts` deleted a
  `recurring_rules` row without touching any `savings_goals.linked_rule_ids`/`linked_rule_id` that
  pointed at it (no FK on that array column, unlike `car_funds` which has a real FK). Fixed: the
  `remove` mutation now selects goals for the same user matching either column
  (`.or('linked_rule_id.eq.<id>,linked_rule_ids.cs.{<id>}')`) and scrubs the id from both, then
  invalidates `['savings_goals']` too. 445/445, tsc + eslint clean.

### 97.3 — IN PROGRESS. Design is fully decided (see session 96's handoff text, preserved below
under "§97.3 ORIGINAL SPEC" if this section is ever truncated). Nothing to re-litigate.

**What exists:** `src/lib/__tests__/goal-auto-end.test.ts` — 13 tests, written and run, **proven
RED** (`Cannot find module '../goal-auto-end'`). This is the pure-logic layer only (no DB writes,
no React) covering:
- `projectedAutoEndDate(goal, rules, accounts, today)` — reuses the SAME projection 4b's
  `goal-linkage.ts` uses (`estimateGoalCompletionMonths`/`getGoalEffectiveApyPercent`), NOT a second
  hand-rolled one. Returns the last day of the month whose contribution completes the goal (month
  idx `k` → end of month `today+k`), or the end of the PREVIOUS month if already at target
  (`completionIdx === 0`), or `null` if it never completes in the horizon.
- `planAutoEndWrites({ enabled, goal, previousStamped, rules, accounts, today })` — the
  toggle-on/toggle-off decision logic, returns `{ ruleWrites: {id, end_date}[], stamped: Record<ruleId,
  date>, conflicts: {ruleId, end_date}[] }`:
  - ON: stamps the projected date onto every rule the goal currently links, UNLESS that rule already
    has an end_date NOT in `previousStamped` (a manual date) — those go to `conflicts`, never
    written, never stamped over.
  - ON: if a rule was in `previousStamped` but the goal no longer links it (edited off), OR the
    projection no longer completes (target raised), write `end_date: null` and drop it from
    `stamped` — this is the "clear a stale stamp" path, needed so editing the goal's rule selection
    doesn't leave an orphaned auto-end date on an unlinked rule.
  - ON: if the rule's current end_date already equals the fresh projection, no write is queued
    (idempotent — avoid hammering Supabase on every render's cutoff recompute) but `stamped` still
    carries it.
  - OFF: write `end_date: null` only for ids present in `previousStamped` AND whose current
    `end_date` still equals what we stamped (never touch a date the user changed by hand since);
    `stamped` becomes `{}`.

**What's NOT built yet — this is 100% of what's left, do it next:**
1. **`src/lib/goal-auto-end.ts`** — implement `projectedAutoEndDate` and `planAutoEndWrites` to make
   the 13 tests pass. Read the test file first, it's the spec. Import `estimateGoalCompletionMonths`
   + `getGoalEffectiveApyPercent` from `@/lib/savings-growth` (same as `goal-linkage.ts` does) —
   do NOT duplicate goal-linkage.ts's `computeGoalCutoffIdx`; consider exporting a shared date-math
   helper from `goal-linkage.ts` if the two want to share the "which month tips it over" arithmetic
   (design doc's own suggestion, see spec below). Get all 13 GREEN, `tsc --noEmit` clean.
2. **Migration** — new file, own migration, do NOT touch or bundle
   `supabase/migrations/20260806_financial_connections.sql` (deliberately unapplied, see §1 below —
   unrelated hazard, this column is independent and safe to apply alone):
   ```sql
   alter table savings_goals
     add column auto_end_contributions boolean not null default false;
   ```
   Plus somewhere to persist `previousStamped` (the map of ruleId→date this feature wrote) so a
   toggle-off knows what to clear and a re-render knows what counts as "ours" vs "manual". Options:
   (a) a second jsonb column `auto_end_stamped_rules` on `savings_goals`, or (b) derive it by
   convention (e.g. tag written end_dates some other way). (a) is simplest and matches this
   codebase's existing pattern of jsonb side-columns (`lump_sum_payments`) — recommend it, but this
   wasn't asked of Tre and isn't decided, flag it in the commit message if you pick it unilaterally.
3. **Apply the migration** via Supabase MCP `apply_migration` (project `mdtosrbfkextcaezuclh`) once
   the SQL is finalized. Regenerate/hand-add types in `src/integrations/supabase/types.ts` for
   `savings_goals.auto_end_contributions` (+ the stamped-map column if you go with option (a)) —
   Akoya's types were hand-added before, same pattern if `generate_typescript_types` MCP tool is
   unavailable or slow.
4. **Wiring layer** — call `planAutoEndWrites` and issue the `recurring_rules.end_date` writes on
   explicit save events ONLY (goal save, rule save/edit, balance sync landing) — **never inside a
   `useMemo`/render path**. This is the single biggest implementation hazard per session 96's design
   note; a write in a render path would fire on nearly every input change in this codebase (the
   engines re-run constantly) and hammer Supabase. Most natural hook point: inside
   `SavingsGoals.tsx`'s `handleSave` (`:455-479`), right after the `update.mutate`/`add.mutate` call
   succeeds — call `planAutoEndWrites` and issue rule updates via the existing `useRecurringRules().update`
   mutation for each entry in `ruleWrites`, then persist the new `stamped` map back onto the goal.
5. **UI** — toggle near the linked-rule picker in `SavingsGoals.tsx` (`:674-709`, the "Transfer
   Rules" section inside the form). When `auto_end_contributions` is on and a date is stamped, show
   it on the goal card (near the existing `is_complete` line at `:616-621`) — "Auto-ends contributions
   <Month Year>" or similar, so the write is never invisible. `openEdit` (`:425-438`) and
   `handleDuplicate` (`:440-453`) need the new field round-tripped; a DUPLICATED goal must NOT inherit
   the stamped map (it doesn't own the original's rule links until the user re-picks rules) — reset
   `auto_end_contributions`/stamped map to off/empty on duplicate, this was flagged as a specific trap
   in the original spec.
6. **Tests**: the pure layer (`goal-auto-end.test.ts`) is already written — just make it pass. No
   page-component test harness exists in this repo (confirmed session 96), so the wiring/UI layer is
   verified by tsc + manual/live check, not a new test file.
7. `tsc --noEmit` + `eslint` + `npx vitest run` (expect 458 = 445 + 13) clean before committing.
   Commit 97.3 separately from 97.1/97.2 (already pushed).

### 97.4 — NOT STARTED. Full spec carried below unchanged (pending-transaction gap). Tre said this
session should push before starting it — do 97.3 first (already the plan), then 97.4.

### Push status

**Tre explicitly asked this session, before 97.4/transaction-sync work, to push what's on `main`.**
As of this handoff being written, `d48ad37b` and `d534e4f2` (97.1, 97.2) are the two new commits
since the last push point (session 96 ended "not pushed, 75 commits ahead"). This agent is about to
run `git push` right after committing this handoff. If for any reason the push did NOT happen
(check `git log origin/main..HEAD` — if it's non-empty, it didn't), **do it before anything else**:
`git push`. No force, no branch changes — plain push of `main`, already explicitly authorized by Tre
this session.

### State at handoff: tree has ONE untracked new file (`src/lib/__tests__/goal-auto-end.test.ts`,
RED, not yet committed — will be committed as part of writing this handoff). 445/445 baseline green
(the 13 new tests fail to import, they're not counted yet). tsc/eslint clean on everything committed.

---

## §97.3 ORIGINAL SPEC (session 96, unedited) — authoritative if the summary above is ever stale

**What Tre asked for, verbatim in intent:** a user-facing option on a savings goal saying "stop
contributions once the goal is hit", which then **writes an `end_date` onto the linked Budget
Control rule** so it shows up there like any other end-dated rule.

**DECISION ALREADY MADE — do not re-litigate.** Tre was offered three trigger models and chose:
**stamp the PROJECTED completion date onto the rule immediately when the toggle is turned on**,
and let it be revised as the projection moves. He was told the downside (the app rewrites his
rule's end date whenever balances/APY/contributions shift, and an optimistic projection can stop
a transfer early) and chose it anyway for the visibility. Build that.

Design constraints — these are mine, inside his decision, and they matter:

1. **Recompute on explicit save events only, never on every render.** Rewrite the stamped
   `end_date` when the user saves the goal, saves/edits a linked rule, or a balance sync lands —
   NOT inside a `useMemo` that runs on every projection recalculation. A write in a render path
   in this codebase would fire constantly (the engines re-run on nearly every input change) and
   would hammer Supabase. This is the single biggest implementation hazard in 97.3.
2. **Only ever touch a rule the goal actually owns**, i.e. ids in that goal's `linked_rule_ids`,
   and only when the toggle is ON. Never clear or overwrite an `end_date` the user set by hand —
   if the rule already has an `end_date` that did not come from this feature, leave it alone and
   surface that in the UI rather than silently winning.
3. **Turning the toggle OFF must clear the end_date this feature wrote** (and only that one), or
   the user is left with a stealth end date they can't explain.
4. **Do not remove 4b's computed cutoff.** `goal-linkage.ts` stays exactly as is. 97.3 is a
   persistence/visibility layer on top; 4b is the correctness layer, is live-verified, and must
   keep working for users who never turn the toggle on. The two agree by construction because
   both derive from `estimateGoalCompletionMonths`.

Implementation sketch (session 96's, now partly superseded by the concrete test-driven design
above — the test file is the more precise spec, follow it):

- **Migration:** add `savings_goals.auto_end_contributions boolean not null default false`.
  ⚠️ Write it as its OWN migration file. Do NOT bundle or co-apply it with
  `supabase/migrations/20260806_financial_connections.sql`, which is deliberately unapplied —
  see §1. This column is independent of that hazard and safe to apply alone; the edge-function
  coupling in §1 does not apply to it.
- **Types:** regenerate or hand-add to `src/integrations/supabase/types.ts` (Akoya types were
  hand-added before, same pattern).
- **Projected date:** reuse `estimateGoalCompletionMonths` + `getGoalEffectiveApyPercent` exactly
  as `goal-linkage.ts:computeGoalCutoffIdx` does — same inputs (linked rules' combined monthly
  and earliest start date, linked account balance as current amount, lump sums). Do NOT hand-roll
  a second projection; if you need it in a reusable shape, export a helper from `goal-linkage.ts`
  so 4b and 97.3 can never drift.
- **UI:** the toggle belongs on the goal form in `src/pages/SavingsGoals.tsx` (near the linked-rule
  picker at **:674-709** as of this session — re-grep). The card already shows `is_complete`
  ("Target reached · contributions no longer counted") from session 96 — when the toggle is on and
  an end date is stamped, say so on the card too, naming the date, so the write is never invisible.
- **Tests:** TDD the pure part (projected-date derivation, the "don't clobber a manual end_date"
  rule, toggle-off clearing) in `src/lib/__tests__/`. Prove RED first — session 90's lesson. **DONE
  this session** — see `goal-auto-end.test.ts` above, proven RED.
- ⚠️ **Read `src/pages/SavingsGoals.tsx`'s `openEdit` (:425) / `handleDuplicate` (:440) before
  writing any save code.** They copy `EnrichedGoal` fields straight back into `savings_goals`;
  session 96 hit exactly this trap. Make sure the new flag round-trips and that a DUPLICATED goal
  does not inherit a stamped end date pointing at the original's rule.

---

## §97.4 ORIGINAL SPEC (session 96, unedited) — pending-transaction gap, NOT STARTED

**Symptom, his words:** several pending transactions on checking, **income AND expenses**, and the
projections are off today.

**This is a KNOWN GAP, not a regression — do not go hunting for a new bug.** The grace period he
asked about was decided 2026-08-05 and is live in `src/lib/sync-cutoff.ts`:
`SETTLEMENT_LAG_DAYS = 3` calendar days (his call, calendar over business days deliberately),
applied in `isCapturedInBalance` — **outflows only**. `resolveSyncCutoffDate` gets NO lag, because
`plaid-sync` stores `balances.current`, which for depository accounts does not net out pending
(`available` does), so pending DEBITS sit outside the balance while deposits were assumed to
settle straight into it. That asymmetry was verified live, not assumed: lagging the income side
re-admitted a $1,463 deposit already in the balance and moved Forecast month-0 END CASH
$2,346 → $4,346, inflating cash — the unsafe direction.

**So pending INCOME is the case the model explicitly assumes away**, and that is exactly what he
is hitting. A pending deposit not yet in `current` is treated as already received and never
re-added → understates cash. Mirror image of the $1,463 case.

**DO NOT "fix" this by tuning SETTLEMENT_LAG_DAYS or by adding a lag to the income side.** The
file says it outright: this is a date heuristic standing in for evidence it does not have
(`plaid-sync` pulls balances and liabilities only, no transactions). The correct rule once
transaction sync exists is "captured iff a settled transaction matches it", and the heuristic
should then be **retired, not tuned**. Tuning it trades one wrong direction for the other and
would re-break the live-verified $1,463 case.

**The real fix is §1A (Plaid transaction sync + rule matching), which is blocked behind §1** (the
`financial_connections` migration + seven-edge-function deploy that must ship together in a quiet
window, with Tre). **§1 now gates two things he cares about — Hosted Link verification AND this —
so it has moved up the priority list.** Raise it with him rather than working around it.

Interim option worth OFFERING him (do not implement unilaterally, it changes real numbers): for
Plaid-linked depository accounts, prefer `balances.available` over `balances.current` when
present, since `available` already nets pending. That is a smaller change than §1A and attacks the
root (the wrong balance field) rather than the symptom — but it moves every cash-derived number,
needs the golden/real-data fixtures re-checked, and `available` is null for some institutions, so
it needs a documented fallback. Cheap to prototype, must be live-verified before it ships.

---

## Older backlog (carried unchanged from session 96)

1. **Decide (needs Tre): are the deferred debt-engine sites worth it?**
   `credit-card-engine.ts:2087-2100` and `debt-transaction-generator.ts:12-34` still count a
   completed goal's transfer as a cash outflow inside the **convergence engine**. Effect: the
   debt engine slightly UNDER-recommends payments in the window after a goal completes — for Tre
   that means from **Oct 2030 onward**, ~$500/mo, i.e. real but far out and small. **Recommendation:
   skip for now.** NOT a separate commit — nothing to commit unless Tre says do it.
2. `python -m graphify update .` (carried debt since session 90).
3. §1's migration + edge-function deploy (needs Tre + a quiet window), Plaid Hosted Link device
   verification, §2.9 car-fund earmark.

## 🚨 §1 — DO NOT DEPLOY EDGE FUNCTIONS — `main` IS NOT DEPLOYABLE (unchanged, carried)

Commit `aabdcdbd` changed seven edge functions to read `financial_connections`, which does not
exist in the DB (`supabase/migrations/20260806_financial_connections.sql` deliberately unapplied).
Deploying functions without the migration breaks Plaid sync; applying the migration without
deploying breaks currently-live functions (it turns `plaid_items` into a view without
`access_token`). **Migration and function deploy must ship together, migration first, in a quiet
window with Tre.** Akoya (the Fidelity fallback) is built but shelved — `$2,000/mo` minimum isn't
justified yet, revisit when subscriber count supports it.

## Supabase — his real IDs (unchanged, carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- Savings goals: 401K Roth (unlinked), Brokerage (Robinhood Contributions), Savings (HYS, now
  clean — orphan removed this session), Roth IRA (Roth IRA rule).

## Environment gotchas (unchanged, carried — trimmed to the ones most likely needed next)

1. Tre is SIGNED IN on the real account. Never sign him in or out.
2. Dev server `localhost:8080`. Routes: Budget Control is `/budget`, Debt Payoff is `/debt`.
3. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
4. Don't put a PowerShell here-string in a compound `;`-chained command — use Bash heredoc.
5. Vitest suppresses `console.log` — write to a scratch file instead.

## Lessons worth keeping (session 97 addition)

**A test file IS the spec once it's proven RED — trust it over a prose sketch.** The
`goal-auto-end.test.ts` file above is more precise than the original session-96 prose sketch about
exactly what `planAutoEndWrites` should do on every edge (stale stamp, manual conflict, idempotent
re-stamp, unlinked-rule cleanup) — the next agent should implement against the tests, not
re-derive the design from prose. All prior sessions' lessons (1-96) carried in git history under
`docs: handoff` commits — search `git log --all --oneline | grep handoff` if needed, not repeating
them all here to keep this file a manageable size.
