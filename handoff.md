# Handoff — 2026-08-04 — session 73 — branch `main` — full-site QA walk

⚠️ **Session 72's handoff (374 KB) was archived to `backups/2026-08-04_163309/handoff.md`.**
Its unresolved items are carried forward in §6 below. Read this file, not the archive, unless you
need the GA4/LaunchDarkly detail in §6.1.

## 0. GOAL

Tre asked for a full walk of the production site — every page, buttons, calculation errors,
cross-tab consistency. Explicit constraint: **do not delete his account.** He then approved:
"cancel and rerun [CI]… continue working all issues. and fix demo findings."

**No code has been changed yet this session.** The walk is done; the fixing has not started.

## 1. STATUS: WHAT IS DONE

- ✅ CI resolved. CodeQL (iOS) had run 266 min vs a 30–36 min norm; it self-completed **success**
  before the cancel landed. All 5 runs on `main` green. Nothing to rerun.
- ✅ Demo-mode walk complete (Dashboard, Accounts, Budget, Debt, Transactions, Forecast, Goals).
- ✅ Real-data walk **partially** complete (Dashboard, Transactions). Tre is signed in.
- ✅ Findings written to **`site-walk-findings.md`** (repo root, uncommitted). That file is the
  detailed record — **read it in full before fixing anything.**

## 2. 🔴 TRE'S REPORTED BUG — CONFIRMED AND ROOT-CAUSED (do this first)

His report: "the debt payment on the transactions tab for my discover card does not match the
payment that was on 8/1."

**Confirmed in his real data:**
| surface | Discover it Card | Prime Visa |
|---|---|---|
| Dashboard + Debt recommendation | **$3,382** | $1,008 |
| Transactions ledger (`debt payoff` entry) | **-$4,005** (2026-08-01) | -$1,008 (2026-08-07) ✅ matches |

**Also reproduced in demo data** (Chase Sapphire: recommended $6,401, ledger -$3,728; Discover
matched at $87). Two datasets, same signature.

**Root-cause hypothesis (needs one more confirmation step):** in both datasets the card that
mismatches is the one **absorbing the variable surplus** from the avalanche engine, and the card
that matches is the one pinned to a stable minimum/statement amount. The `debt payoff` transactions
look like **persisted snapshots written when the engine last ran, never regenerated when the
cash-flow inputs move.** The recommendation recomputes live; the ledger row does not.

⚠️ **This means Plaid transaction cross-referencing will NOT fix it** — it reproduces with
fictional data and no Plaid in the picture. Tre assumed it might; tell him otherwise.

**Next step:** I had just run `grep "debt payoff"` and got these 12 files — start there:
`src/lib/credit-card-engine.ts`, `src/lib/forecast-engine.ts`, `src/hooks/useSupabaseData.ts`,
`src/pages/Transactions.tsx`, `src/pages/DebtPayoff.tsx`, `src/pages/Dashboard.tsx`,
`src/lib/calculations.ts`, `src/pages/Accounts.tsx`, `src/pages/Forecast.tsx`,
`src/components/shared/AccountUpdateReminder.tsx`, `src/components/shared/DemoBanner.tsx`,
`src/pages/Legal.tsx`.
Find where the `debt payoff` transaction is written, and what invalidates/regenerates it.

## 3. 🔴 SECOND MATERIAL REAL-DATA BUG — net worth omits his car loan

- Dashboard `NET WORTH -$4,428` = assets $12,487 − credit cards $16,916. Liabilities breakdown
  lists **only the 4 credit cards.**
- But Transactions shows `2004 Chevorlet C5 Payment (1/29) · 2026-08-07 · -$423` — **a 29-month
  auto loan that is absent from liabilities and from net worth.** Roughly $12k of debt missing.
- Demo showed the same shape, worse: net worth $11,900 reported vs −$22,600 actual, because an
  $8,000 student loan and a $26,500 auto loan were excluded.

Loans appear to live outside the `accounts` table and the net-worth rollup only sums accounts.
⚠️ Memory `project_net_worth_snapshots` warns **not** to simplify this to Accounts' live-only
totals — fix by adding loans into the rollup, not by changing what Dashboard reports.

## 4. 🟠 THIRD REAL-DATA BUG — "this week" understates obligations ~25×

Dashboard: `UPCOMING THIS WEEK: Fuel Aug 7 · $65`, `BILLS THIS WEEK $65 · 1 upcoming`.
Actual Aug 7 outflow in the ledger: Prime Visa payment $1,008 + Chevrolet loan $423 + Chevrolet
insurance $173 + Fuel $65 = **$1,669**. The widget omits debt payments, auto-loan payments, and
insurance. On a financial app this is the same class of risk as §5.1.

## 5. REST OF THE FINDINGS

All in `site-walk-findings.md`. Highest-value ones, condensed:

1. **Dashboard vs Forecast contradict for the same month** (demo): Dashboard "+$1,655 month-end
   cash / $6,488 to deploy" vs Forecast "Aug 2026: ⚠️ Cash goes negative!  END CASH -$3,300",
   negative 10 months straight. **Re-verify against real data — not yet checked.**
2. **Budget snapshot rows don't sum to their own total.** Real data: $3,523 + $4,720 − $385 =
   $7,858; − $2,700 floor − $173 = **$4,985**, but the "=" row shows **$4,390** ($595 gap).
   Cause: `MonthlyBudgetSnapshot.tsx:66` renders `availableToDeploy`
   (= `cardProjection.month0.safeToPayTotal`, an engine output) as the total of a `−` chain it was
   never derived from. `Dashboard.tsx:429-431` shows a prior session patched one instance by adding
   a "Vehicle Insurance (est.)" row — the structural problem was never fixed.
3. **Savings rate contradicts the two tiles above it.** Real: income $4,720 − expenses $3,196 =
   **+$1,524**, but the tile reads **−$3,634/mo (−77.0%)**. Three different expense definitions are
   live at once (Dashboard $3,196 / Transactions $9,626 / savings-rate implied $8,354).
4. **Cash floor has 5 different values** across tabs ($1,000 / $1,500 / $1,650 / $1,655 / $2,402)
   despite `Dashboard.tsx:621-623` claiming they're shared via `getAugmentedMinSafeCash`.
5. **Ordinal suffix bug, 5 implementations, 4 broken** → live as `Due 1th` on Tre's Discover card,
   plus `Due 22th`, `due 2th` in demo. Cheapest real fix in the whole list:
   - `src/components/dashboard/DebtRecommendationsWidget.tsx:98` — hardcoded `th`
   - `src/components/debt/CreditCardEngine.tsx:1599, 1667, 1701` — ternary covers only 1/2/3
   - Forecast obligations list + Accounts subtitle — unconditional `th`
   Write one shared `ordinalSuffix(n)` (handle the 11/12/13 exception) and replace all five.
6. **Car goal progress 352%** — "$3,523 saved" vs "YOUR GOAL $1,000 + $6,700 gift"; the percentage
   divides by the $1,000 base only, ignoring the $6,700 shown beside it.
7. **`TOTAL SAVED $8,719 · 4 goals`** above a list showing only 2 goals totalling $4,483.
8. **Utilization milestones impossible**: at 65.1% util it prints "Below 50% util: ~0 months".
   Also `~1 months` pluralization.
9. Budget's own stated invariant broken: "Remaining Cash $6,995 · matches Debt tab Safe to Pay",
   Debt says $6,488.
10. Paycheck mis-categorised `Other` instead of `Income`; `Unassigned $897` of loan/installment
    payments with no payment source; duplicate recurring rows (demo).

### ⚠️ RETRACTED — do not chase this
`site-walk-findings.md` §3.6 claims a payment-plan off-by-one ("card 3/12 vs transaction 4/12").
**That is wrong and I verified it after writing the file.** The card shows *installments paid*, the
transaction shows *which installment it is*; for a future-dated payment `n paid` + `this is n+1` is
correct. Confirmed by `ExtremeOnlineStore CF Aero Kit`, whose past-dated 8/01 row correctly reads
`(2/6)` against a `2/6` card. **Delete §3.6 from the findings file.**

### Measurement artifact — do not "fix"
The landing page appeared blank on first screenshot. The driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion
never runs, and every `initial={{opacity:0}}` stays invisible. Verified: `rafFired: false`.
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**
(This is the third session in a row where a confident hypothesis died on measurement — see the
archived handoff's §A on GA4/DNT and session 71's recharts theory.)

## 6. CARRIED FORWARD, UNRESOLVED (from session 72)

1. **GA4 health still UNKNOWN.** Session 27's "LaunchDarkly breaks GA4" conclusion is probably a
   DNT=1 measurement artifact. Needs retest in a browser with Do-Not-Track OFF. Also confirm
   `VITE_GA_MEASUREMENT_ID` is set in Vercel production. Detail in the archived handoff §A.
2. **🔴 Session replay has no consent gate — needs Tre's decision, not code.** `src/main.tsx:7`
   calls `initMonitoring()` unconditionally at boot; `src/lib/monitoring.ts` starts LaunchDarkly
   observability + session replay with `networkRecording: {enabled:true}`, honoring no consent, no
   GPC, no DNT — while `initGA()` honors all three. `AuthContext.tsx:205` sends the user's **email**
   to it. `src/lib/cookie-consent.ts:10,39` describes analytics as "Vercel Speed Insights" —
   a package that is installed but **never imported**. Do not silently delete
   `@vercel/speed-insights`; that makes the disclosure more wrong.
3. **4 dead deps confirmed, not removed** (Tre hasn't approved): `cmdk`, `embla-carousel-react`,
   `input-otp`, `react-resizable-panels`. Removing `cmdk` also drops `@radix-ui/react-dialog`.
4. Stale `linked_rule_ids` on goals; the Sep–Dec 2026 + Jan 2027 interest band. Both untouched.
5. `vendor-motion` (123 kB) is the next first-paint win but needs a source change to
   `src/pages/Landing.tsx:3`. **Tre chose config-only in session 71 — re-offer only if he raises
   page speed.**

## 7. NEXT STEPS (in order)

1. Read `site-walk-findings.md` in full. Delete its §3.6 (retracted, see above).
2. Root-cause §2 (stale `debt payoff` transactions) — Tre's actual complaint. Strong model owns
   this diagnosis per `lean-fix`.
3. Fix §5.5 (ordinal helper) — smallest, safest, fully specified, touches his live data.
4. Fix §3 (net worth must include loans) — respect the `project_net_worth_snapshots` warning.
5. Fix §4 ("this week" widget must include debt/loan/insurance).
6. §5.2 / §5.3 / §5.4 need a **product decision from Tre** before coding: which definition of
   "monthly expenses", "cash floor", and "available to deploy" is canonical. Do not guess — the
   CLAUDE.md AMBIGUITY RULE applies. Ask him.
7. Finish the real-data walk: **Budget, Debt, Forecast, Goals, Vehicles, Settings not yet visited
   while signed in.** Re-verify §5.1 (Dashboard vs Forecast) against real numbers.
8. Mobile/Capacitor viewport pass — not started.

## 8. FILES

- **Created, uncommitted:** `site-walk-findings.md`, this `handoff.md`.
- **Backed up:** `backups/2026-08-04_163309/handoff.md` (previous 374 KB handoff).
- **Modified:** none. No source file has been touched this session.
- Browser: Chrome MCP tab `1527581110`, Tre signed in, currently on `/transactions`.
