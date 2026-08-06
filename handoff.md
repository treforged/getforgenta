# Handoff — 2026-08-06 — session 86 — branch `main` — §2.4 Phase 1 SHIPPED and live-verified

Continues session 85. `site-walk-findings.md` (repo root) is still the source list; §2.4 there is
now partly stale — Phase 1 is done. `.claude/plan/dashboard-expense-truth.md` is the plan; its
three open questions are ANSWERED (below) and its $4,422 target number is WRONG (see §2).

## 0. GOAL

Tre: "continue from handoff" → "i am logged into the browser" → "do a check with claude in chrome".
Standing constraint: **do not delete his account.** Nothing is pushed — **40 local commits ahead** (measured via
`git rev-list --count origin/main..main`, not estimated).

**Next agent: write the MONTH-END CASH invariant test (plan step 5, skipped), then Phase 2.**

## 1. TRE'S THREE ANSWERS — decided, do not re-litigate

1. **CC-sourced payment plans → EXCLUDE.** Repaying a card charge is principal, not new spend.
2. **Auto-loan interest → SPLIT OUT** (Phase 2 consumes it; the model already computes it).
3. **Hand-made-rule overlap → answered from DATA, not from Tre.** Queried his `recurring_rules`:
   **no** active rule is a car payment or a plan installment, so there is no dedupe hazard on his
   account. The code hazard is still real for other users (dedupe in
   `mergeWithGeneratedTransactions:1193` keys on `date:note:amount` and cannot match a generator
   note) — but Phase 1 sidesteps it entirely by never merging rows into the stream.

## 2. WHAT SHIPPED — `878bc2fd`, live-verified, tests green

New **`src/lib/monthly-expense-model.ts`** + 19 tests. Dashboard aggregates now read it via one
memo; every downstream consumer (`categoryData`, `cashFlowData` month 0, runway burn, the drawer,
the PDF export, the donut's `spentSoFar`) flows through `expenseBreakdown` / `summary.expenses`
and so was rewired for free.

| Surface | Before | After |
|---|---|---|
| MONTHLY EXPENSES / SPENDING BY CATEGORY | $3,196 | **$3,912** |
| MONTH-END CASH | $2,701 | **$2,701 — unchanged, invariant held** |
| AVAILABLE to deploy | $1,820 | $1,820 unchanged |
| AVG MONTHLY SPEND | $705 | $705 unchanged (built from the 5 PAST months only) |
| ANNUAL SAVINGS | −$3,553 | −$12,146 (= (4720 − 3912 − 1820) × 12, arithmetically consistent) |

New category rows: Auto Loan $423, Insurance $227 (54 + 173.23), Travel $265 (145 + 120).

⚠️ **The plan's "~$4,422" target was wrong** and would have been a false failure signal. It assumed
plans contribute $630; with CC-sourced plans excluded per answer 1 they contribute **$120**
(Carnival, from checking). $3,196 + 120 + 423 + 173 = **$3,912**. The test predicted $3,912.12
before the browser did — derivation first, browser second, again.

Also: `CarLoanPaymentInfo` gained `interest` / `principal`, read off the same amortization row
`payment` comes from (principal by subtraction, since `currentRow.principal` includes the lump sum
that `payment` excludes). Purely additive.

## 3. DELIBERATE PHASE-1 SCOPE CALLS (each is a real decision, not an oversight)

1. **Kept the ALL-IN figure** (`expensesAllIn` = living + interest + principal). Phase 1 is a
   completeness fix only; Option B's definition change is Phase 2. Switching the tile is a
   one-line change: `expenseModel.expensesAllIn` → `expenseModel.expenses` in `summary`.
2. **Checking-sourced plan installments classify `living`, not `principal`.** ⚠️ **This is my
   judgment call, NOT Tre's answer — flag it to him.** Reasoning: the Carnival Flex Pay plan is
   technically borrowing, but unlike the CC plans it sits inside no balance anywhere, so
   classifying it `principal` would make $120/mo of real cash leave the account and appear in no
   figure at all — the exact omission this workstream exists to fix. One line to flip if he
   disagrees.
3. **`transfers` is structurally always 0.** `EnrichedTransaction` does not carry the originating
   `rule_type`, so transfers cannot be told from living spend without a reclassification = a
   definition change = Phase 2. Note his HYS $400 is already absent from the tile while Owners
   Contribution $50 and one $25 investment ARE counted — a pre-existing inconsistency, untouched.
4. **Cash Flow Overview month 0 is now all-in while months 1–5 are recorded actuals** that never
   contained plan/car rows. The current bar will read structurally higher than history. Honest but
   visually jumpy; making history complete is its own task.
5. **Insurance anchors on `insurance_start_date ?? payment_start_date`**;
   `generateCarLoanTransactions:335` anchors on `payment_start_date` only. Same answer for August;
   they can differ for a car insured before its first payment. Not reconciled.

## 4. NEXT STEPS (in order)

1. **Plan step 5 was SKIPPED — write it first.** `src/lib/__tests__/monthEndCash.invariant.test.ts`:
   assert Forecast END CASH == Dashboard MONTH-END CASH from shared inputs. It has never existed;
   the invariant survived this change (verified in-browser) but is still untested.
2. **Phase 2 (Option B relabels)** — plan steps 8–11. Dashboard `MONTHLY EXPENSES` →
   `expenseModel.expenses` + a `DEBT SERVICE` row; Transactions `EXPENSES` → `TOTAL CASH OUT` with
   an `of which debt service` sub-line (NET −$1,523 is correct, do not touch); Budget `MONTHLY
   SPEND` → labelled "planned (from rules)". Card interest still needs adding to `model.interest`
   from the projection's month-0 interest term — the field exists and is wired, but only the auto
   loan feeds it today.
3. Then session 84's list, unchanged: **§2.9** car-fund earmark (needs Tre); **§1A** Plaid
   auto-pull + rule matching (his rule: a matched actual overrides the rule ONLY for its month,
   never re-bases it); **§2.1 / §3.2 / §3.4** (may be demo-fixture defects — re-observe first);
   §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor control** despite
   Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double representation; full
   real-data walk; mobile/Capacitor pass.
4. **§4 of session 84 still unfiled** — `forecast-engine.ts` picks `liquidBal` from
   `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
   `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
   numbers; pair with a live check. **Grep the line number, don't trust it.**
5. Month-end overflow pattern still live (display labels, deliberately left): `DebtPayoff.tsx:98`,
   `CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`.

## 5. ⚠️ ENVIRONMENT GOTCHAS (all re-confirmed this session)

1. **Tre is signed in; you land on his REAL account — read-only there.** Check with
   `/demo/i.test(document.body.innerText.slice(0,600))` (false = real). **Do not sign him out.**
2. **Wait ~11s after each nav** before reading. Mid-settle reads return plausible-but-wrong numbers.
3. **Dev server is on `localhost:8080`** and served fresh transforms immediately after edits.
4. Read tiles as a **structured array**: `document.body.innerText.split('\n').map(s=>s.trim())
   .filter(Boolean)`, then index off the label. Returning a long `|`-joined string, or slicing
   around a `$`-heavy region, trips `[BLOCKED: Cookie/query string data]`.
   The output truncates around ~95 items — use `.slice(n)` for the tail.
5. **In-app nav by link text is unreliable** — `[...document.querySelectorAll('a')].find(x=>
   x.textContent.trim()==='Transactions')` matched a filter-dropdown option, not the nav link.
   `location.href='/transactions'` in its own call worked. Don't put a long sleep in the same call
   as the navigation.
6. **Use DOM reads, never screenshots** — the tab is `visibilityState: hidden`, so rAF never fires
   and framer-motion never runs; pages look blank in automation screenshots.
7. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
8. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
   `git commit -F -` works.
9. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401, `gemini` exit 41
   (`GEMINI_API_KEY` unset). It degrades to Claude-only. Don't re-probe, ~90s each.

## 6. SUPABASE — his real IDs (saves a lookup round-trip)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. **Always filter by it** — 45 profiles.
- Column names that bit me: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- `payment_plans.payment_source` is stored **`account:<uuid>`-prefixed**; account ids are not.
  Every caller correctly builds its CC set with `.flatMap(a => [a.id, 'account:'+a.id])` — checked
  all four, no bug there. The new model does the same.
- Aug plans: Car Amazon Starter Pack $347 (Prime Visa, CC), ExtremeOnlineStore Aero Kit $163
  (Prime Visa, CC), Carnival Ultimate $120 (TOTAL CHECKING). Bucket Seats (Dec 2027) and the
  $228 mom payback (Sep) are out of month.
- Auto loan: 2004 Chevrolet C5, $16,530 @ 10.18%, 48mo, payment $422.89 from 2026-08-07,
  insurance $173.23 from 2026-06-25. Month-0 split ≈ $140.23 interest / $282.66 principal.

## 7. FILES

- **`878bc2fd`:** `src/lib/monthly-expense-model.ts` (new), its test (new),
  `src/lib/vehicle-loan-engine.ts`, `src/pages/Dashboard.tsx`.
- **Backups:** `backups/2026-08-06_022422/` (Dashboard.tsx, expense-filtering.ts,
  vehicle-loan-engine.ts).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **381/381 green** (362 + 19).
- `python -m graphify update .` **NOT run this session** — do it.
- **Not pushed.**

## 8. LESSONS WORTH KEEPING

- Session 81: *when two surfaces disagree, line the two derivations up term by term in one table.*
- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- Session 85 (a): *a live check only samples today's calendar* — boundary cases need a test.
- Session 85 (b): *before "make surface A match surface B", find out which one is complete.*
- **This session: a plan's predicted number is a measurement too, and it can be stale.** The plan
  said the tile should land at ~$4,422; the real answer was $3,912 once Tre's own decision was
  applied. Had I trusted the plan's figure as the pass/fail criterion I would have "fixed" a
  correct result. Re-derive the expected value from the decision, then compare.
- **Corollary: answer a question from data before putting it to the user.** Two of the plan's
  three "open questions for Tre" were answerable from his database in one query each; only the two
  genuine value judgments needed him.
