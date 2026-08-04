# Handoff — 2026-08-04 — session 74 — branch `main` — fixing the site-walk findings

Session 73 walked the whole site and wrote `site-walk-findings.md` (repo root, now committed).
This session started fixing. **Read `site-walk-findings.md` in full before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." Explicit constraint from session 73:
**do not delete his account.**

## 1. DONE THIS SESSION (2 commits, both local, NOT pushed)

### ✅ `014d5a10` — Tre's reported bug, root-caused and fixed
His report: "the debt payment on the transactions tab for my discover card does not match the
payment that was on 8/1" (Discover: $3,382 recommended vs −$4,005 in the ledger).

**Root cause was NOT stale/persisted snapshots** (session 73's hypothesis) and **not Plaid.**
Nothing is persisted. `src/pages/Transactions.tsx` ran its **own** 1-month `simulateVariablePayoff`
with different inputs from the canonical projection every other surface reads:
- raw `profile.cash_floor` instead of the augmented floor
- hardcoded `'avalanche'` (ignores `tre:debt:strategy`)
- funding-account balance, no overrides / vehicle / goal / plan / convergence inputs

Dashboard, Debt Payoff, Forecast, and the PDF export all read
`cardProjection.month0.perCardAdjusted`. Transactions now does too, via
`useCardProjectionContext()` + the existing shared `createDebtPaymentTransactions` helper.
Minimum-payment cards matched all along because a min payment is invariant to the surplus — that
is why the bug looked card-specific. Deleted ~80 lines of duplicated sim.

### ✅ `617fe749` — ordinal suffixes (findings §4.1)
New `src/lib/ordinal.ts` (`ordinal` / `ordinalSuffix`, 11–13 exception) + a test covering all 31
days. Replaced **six** call sites (findings said five; `CreditCardEngine.tsx:1517` was a sixth):
DebtRecommendationsWidget, CreditCardEngine ×4, Accounts subtitle, Forecast obligations list.
Kills the live `Due 1th` on Tre's Discover card and `Due 22th` / `due 2th` elsewhere.

Also **retracted findings §3.6** in `site-walk-findings.md` (payment-plan counter was NOT off by
one — the card shows installments *paid*, the transaction shows *which* installment).

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on every touched file,
`npm test` **273/273 green** (65 files) after both commits.

## 2. 🔴 IN PROGRESS — net worth omits loans (findings §1.3). Investigation done, NO code written.

Dashboard `NET WORTH −$4,428` = assets − credit cards only. Tre's `2004 Chevorlet C5` 29-month
auto loan (~$12k, `-$423`/mo in the ledger) is absent. Demo is worse: reports $11,900 vs −$22,600.

**Three separate net-worth definitions are live — this is the same duplicate-source disease as §1:**

| # | Where | Liabilities counted |
|---|---|---|
| A | `src/lib/net-worth-snapshot.ts:69-70` `aggregateNetWorth` (drives the **snapshot history chart**) | **only `credit_card`** — so an `auto_loan` / `student_loan` account is counted as an **ASSET** |
| B | `src/pages/Dashboard.tsx:489` `accountSummary` (drives the **NET WORTH tile** + `useWidgetSync`) | cc + student_loan + auto_loan + other_liability, **accounts only, no manual rows** |
| C | `src/pages/Dashboard.tsx:509` `liveLiabilitiesForBreakdown` (drives the **breakdown list**) | B + `mortgage` + merged `manualLiabilities` |

So the breakdown list (C) shows liabilities that the tile above it (B) never subtracts, and the
history chart (A) treats loan accounts as assets. Accounts.tsx has its own copy of B too — check it.

**Unambiguous fixes** (do these): one shared rollup, used by tile + breakdown + snapshot, with the
full liability type set and manual rows included.
⚠️ Memory `project_net_worth_snapshots` warns not to simplify to Accounts' live-only totals, and
`net-worth-snapshot.ts`'s header says its math is a verbatim port — **adding** loan types and
manual rows is a correction, but it WILL step-change the recorded history. Say so in the commit.

**AMBIGUOUS — ask Tre, do not guess:** Tre's Chevy loan lives in `car_funds` (fields `loan_amount`,
`loan_term_months`, `loan_start_date`, `actual_monthly_payment`, `phase`), **not** in `accounts` or
`liabilities`. There is no stored outstanding balance — it would have to be amortized from
loan_amount/APR/start date. Question: should an active `car_funds` loan appear as a liability in
net worth (amortized remaining balance), or does he track it manually in `liabilities`?

## 3. NEXT STEPS (in order)

1. Finish §2 above: unambiguous rollup unification first; ask Tre the `car_funds` question.
2. Findings §4 in the old handoff — "UPCOMING THIS WEEK" understates ~25× ($65 shown vs $1,669
   actual: omits debt payments, auto-loan payments, insurance). Dashboard.
3. **Same root cause as §1, still unfixed:** `getMonthlyDebtBreakdown` is a *second* legacy debt
   engine still driving `Dashboard.tsx:457-478` (its internal ledger → month-end cash, savings
   rate), `BudgetControl.tsx:544`, and `SavingsGoals.tsx:375`. Only the *widget* was migrated to
   `perCardAdjusted`. Migrating these three is likely the real fix for findings §2.2 (Budget's
   "matches Debt tab Safe to Pay" invariant) and part of §2.4. **It will move displayed numbers on
   Dashboard/Budget — flag that to Tre before doing it.**
4. Findings §2.6 / §2.4 / §2.3 (budget snapshot rows don't sum; three expense definitions; five
   cash-floor values) need a **product decision from Tre** — which definition is canonical. The
   CLAUDE.md AMBIGUITY RULE applies. Ask, don't pick.
5. Finish the real-data walk: **Budget, Debt, Forecast, Goals, Vehicles, Settings never visited
   while signed in.** Re-verify findings §1.1 (Dashboard +$1,655 vs Forecast −$3,300) on real data.
6. Mobile/Capacitor viewport pass — not started.

## 4. CARRIED FORWARD, UNRESOLVED (from sessions 72–73)

1. **GA4 health UNKNOWN.** Session 27's "LaunchDarkly breaks GA4" is probably a DNT=1 artifact.
   Retest with Do-Not-Track OFF; confirm `VITE_GA_MEASUREMENT_ID` is set in Vercel prod.
2. **🔴 Session replay has no consent gate — needs Tre's decision, not code.** `src/main.tsx:7`
   calls `initMonitoring()` unconditionally; `src/lib/monitoring.ts` starts LD observability +
   replay with `networkRecording:{enabled:true}`, honoring no consent / GPC / DNT, while `initGA()`
   honors all three. `AuthContext.tsx:205` sends his **email** to it. `src/lib/cookie-consent.ts:10,39`
   describes analytics as "Vercel Speed Insights" — installed but never imported. Do not silently
   delete `@vercel/speed-insights`; that makes the disclosure *more* wrong.
3. **4 dead deps, Tre hasn't approved removal:** `cmdk`, `embla-carousel-react`, `input-otp`,
   `react-resizable-panels` (dropping `cmdk` also drops `@radix-ui/react-dialog`).
4. Stale `linked_rule_ids` on goals; the Sep–Dec 2026 + Jan 2027 interest band. Untouched.
5. `vendor-motion` (123 kB) is the next first-paint win but needs a source change to
   `src/pages/Landing.tsx:3`. **Tre chose config-only in session 71 — re-offer only if he raises
   page speed.**

## 5. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion
never runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 6. FILES

- **Committed this session:** `src/pages/Transactions.tsx`, `src/lib/ordinal.ts` (new),
  `src/lib/__tests__/ordinal.test.ts` (new), `src/components/dashboard/DebtRecommendationsWidget.tsx`,
  `src/components/debt/CreditCardEngine.tsx`, `src/pages/Accounts.tsx`, `src/pages/Forecast.tsx`,
  `site-walk-findings.md`.
- **Backups:** `backups/2026-08-04_165658/` (all five source files, pre-edit).
- **Not pushed.** Nothing verified in the live browser yet — the Transactions fix should be
  eyeballed on `/transactions` against `/debt` once Tre is signed in.
