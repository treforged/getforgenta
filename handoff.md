# Handoff — 2026-08-04 — session 76 — branch `main` — site-walk fixes, live-verified

Continues session 75. `site-walk-findings.md` (repo root, committed) is still the source list and is
now annotated with what's verified fixed. **Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." Standing constraint: **do not delete his
account.** Nothing is pushed — 10 local commits ahead of origin.

## 1. 🔴 START HERE — Tre already answered the two blocking questions

Session 75 was blocked on two decisions. **Both are now answered — do not re-ask.**

1. **`car_funds` loan in net worth → "Account row wins, dedupe car_funds."** ✅ **DONE**, see §2.
2. **Migrate the legacy `getMonthlyDebtBreakdown` engine → "Migrate all three surfaces."** ❌ **NOT
   STARTED. This is the next task.** See §4.1.

## 2. DONE THIS SESSION (2 commits, local, NOT pushed)

### ✅ `fc03e09d` — findings doc updated after a live walk

Walked demo mode on `localhost:8080` and confirmed three previously-shipped fixes hold:

- **§1.3 net worth** — Dashboard `-$22,600 / $24,600 assets` and Accounts
  `-$22,600 / $24,600 / $47,200` now agree (were $11,900 / $12,700).
- **§1.2 Discover/Sapphire mismatch** — Transactions now reads `Chase Sapphire Payment · -$6,401`,
  matching the engine (was -$3,728).
- **§4.1 ordinals** — `Due 15th` / `Due 22nd` render correctly (was `22th`).

Also walked **Vehicles and Settings for the first time**, closing two of the findings' four
"still to do" items, and logged **new finding §2.7**.

### ✅ `f2941b1b` — financed vehicles now count toward net worth (Tre's decision #1)

`buildNetWorthBreakdown` takes a 4th input, `vehicleLoans`. Callers pass
`getActiveCarLoanPayments(carFunds)` **straight through** — `CarLoanPaymentInfo` already satisfies
`NetWorthVehicleLoan` structurally, so there is no adapter and the liability equals exactly what
Vehicles displays. Wired into Dashboard, Accounts and `useNetWorthSnapshotRecorder`.

Dedupe rule: **whichever liability row the user already maintains wins**; the amortized `car_funds`
loan is added only when that vehicle isn't represented anywhere else. Matching is
`sharesDistinctiveToken` (shared identity-bearing word; a shared model year alone never matches).

⚠️ **The near-miss worth remembering:** I first scoped the dedupe to `auto_loan` **accounts** only.
Tests passed. The live demo then showed **-$49,710** with the RAV4 listed twice, because the demo's
`Auto Loan — RAV4` is a **manual liability row, not an account**. Manual rows now count as an
existing representation. **Unit tests did not catch this — the live check did.** Keep checking the
browser.

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on touched files, `npx vitest run`
**293/293 green** (67 files, +10 new), demo confirms `-$22,600` with one RAV4 row.

## 3. ⚠️ ENVIRONMENT GOTCHAS (cost me time — read these)

1. **Demo state is in-memory.** A hard `navigate` to any URL drops it and bounces to `/auth`. To
   walk the app: click "Try Demo", then navigate **only** by clicking in-app `<a>` elements
   (client-side routing). `location.href = …` resets everything.
2. **Real-data pass is still blocked** — it needs Tre to sign in himself; I can't enter credentials.
   Everything below was verified in demo only.
3. **`npx vitest run --reporter=basic` fails** on vitest 4.1.10 (`basic` reporter was removed). Just
   use `npx vitest run`.
4. **Don't put a PowerShell here-string (`@'…'@`) in a compound `;`-chained command** — it gets
   mangled and git eats the message as pathspecs. Write the commit message to a scratchpad file and
   use `git commit -F`.
5. Session start had **15 stale vite dev/preview processes** on ports 8080/8081/8091×3/8093/4173.
   Killed; one server now runs on **8080 with `--strictPort`**.

## 4. NEXT STEPS (in order)

1. **🔴 THE TASK: migrate the legacy debt engine — Tre approved "migrate all three surfaces."**
   `getMonthlyDebtBreakdown` is a *second* legacy debt engine still driving
   `Dashboard.tsx` (its ledger → month-end cash, savings rate), `BudgetControl.tsx:544`, and
   `SavingsGoals.tsx:375`. Only the debt widget and the upcoming-bills widget read the canonical
   `cardProjection.month0.perCardAdjusted`. This is likely the real fix for findings **§2.2**
   (Budget's "matches Debt tab Safe to Pay" invariant: $6,995 vs $6,488) and part of **§2.4**.
   **Numbers on Dashboard and Budget will move — Tre has already accepted that.** Backups of
   BudgetControl.tsx and SavingsGoals.tsx are already in `backups/2026-08-04_223702/`.
2. Findings **§2.6 / §2.4 / §2.3** (budget snapshot rows don't sum; three expense definitions; five
   cash-floor values) need a **product decision** on which definition is canonical. **Ask, don't
   pick.** Note Settings exposes no cash-floor control at all, which is worth raising against §2.3's
   "your floor setting" copy in Forecast.
3. Unblocked demo bugs nobody has decided against, roughly easiest first: **§3.5** (completed
   AirPods plan still counts toward "2 active"), **§3.7** (Dashboard shows the retired
   `2024 Honda Civic` goal; "2 goals" sits above a list of 3), **§3.1** (utilization milestones say
   "below 50%: 0 months" at 65.1%), **§3.8** (CC payoff ETA off by one vs Forecast).
4. Re-verify findings **§1.1** (Dashboard +$1,655 month-end cash vs Forecast −$3,300) — still open
   and still the highest-severity item on the list. Likely entangled with step 1.
5. Real-data walk once Tre signs in; **Budget, Debt, Forecast, Goals never visited on real data.**
6. Mobile/Capacitor viewport pass — not started.

## 5. CARRIED FORWARD, UNRESOLVED (from sessions 72–75)

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
6. Recorded snapshot history predates both the loan-liability rule and now the vehicle rule, so the
   Net Worth History chart will step-change where the rules meet. Old rows left as recorded.

## 6. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 7. FILES

- **Modified this session:** `src/lib/net-worth.ts` (+`NetWorthVehicleLoan`,
  `sharesDistinctiveToken`, 4th param), `src/pages/Dashboard.tsx`, `src/pages/Accounts.tsx`
  (gained `useCarFunds`), `src/hooks/useNetWorthSnapshotRecorder.ts`,
  `src/__tests__/net-worth.test.ts` (+10 tests), `site-walk-findings.md`.
- **Backups:** `backups/2026-08-04_223702/` (includes BudgetControl.tsx and SavingsGoals.tsx,
  pre-staged for next session's step 1).
- **Not pushed.** 10 commits ahead of origin.
