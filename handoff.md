# Handoff — 2026-08-04 — session 77 — branch `main` — legacy debt engine migrated

Continues session 76. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." Standing constraint: **do not delete his
account.** Nothing is pushed — 11 local commits ahead of origin.

## 1. 🔴 NEW REQUEST FROM TRE — this is the next workstream

Sent at the end of this session, **not started, not scoped**:

> "after we finish with this work, lets set up auto pull real transactions with plaid. and have
> users be able to match transactions with the set up rules. plaid would use the accurate number in
> all related calculations."

Three parts, and they are not equally sized:

1. **Auto-pull Plaid transactions** — a scheduled sync, not the manual/on-open path in place today.
2. **Match a pulled transaction to an existing recurring rule** — new UI + a persisted link.
3. **Engine reads the matched actual instead of the rule's estimate.** This is the deep one. Rule
   amounts feed `useCardProjection` / the forecast engine everywhere; swapping in actuals changes
   month-0 expenses, the cash floor and therefore Safe to Pay. **Do not start coding this before
   `/multi-plan`** — and ask Tre whether an actual overrides the rule only for the month it lands
   in, or re-bases the rule going forward. That question changes the schema.

Existing ground to read first: `src/hooks/usePlaidItems.ts`, the Plaid sync edge function,
`mergeWithGeneratedTransactions` in `src/lib/pay-schedule.ts` (this is what currently fabricates a
transaction per rule, and is exactly what a real matched transaction has to displace).

## 2. DONE THIS SESSION (1 commit, local, NOT pushed)

### ✅ `beb8482e` — the second debt engine is gone from all three surfaces

This was session 76's approved next task ("migrate all three surfaces"). Done and live-verified.

**New:** `src/lib/month0-debt-breakdown.ts` — pure `buildMonth0DebtBreakdown()` returning the same
`MonthlyDebtBreakdown` shape, derived entirely from `cardProjection.month0`. Extracted verbatim from
Dashboard's old inline `dashboardDebtRecs`. Wrapped by `src/hooks/useMonth0DebtBreakdown.ts` (reads
`CardProjectionContext`, so it only works under `DashboardLayout`'s provider — all three pages are).

Migrated off the legacy pass:
- **Dashboard** — the legacy `getMonthlyDebtBreakdown` fed month-end cash + savings rate while the
  widget right next to it already used month 0. Collapsed the duplicate `debtObligationTxns` and
  `dashboardDebtRecs` into the one hook; dropped `debtCards`/`buildCardData`.
- **BudgetControl** — debt payment rules + injected debt transactions.
- **SavingsGoals** — linked-account remaining-cash math; also drops a `try/catch` that was there
  only because the legacy engine threw.

**Also closes finding §2.2.** Budget's `REMAINING CASH` tile is labelled *"matches Debt tab Safe to
Pay"* but re-derived it as `balance + remainingIncome − max(cashFloor, prePaycheckBills)`, ignoring
save-up reserves and vehicle/insurance holdbacks. It now **reads `month0.safeToPayTotal` directly**,
so the claim is true by construction. Its calc-drawer explainer and the label copy were rewritten to
match (the old copy described the old formula).

**Numbers moved, as Tre pre-accepted:** demo Dashboard month-end cash **$1,655 → $187**, because the
legacy pass recommended $3,728 to Chase Sapphire where the engine wanted $6,401.

`getCurrentMonthDebtRecommendations` now has **zero callers** — marked `@deprecated` in
`credit-card-engine.ts`, not deleted. `getMonthlyDebtBreakdown` is **still live** behind the forecast
input pipeline (`useForecastEngineInputs.ts:141`, `Forecast.tsx`) and was deliberately left alone.

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on all touched files, `npx vitest run`
**302/302 green** (68 files, +9 new tests in `src/lib/__tests__/month0-debt-breakdown.test.ts`).
**Live-verified on REAL data** (see §3.1): Budget `REMAINING CASH $4,390` = `DEBT PAYMENTS $4,390` =
Debt tab `Safe to Pay $4,390`.

## 3. ⚠️ ENVIRONMENT GOTCHAS

1. **🆕 The browser session is signed in as Tre — real data, not demo.** A vite HMR reload during
   this session dropped demo mode and landed on his live account. That is how the real-data check
   above happened. **Read-only there. Do not write, and do not delete his account.**
2. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth`. Click "See Demo"
   (that is the button's text, not "Try Demo"), then navigate **only** by clicking in-app links.
   An HMR reload also drops it.
3. `npx vitest run --reporter=basic` fails on vitest 4.1.10 (`basic` was removed). Use `npx vitest run`.
4. **Don't put a PowerShell here-string in a compound `;`-chained command.** Write the commit message
   to a scratchpad file and `git commit -F`. (Bash heredoc + `git commit -F` worked fine this session.)
5. Dev server on **8080 with `--strictPort`**.

## 4. NEXT STEPS (in order)

1. **🔴 Tre's Plaid request — see §1.** Needs `/multi-plan` and one product question answered first.
2. Findings **§2.6 / §2.4 / §2.3** (budget snapshot rows don't sum; three expense definitions; five
   cash-floor values) need a **product decision** on which definition is canonical. **Ask, don't
   pick.** Note Settings exposes no cash-floor control at all, worth raising against §2.3's "your
   floor setting" copy in Forecast. **§2.6 is now the loudest of these** — Dashboard's snapshot still
   lists `2800 + 5850 − 1975 − 2402 − 150 − 267` and prints `= $6,488`, which is $2,632 off what the
   rows actually sum to. The rows are decorative; the total is canonical. That needs to be reconciled.
2. Re-verify finding **§1.1** (Dashboard month-end cash vs Forecast −$3,300). **Partly moved by this
   session** — demo Dashboard is now $187, not $1,655 — but Forecast was not re-read afterwards.
   Still the highest-severity open item. Check it before assuming the migration closed it.
3. Unblocked demo bugs, roughly easiest first: **§3.5** (completed AirPods plan still counts toward
   "2 active"), **§3.7** (Dashboard shows the retired `2024 Honda Civic` goal; "2 goals" sits above a
   list of 3 — still reproduced in demo this session), **§3.1** (utilization milestones say "below
   50%: 0 months" at 65.1%), **§3.8** (CC payoff ETA off by one vs Forecast).
4. Full real-data walk. **Budget and Debt were spot-checked on real data this session and agree**;
   Forecast, Goals, Transactions never walked on real data.
5. Mobile/Capacitor viewport pass — not started.

## 5. CARRIED FORWARD, UNRESOLVED (from sessions 72–76)

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
   (`linked_rule_ids` will collide with the §1 rule-matching work — look at it then.)
5. `vendor-motion` (123 kB) is the next first-paint win but needs a source change to
   `src/pages/Landing.tsx:3`. **Tre chose config-only in session 71 — re-offer only if he raises
   page speed.**
6. Recorded snapshot history predates both the loan-liability rule and the vehicle rule, so the Net
   Worth History chart will step-change where the rules meet. Old rows left as recorded.

## 6. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 7. FILES

- **New:** `src/lib/month0-debt-breakdown.ts`, `src/hooks/useMonth0DebtBreakdown.ts`,
  `src/lib/__tests__/month0-debt-breakdown.test.ts`.
- **Modified:** `src/pages/Dashboard.tsx`, `src/pages/BudgetControl.tsx`,
  `src/pages/SavingsGoals.tsx`, `src/lib/credit-card-engine.ts` (deprecation note only).
- **Backups:** `backups/2026-08-04_231431/` (the three pages, pre-change).
- **Not pushed.** 11 commits ahead of origin.

## 8. LESSON WORTH KEEPING

Session 76's near-miss repeated in a smaller way here: removing the legacy block from
`SavingsGoals.tsx` also deleted `liquidCash`, which sat inside the same span but was used 300 lines
later. `tsc` caught it, but only because it was a name reference. **When deleting a contiguous block,
grep every identifier it defines before cutting** — the block boundary is not the usage boundary.
