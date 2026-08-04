# Handoff — 2026-08-04 — session 75 — branch `main` — fixing the site-walk findings

Continues session 74. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." Standing constraint: **do not delete
his account.** Nothing is pushed — 4 local commits ahead of origin now.

## 1. DONE THIS SESSION (2 commits, local, NOT pushed)

### ✅ `9a212129` — net worth omitted loans (findings §1.3) — CLOSED for the unambiguous half

Four surfaces computed net worth four different ways. New **`src/lib/net-worth.ts`** owns the one
definition; Dashboard, Accounts and the snapshot recorder all call it.

- liability iff type ∈ `LIABILITY_ACCOUNT_TYPES` (cc, mortgage, student_loan, auto_loan,
  other_liability); every other active account is an asset (keeps the old "everything else is an
  asset" behaviour so an unmapped type is never dropped); manual rows added unless a live account
  on the same side already has that name.
- `buildNetWorthBreakdown` itemises the rows and `totalsFromBreakdown` reduces **those same rows**,
  so the Dashboard tile can no longer drift from the breakdown list under it.
- `net-worth-snapshot.ts` is now cadence-only; aggregation tests moved to
  `src/__tests__/net-worth.test.ts` (+ loan/mortgage/breakdown coverage).
- Side corrections: tile gains `mortgage`, `ira`, `hsa` and manual rows; Accounts gains `ira` and
  manual rows; `Accounts.LIABILITY_TYPES` (filters + form fields) now derives from the shared const.

⚠️ **Recorded snapshot history was written under the credit-card-only rule.** Any user with a loan
account gets a step change in the Net Worth History chart where the rules meet. Old rows left as
recorded — this is called out in the commit message.

### ✅ `b9a5050a` — "UPCOMING THIS WEEK" understated ~25× (old handoff §4)

Widgets read `generateScheduledEvents(rules, …)` alone. New **`src/lib/upcoming-obligations.ts`**
(`toScheduledObligations`) adapts the rows /transactions already builds:
card payments from `cardProjection.month0.perCardAdjusted` (canonical, **not** the legacy
`getMonthlyDebtBreakdown`), vehicle loan + insurance from `generateCarLoanTransactions`, plan
installments from `generatePaymentPlanTransactions` minus card-charged ones. Events sorted by date.

**Verification for both:** `npx tsc --noEmit` clean, `npx eslint` clean on every touched file,
`npm test` **283/283 green** (67 files).

## 2. 🔴 ASK TRE FIRST — two blocked decisions, do not guess (CLAUDE.md AMBIGUITY RULE)

1. **`car_funds` loan in net worth?** Tre's Chevy loan lives in `car_funds` (`loan_amount`,
   `loan_term_months`, `loan_start_date`, `actual_monthly_payment`, `phase`), **not** in `accounts`
   or `liabilities`, and stores no outstanding balance — it would have to be amortized from
   loan_amount/APR/start date. Should an active `car_funds` loan appear as a liability (amortized
   remaining balance), or does he track it manually in `liabilities`? Until answered, net worth
   still omits it unless he has a matching `auto_loan` account or manual row.
2. **Migrating the legacy debt engine will move displayed numbers.** See §3.1 below.

## 3. NEXT STEPS (in order)

1. **Same root cause as §1, still unfixed:** `getMonthlyDebtBreakdown` is a *second* legacy debt
   engine still driving `Dashboard.tsx:449-470` (its ledger → month-end cash, savings rate),
   `BudgetControl.tsx:544`, `SavingsGoals.tsx:375`. Only the widget and (this session) the upcoming
   widget read `perCardAdjusted`. Migrating these three is likely the real fix for findings §2.2
   (Budget's "matches Debt tab Safe to Pay" invariant) and part of §2.4. **It moves numbers on
   Dashboard/Budget — flag to Tre before doing it.**
2. Findings §2.6 / §2.4 / §2.3 (budget snapshot rows don't sum; three expense definitions; five
   cash-floor values) need a **product decision** on which definition is canonical. Ask, don't pick.
3. Finish the real-data walk: **Budget, Debt, Forecast, Goals, Vehicles, Settings never visited
   while signed in.** Re-verify findings §1.1 (Dashboard +$1,655 vs Forecast −$3,300) on real data.
4. Eyeball the two fixes live once signed in: `/dashboard` NET WORTH tile vs its breakdown list vs
   `/accounts`, and "Upcoming This Week" vs `/transactions` for the same days.
5. Mobile/Capacitor viewport pass — not started.

## 4. CARRIED FORWARD, UNRESOLVED (from sessions 72–74)

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

- **New this session:** `src/lib/net-worth.ts`, `src/lib/upcoming-obligations.ts`,
  `src/__tests__/net-worth.test.ts`, `src/__tests__/upcoming-obligations.test.ts`.
- **Modified:** `src/pages/Dashboard.tsx`, `src/pages/Accounts.tsx`,
  `src/lib/net-worth-snapshot.ts`, `src/hooks/useNetWorthSnapshotRecorder.ts`,
  `src/__tests__/net-worth-snapshot.test.ts`.
- **Backups:** `backups/2026-08-04_173605/` (pre-edit originals).
- **Not pushed.** Nothing verified in the live browser yet.
