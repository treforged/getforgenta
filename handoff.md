# Handoff — 2026-08-06 — session 85 — branch `main` — §2.5 closed, §2.4 root-caused and planned

Continues session 84. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.** §2.4 and §2.5 there were rewritten this session.

## 0. GOAL

Tre: "continue from handoff, but also verify 2.4" → then chose the expense definition (Option B)
→ then "run /multi-plan on it". Standing constraint: **do not delete his account.** Nothing is
pushed — **36 local commits ahead** after this session's one commit.

**The next agent's job is to execute `.claude/plan/dashboard-expense-truth.md`, Phase 1 only,
after Tre answers its three open questions.**

## 1. WHAT THIS SESSION DID

### `86c07d73` — §2.5 goal-completion month label. Committed, tests green.

Session 84 asked for a live verification of `b80b381d`. I could not use the demo (Tre is signed in;
the landing redirects, so "See Demo" never fires — **and I did not sign him out**). Verified by
derivation instead, which turned out stronger: `toGrowthGoal` (`SavingsGoals.tsx:261`) and
`forecast-engine.ts:1060` build the same `GrowthGoalInput` and call the same
`estimateGoalCompletionMonths`, so they cannot disagree on the month **index**.

They could still disagree on the month **name**. Goals labelled with
`date.setMonth(getMonth() + months)`, which overflows when today's day-of-month is absent from the
target month; the engine builds rows `new Date(y, m + i, 1)`. From Aug **31**, +6 → Goals
`Mar 2027`, engine `Feb 2027`. Verified in node. Both now go through **`goalCompletionMonthLabel`**
(`savings-growth.ts`). Display-only. `getGoalEffectiveApyPercent` pinned (was untested) + label
agreement locked. **362/362 green, tsc + eslint clean.**

⚠️ **A live read on Aug 5 would have passed while that bug was present.** Generalize: a live check
only samples today's calendar; month-end and boundary cases need a test, not a browser.

**Same overflow pattern still live, deliberately left (scope):** `DebtPayoff.tsx:98`,
`CreditCardEngine.tsx:1338` + `:1720`, `credit-card-engine.ts:319` + `:455`. All display labels.

### §2.4 — re-verified on REAL data, root-caused, planned. NO CODE WRITTEN.

Reproduces, and it is **four** definitions, not three (income disagrees too). Full table is now in
`site-walk-findings.md` §2.4. Live figures, Tre's account, Aug 2026:

| Surface | Reads |
|---|---|
| Dashboard | INCOME $4,720 · EXPENSES $3,196 · SAVINGS RATE −6.3% (−$296/mo) · AVG SPEND $705 |
| Transactions | INCOME $4,720 · EXPENSES $6,243 · NET −$1,523 |
| Budget | INCOME $4,548 · SPEND $2,976 |

**The $1,226 gap is a real bug, not a definition difference.** Transactions builds its stream as
base + debt + reconciliations + **plans + car loans** (`Transactions.tsx:157-164`); Dashboard builds
base + debt only (`Dashboard.tsx:410`). Dashboard *computes* `carLoanTxns`/`planTxns` (`:492-493`)
but routes them only to the upcoming-bills widget. Decomposes exactly: **plans $630** (Car 347 +
Shopping 163 + Travel 120) + **vehicle $596** (Auto Loan 423 + insurance 173) = **$1,226**.

**Tre's decision, made this session: Option B — debt principal is NOT an expense, interest IS.**
Reasoning he accepted: his card is a payment method, so counting both the $1,061 of card purchases
and the $1,820 card payment double-counts; principal paydown is net-worth-neutral. **Don't
re-litigate.** Open sub-questions are in the plan file.

⚠️ **I gave him a wrong number mid-session and corrected it — do not reintroduce it.** I said his
true cash flow was "+$1,524/mo"; that was computed before finding the missing $1,226. Correct
figures: **real cash flow −$1,523/mo** (Transactions' NET is the only complete surface and is
right), of which **$2,873 is debt service** (cards 1,820 + auto 423 + plans 630), so net-worth-wise
he is ahead roughly **+$1,350/mo minus interest**.

## 2. THE PLAN — `.claude/plan/dashboard-expense-truth.md` (read it in full)

Two findings there reversed the assumptions this was started on:

1. **MONTH-END CASH is NOT at risk.** `monthEndCash = cardProjection?.month0?.endCash ??
   txMergeMonthEndCash` (`Dashboard.tsx:599`); the primary path mirrors `forecast-engine.ts` PASS-3
   and **never reads the transaction stream**. `planCashThisMonth` feeds only the fallback (users
   with zero credit cards). **The comment at `Dashboard.tsx:522-525` is stale** — it claims plan
   cash feeds surplus/available-to-deploy; those consumers are gone. Engine-derived numbers are
   already correct; only stream aggregates are wrong.
2. **The real hazard is that the generators over-emit** — do NOT merge them raw:
   - `generatePaymentPlanTransactions` (`payment-plan-generator.ts:223`) only filters `!active` —
     includes **CC-sourced plans** and **already-settled** installments.
   - `generateCarLoanTransactions` (`vehicle-loan-engine.ts:262`) has no `phase` filter — emits for
     **saving-phase (unpurchased) vehicles** and **historical paid installments**.
   - Derive instead from `getMonthlyPlanCashExpenses` + **`getActiveCarLoanPayments`**
     (`vehicle-loan-engine.ts:192`), which already filter all of the above.
   - Dedupe in `mergeWithGeneratedTransactions:1193` keys on `date:note:amount` and will **not**
     catch a user's hand-made car-payment rule. Real duplication vector.
3. **No test coverage exists to break or lean on.** No `src/pages/__tests__` directory at all.
   Nothing tests `summary`, `expenseBreakdown`, `categoryData`, `txMergeMonthEndCash`. **There is
   no test asserting Forecast END CASH == Dashboard MONTH-END CASH** — that invariant has only ever
   been hand-checked in a browser. The plan adds it before anything near it moves.

## 3. NEXT STEPS (in order)

1. **Get Tre's answers to the plan's three open questions** (CC-sourced plans excluded? any real
   car/plan spend entered as a recurring rule? split auto-loan interest?). Do not code past them.
2. **Execute Phase 1** of the plan — new `src/lib/monthly-expense-model.ts` + tests first, then
   rewire Dashboard aggregates, add the invariant test, live-check that MONTH-END CASH is
   **unchanged** while MONTHLY EXPENSES rises to ~$4,422. Commit Phase 1 alone.
3. **Phase 2 (Option B relabels)** only after Phase 1 is live-verified.
4. Then resume session 84's list, unchanged: **§2.9** car-fund earmark (needs Tre); **§1A** Plaid
   auto-pull + rule matching (needs `/multi-plan`; his rule: a matched actual overrides the rule
   ONLY for its month, never re-bases it); **§2.1 / §3.2 / §3.4** (may be demo-fixture defects —
   re-observe first); §2.3 leftovers (Debt tab `$1,000` copy; **Settings exposes no cash-floor
   control** despite Forecast's "your floor setting" copy — raise with Tre); §2.7 RAV4 double
   representation; full real-data walk; mobile/Capacitor pass.
5. **§4 of session 84 is still unfiled and unfixed** — `forecast-engine.ts` picks `liquidBal` from
   `forecastFundingAccountId` with no account-type check while `useCardProjection.ts` uses
   `resolveFundingAccountId`. Route the engine through `src/lib/funding-account.ts`. Moves real
   numbers; pair with a live check. **Grep the line number, don't trust it.**

## 4. ⚠️ ENVIRONMENT GOTCHAS (carried forward; all still accurate)

1. **Tre is signed in, so the landing redirects to /dashboard and "See Demo" never fires.** You
   land on his **real account — read-only there**. Check with
   `/demo/i.test(document.body.innerText.slice(0,600))` (false = real). **Do not sign him out to
   reach the demo.** Real data is also the only way to exercise branches the demo persona misses.
2. **Wait ~10–11s after each in-app nav click** before reading. Mid-settle reads return
   plausible-but-wrong numbers.
3. In-app nav that preserves state:
   `[...document.querySelectorAll('a')].find(x=>x.textContent.trim()==='Transactions').click()`.
4. **Reading the whole month's transactions as structured rows** (worked perfectly this session):
   split `body.innerText` on `\n`, then match each line against
   `/^(\d{4}-\d{2}-\d{2}) · (.+?) · (.+)$/` — name is the line before, amount the line after.
   His August is 35 rows, no pagination.
5. `javascript_tool` returning a long `|`-joined string, or `innerText.slice()` around a `$`-heavy
   region, gets `[BLOCKED: Cookie/query string data]`. **Return a structured array instead.**
6. Don't put a long sleep in the same `javascript_tool` call as a `location.href` navigation.
7. The Dashboard calc-drawer click recipe from session 84 **did not open the drawer** for me. The
   `SPENDING BY CATEGORY` widget text is a better source and needs no click.
8. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
9. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
   `git commit -F -` works.
10. Dev server on **8080 with `--strictPort`**, serving fresh transforms as of this session.
11. **`/multi-plan`'s external models are both unauthenticated** — `codex` 401 (not logged in),
    `gemini` exit 41 (`GEMINI_API_KEY` unset in `~/.claude/.env`). It degrades to Claude-only.
    Confirmed again this session; don't re-probe, it costs ~90s each.
12. Landing looks blank in automation screenshots (tab is `visibilityState: hidden`, so rAF never
    fires and framer-motion never runs). **Use DOM reads, never screenshots, to judge this app.**

## 5. CARRIED FORWARD, UNRESOLVED (sessions 72–84)

1. **GA4 health UNKNOWN.** Retest with DNT off; confirm `VITE_GA_MEASUREMENT_ID` in Vercel prod.
2. **🔴 Session replay has no consent gate — needs Tre's decision, not code.** `src/main.tsx:7`
   calls `initMonitoring()` unconditionally; `monitoring.ts` starts LD replay with
   `networkRecording:{enabled:true}` honoring no consent/GPC/DNT, while `initGA()` honors all three.
   `AuthContext.tsx:205` sends his **email** to it. `cookie-consent.ts:10,39` describes analytics as
   "Vercel Speed Insights", installed but never imported — don't silently delete the package, that
   makes the disclosure *more* wrong.
3. **4 dead deps, unapproved:** `cmdk`, `embla-carousel-react`, `input-otp`,
   `react-resizable-panels` (dropping `cmdk` also drops `@radix-ui/react-dialog`).
4. Stale `linked_rule_ids` on goals; the Sep–Dec 2026 + Jan 2027 interest band. Untouched.
5. `vendor-motion` (123 kB) is the next first-paint win but needs a source change to
   `Landing.tsx:3`. **Tre chose config-only in session 71 — re-offer only if he raises page speed.**
6. Net Worth History will step-change where old snapshot rows meet the newer liability rules.
7. `getCurrentMonthDebtRecommendations` has zero callers, `@deprecated`, not deleted.
   `getMonthlyDebtBreakdown` is **still live** — deliberately left alone.
8. Dead Dashboard memos found this session, not removed (out of scope, but real):
   `generatedTransactions:319`, `remainingIncome:305`, `remainingPaychecks:306`,
   `monthlyNetIncome:308`, `monthlySavingsAndCar:343-378`, `minSafeCash:544-547`.

## 6. FILES

- **`86c07d73`:** `src/pages/SavingsGoals.tsx`, `src/lib/savings-growth.ts`,
  `src/__tests__/savings-growth.test.ts`, `site-walk-findings.md`.
- **This commit:** `.claude/plan/dashboard-expense-truth.md` (new), `handoff.md`.
- **Backups:** `backups/2026-08-05_192410/` (SavingsGoals.tsx, savings-growth.ts, its test).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **362/362 green** (358 + 4 new).
- `python -m graphify update .` **run** this session (15,665 nodes).
- **Not pushed.**

## 7. LESSONS WORTH KEEPING

- Session 79: *a UI showing a total it did not derive hides whatever it failed to model.*
- Session 81: *when two surfaces disagree, line the two derivations up term by term in one table.*
- Session 82: *a shared helper is only safe if every caller is asking the same question.*
- Session 83: *when a live check reports a regression, check the measurement before the code.*
- Session 84: *a stale bug report is as misleading as a stale measurement — re-observe, then fix.*
- **This session (a): a live check only samples today's calendar.** The Goals/Forecast month labels
  agreed on Aug 5 and disagreed on Aug 31. Browser verification cannot see a boundary case; that is
  what the test is for. Prefer verifying by lining up derivations over reading a screen.
- **This session (b): before "make surface A match surface B", find out which one is complete.**
  The instinct was to reconcile definitions. The actual defect was that one stream silently omitted
  $1,226/mo of real obligations. Reconciling first would have propagated the omission into a
  fix that looked principled.
- **Corollary to session 84's:** when two surfaces disagree, the one that re-derives is usually
  wrong — but check *coverage* before *arithmetic*. Here both arithmetics were fine.
