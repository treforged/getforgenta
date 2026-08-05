# Handoff — 2026-08-05 — session 78 — branch `main` — four demo findings closed

Continues session 77. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." Standing constraint: **do not delete his
account.** Nothing is pushed — 13 local commits ahead of origin.

## 1. 🟢 DECIDED BY TRE 2026-08-05 — both answers below are final, do not re-litigate

### A. Plaid auto-pull + rule matching (his request, still not started)

**✅ DECIDED: a matched actual overrides the rule ONLY for the month it lands in.** It does **not**
re-base the rule going forward. Schema follows from this: store a per-(rule, month) actual —
an override row keyed by rule_id + year-month — and leave `recurring_rules.amount` untouched.
Any month with no matched actual keeps using the rule estimate. Do not add "update the rule from
the last actual" behavior; Tre considered that shape and chose against it.

> "after we finish with this work, lets set up auto pull real transactions with plaid. and have
> users be able to match transactions with the set up rules. plaid would use the accurate number in
> all related calculations."

Three parts, not equally sized:
1. **Auto-pull** — a scheduled sync, not the manual/on-open path in place today.
2. **Match a pulled transaction to a recurring rule** — new UI + a persisted link.
3. **Engine reads the matched actual instead of the rule's estimate.** The deep one. Rule amounts
   feed `useCardProjection` / the forecast engine everywhere; swapping in actuals moves month-0
   expenses, the cash floor, and therefore Safe to Pay.

**The question that must be answered before any schema work:** does a matched actual override the
rule **only for the month it lands in**, or does it **re-base the rule going forward**? Needs
`/multi-plan` after that answer. Ground to read first: `src/hooks/usePlaidItems.ts`, the Plaid sync
edge function, and `mergeWithGeneratedTransactions` in `src/lib/pay-schedule.ts` — the last is what
currently fabricates a transaction per rule, and is exactly what a real matched transaction has to
displace. `linked_rule_ids` (§5.4 below) will collide with this — handle it here.

### B. Which definition is canonical — findings §2.6 / §2.3 (§2.4 still open)

**✅ DECIDED: accuracy wins — the ENGINE total stays canonical and the ROWS get derived from it.**
Tre's words: "the goal is accuracy… based off real forecast and cc calculations."

**Do NOT recompute the total from the rows.** `month0.safeToPayTotal` IS the real forecast/CC
number — the same value Budget's `REMAINING CASH` and the Debt tab's `Safe to Pay` read after
session 76/77's convergence. Re-deriving it from display rows would re-fork the engine, which is
exactly the debt sessions 76–77 paid off.

The defect: `MonthlyBudgetSnapshot.tsx:66` takes `availableToDeploy` as its **own prop** and prints
it on the `=` row, while rows 70–78 above it are assembled independently by Dashboard. Two separate
derivations rendered as one equation; the $2,632 is an **unmodeled residual**, not a math error.

Agreed plan (needs `/multi-plan` — multi-file across Dashboard, the snapshot component and the
month0 contract):
1. **Source every row from `cardProjection.month0`**, not Dashboard-local sums — balance,
   remaining income, remaining expenses, **`m0SafeFloor`** for the floor, `holdback` /
   `holdbackEvent` for reserves.
2. **Compute the residual and render it as a real labeled row** (`residual = chain −
   safeToPayTotal`), itemized by what the engine actually held back. `Dashboard.tsx:429-431` shows
   a prior session hand-patched ONE missing item ("Vehicle Insurance (est.)") — that is the tell
   that the residual was never modeled, only papered over as gaps were noticed. The residual must
   be **computed, never fudged**.
3. **Assert the invariant in a unit test** — rows must sum to the total, or the test fails. This is
   the part that stops it drifting back.

**Step 1 likely closes §2.3 (five cash-floor values) at the same time**, because the floor row would
then display the floor the engine actually used instead of a Dashboard-local re-derivation. Treat
§2.6 + §2.3 as ONE piece of work. Also note **Settings exposes no cash-floor control at all**,
which contradicts §2.3's "your floor setting" copy in Forecast — raise that with Tre when the floor
row lands.

**§2.4 (three expense definitions) is still undecided** — no answer given for it yet.

## 2. DONE THIS SESSION (1 commit, local, NOT pushed)

### ✅ `c205eebe` — findings §3.5, §3.7, §3.1, §3.8 all closed and live-verified

All four were **display-layer** defects sitting on top of correct engine math. No engine output
changed. Each root cause is written into `site-walk-findings.md` under its finding.

- **§3.5** `plan.active` is a user-toggled DB flag and nothing writes it back when the last
  installment date passes, so a 4/4 plan counted forever. Completion is now **derived**:
  new `isPlanInProgress()` in `payment-plan-generator.ts`. `getPlanProgress` gained an optional
  `asOf` param (testability). Finished plans render `(complete)`.
- **§3.7** Dashboard's Goal Progress injected `carFunds[0]` into a card that links to `/goals` — a
  page that deliberately lists no car funds. Now savings-goals-only (up to 3). The `car_goal`
  widget still covers the vehicle and now links to `/vehicles`.
- **§3.1** Utilization milestones returned the projection **index** as a month count; `months[i]`
  is the END of month i, so "0 months" meant "by month-end", not "already below". Now `i + 1`,
  plus a real already-below check against the live balance, plus singular/plural.
- **§3.8** Payoff ETA printed a **1-indexed** month number as "3 mo". Forecast maps the same value
  to Oct 2026 via `rawPayoffMonth - 1` — the math always agreed, only the label lied. The tile now
  shows the month itself in Forecast's own label format with "in N mo" beneath.

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on all touched files,
`npx vitest run` **307/307 green** (69 files, +5 new in
`src/lib/__tests__/payment-plan-progress.test.ts`). **Live-verified in demo on localhost:8080** —
Goal Progress lists 2 against "2 goals"; `Payment Plans · 1 active` with AirPods `(complete)`;
`Below 75% util: already there / 50%: ~1 month / 25%: ~2 months` at 65.1%;
`PAYOFF ETA · Oct 2026 · in 2 mo`, matching Forecast's `Oct 2026: CC Debt Free!`.

## 3. ⚠️ ENVIRONMENT GOTCHAS

1. **🆕 `find` + `computer left_click` on the "Try Demo" button silently does nothing** — two
   clicks returned success and the page never left `/auth`. What works:
   `javascript_tool` → `[...document.querySelectorAll('button')].find(x=>/try demo/i.test(x.textContent)).click()`.
   Same trick works for in-app nav (`querySelectorAll('a')` + text match), which also keeps demo
   state alive. Use it; don't burn turns on the click path.
2. The button's text is **"Try Demo"** (session 77's handoff said "See Demo" — it is not).
3. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth`. An HMR reload
   also drops it, and can land you on **Tre's real account** if the browser is signed in.
   **Read-only there. Do not write, and do not delete his account.**
4. `npx vitest run --reporter=basic` fails on vitest 4.1.10 (`basic` was removed). Use `npx vitest run`.
5. **Don't put a PowerShell here-string in a compound `;`-chained command.** Write the commit
   message to a scratchpad file and `git commit -F`. (Bash heredoc + `git commit -F` works.)
6. Dev server on **8080 with `--strictPort`**; it was already up this session.

## 4. NEXT STEPS (in order)

1. **🟢 UNBLOCKED — both §1A and §1B now have Tre's answers. Start here.**
   Recommended order: **§1B first** (§2.6 + §2.3 as one job — smaller, self-contained, and it
   hardens the month0 contract that §1A's engine work will lean on), then **§1A Plaid**.
   Both need `/multi-plan` before any file is touched.
2. Re-verify finding **§1.1** (Dashboard month-end cash vs Forecast −$3,300). **Still the
   highest-severity open item, and still not re-checked.** Session 77 moved demo Dashboard to $187
   but never re-read Forecast afterwards. Do this before assuming the debt-engine migration
   closed it — it is cheap now that the demo-nav recipe in §3.1 works.
3. Remaining unblocked demo bugs: **§4.2** (budget allocation percentages sum to 146%, Remaining
   clamped to 0% instead of showing the −46% overspend), **§2.5** (Emergency Fund completion date
   Dec 2028 on Goals vs Mar 2029 in Forecast — Goals appears to apply the Marcus 4.5% APY and
   Forecast does not), **§2.1 / §3.2 / §3.4** (income double-count, paycheck mis-categorised as
   "Other", duplicate recurring rows — these three may be **demo-fixture** defects rather than code;
   check the fixture before writing code).
4. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
5. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data.
6. Mobile/Capacitor viewport pass — not started.

## 5. CARRIED FORWARD, UNRESOLVED (from sessions 72–77)

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
6. Recorded snapshot history predates both the loan-liability rule and the vehicle rule, so the Net
   Worth History chart will step-change where the rules meet. Old rows left as recorded.
7. `getCurrentMonthDebtRecommendations` has zero callers, marked `@deprecated` in
   `credit-card-engine.ts`, not deleted. `getMonthlyDebtBreakdown` is **still live** behind
   `useForecastEngineInputs.ts:141` / `Forecast.tsx` — deliberately left alone.

## 6. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 7. FILES

- **New:** `src/lib/__tests__/payment-plan-progress.test.ts`.
- **Modified:** `src/lib/payment-plan-generator.ts`, `src/pages/Transactions.tsx`,
  `src/pages/Dashboard.tsx`, `src/components/debt/CreditCardEngine.tsx`, `site-walk-findings.md`.
- **Backups:** `backups/2026-08-05_000319/` (the four source files, pre-change).
- **Not pushed.** 13 commits ahead of origin.

## 8. LESSON WORTH KEEPING

Three of this session's four "bugs" were **correct numbers with lying labels** — a 0-based index
printed as a count (§3.1), a 1-based count printed as a duration (§3.8), a widget linking to a page
that cannot show what it displays (§3.7). Before changing a computation because two surfaces
disagree, **check whether both are reading the same value under different indexing conventions.**
§3.8 in particular would have been a real regression if "fixed" in the engine: the two surfaces
already agreed.
