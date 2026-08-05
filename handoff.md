# Handoff — 2026-08-05 — session 79 — branch `main` — §2.6 + §2.3 closed

Continues session 78. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **14 local commits ahead**.

## 1. DONE THIS SESSION (1 commit, local, NOT pushed)

### ✅ `d1f6d68a` — findings §2.6 + §2.3 closed, live-verified

Executed §1B of session 78's handoff, per Tre's decision *accuracy wins — the engine total stays
canonical and the rows get derived from it*.

**§2.6** — the snapshot printed `month0.safeToPayTotal` (an engine output) as the `=` of a chain
Dashboard assembled from its own transaction sums. Two derivations rendered as one equation.

- `Month0Result` gains **`chain`** (`src/lib/debt-model-types.ts`): the engine's complete month-0
  cash chain, term by term, as integers. Each term rounded individually; **`cashPreDebt` is the
  sum of the rounded terms**, not a rounding of the raw sum — that is what makes the displayed
  identity exact in integer arithmetic. Populated in `useCardProjection.ts` next to `cashPreDebt`
  (~line 1651); `monthlySavingsAndCar` is split back into goals / carReserve / carLoan so each row
  gets a truthful label.
- New pure lib **`src/lib/month0-budget-snapshot.ts`** — `buildMonth0Snapshot()` builds rows and
  **computes** the residual (`cashPreDebt − m0SafeFloor − safeToPayTotal`), split into the engine's
  own `holdback` and the remainder, or a `+` row when card minimums are paid through the floor.
- `MonthlyBudgetSnapshot.tsx` does **no arithmetic** now — 12 assembly props collapsed to one
  `snapshot` prop. Keep it that way.
- Dashboard's parallel derivation is **deleted**: `month0ImpliedSavings` *and* the
  `month0SavingsBreakdown` memo that silently replaced it, hand-patched
  "Vehicle Insurance (est.)" row and all.

**§2.3** — root cause was NOT the shared function. Dashboard passed its own `fundingAccountId`
(`profile.default_deposit_account`, no account-type check, ignores the persisted override) while
the engine resolves `persistedDebtFundingId || forecastFundingAccountId` (checking/business_checking/
cash only). Different account ⇒ different pre-paycheck bills ⇒ different floor.
`CardProjectionResult` now exposes **`debtFundingAccountId`** and Dashboard uses it for the floor
row *and* the floor-calculator popover.

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on all touched files,
`npx vitest run` **318/318 green** (70 files, +11 new in
`src/lib/__tests__/month0-budget-snapshot.test.ts`). **Live-verified in demo on localhost:8080:**
`$4,100 + $5,850 − $150 − $311 − $450 = $9,039`, then `− $1,500 floor − $376 held = $7,163`.
Both halves balance exactly; floor row now $1,500 (was $2,402).

## 2. 🔴 NEW FINDING §2.8 — START HERE, IT IS PROBABLY §1.1

The §2.6 fix immediately surfaced this, which is exactly what it was built to do.

**The demo snapshot renders NO "Bills still coming" row** — `month0.chain.expenses` rounds to $0.
That value IS `m0Expenses`, the same term the engine subtracts in `cashPreDebt`, so it is **not a
display artifact**. But the same page shows `BILLS THIS WEEK $190 · 3 upcoming` and
`BILLS THIS MONTH $11,025 · 20 scheduled`, including **Gas · Aug 12 · Chase Checking $55** — a
cash-sourced rule `forecastMonthEvents[0].expenses` should count. (Groceries Aug 8 is on Chase
Sapphire and is correctly excluded via `allCcRuleIds`.)

If real, the engine overstates deployable cash by the whole remaining-bills amount, and this is a
strong candidate for the **still-open §1.1** (Dashboard vs Forecast month-end cash, −$3,300 apart).
Ground: `useCardProjection.ts:374-383` (`m0Income`/`m0Expenses` from `forecastMonthEvents[0]`) and
the `forecastMonthEvents` construction just above it (~line 340-372).

**Do not "fix" the display.** Establish the engine's real value first. A fiber probe for the live
`cardProjection` **failed** (walking `memoizedState` found nothing — don't repeat it); use a
temporary log in the hook, or compare against Forecast's own August row.

## 3. NEXT STEPS (in order)

1. **§2.8 above**, then re-check **§1.1** — they are plausibly the same bug. §1.1 is still the
   highest-severity open item and still has never been re-verified against Forecast.
2. **§1A Plaid auto-pull + rule matching** — Tre's request, still not started, now unblocked and
   next in line. His decision is final: **a matched actual overrides the rule ONLY for the month it
   lands in**; it does NOT re-base the rule. Store a per-(rule, month) override row keyed by
   rule_id + year-month; leave `recurring_rules.amount` untouched. Months with no matched actual
   keep the rule estimate. Do not add "update the rule from the last actual" — he considered that
   shape and chose against it.
   Three parts: (a) scheduled auto-pull, not today's manual/on-open path; (b) match UI + persisted
   link; (c) **the deep one** — engine reads the matched actual instead of the estimate, which moves
   month-0 expenses, the cash floor and therefore Safe to Pay. Ground to read first:
   `src/hooks/usePlaidItems.ts`, the Plaid sync edge function, and `mergeWithGeneratedTransactions`
   in `src/lib/pay-schedule.ts` — the last fabricates a transaction per rule and is exactly what a
   real matched transaction must displace. `linked_rule_ids` (§5.4) collides here; handle it here.
   Needs `/multi-plan` before any file is touched.
3. Remaining unblocked demo bugs: **§4.2** (allocation percentages sum to 146%, Remaining clamped to
   0% instead of showing the −46% overspend), **§2.5** (Emergency Fund Dec 2028 on Goals vs Mar 2029
   in Forecast — Goals appears to apply the Marcus 4.5% APY and Forecast does not), **§2.1 / §3.2 /
   §3.4** (income double-count, paycheck mis-categorised "Other", duplicate recurring rows — these
   three may be **demo-fixture** defects rather than code; check the fixture before writing code).
4. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT answered.**
   Ask when it next comes up.
5. **§2.3 leftovers:** Debt tab's `$1,000` copy and `Safe Min $1,650` vs Forecast's `$1,655` were
   not touched. Also **Settings exposes no cash-floor control at all**, contradicting Forecast's
   "your floor setting" copy — raise with Tre.
6. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
7. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data.
8. Mobile/Capacitor viewport pass — not started.

## 4. ⚠️ ENVIRONMENT GOTCHAS

1. **`find` + `computer left_click` on "Try Demo" silently does nothing.** What works:
   `javascript_tool` → `[...document.querySelectorAll('button')].find(x=>/try demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,3000))`. Same trick for in-app nav (`querySelectorAll('a')`
   + text match), which also keeps demo state alive.
2. **🆕 `javascript_tool` returning a long `|`-joined string got `[BLOCKED: Cookie/query string data]`.**
   Return a structured array instead (e.g. `.map(d => d.innerText.split('\n'))`) — that works fine.
3. **🆕 Reading component props off the DOM via `__reactFiber$` + walking `.return` and checking
   `memoizedProps` WORKS** and is the fast way to verify a rendered value. Walking `memoizedState`
   to find a hook's return value **did not** — don't burn turns on it.
4. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth`. An HMR reload also
   drops it and can land you on **Tre's real account** if the browser is signed in.
   **Read-only there. Do not write, and do not delete his account.**
5. `npx vitest run --reporter=basic` fails on vitest 4.1.10 (`basic` was removed). Use `npx vitest run`.
6. **Don't put a PowerShell here-string in a compound `;`-chained command.** Write the commit message
   to a scratchpad file and `git commit -F`. (Bash heredoc + `git commit -F` works.)
7. Dev server on **8080 with `--strictPort`**; already up this session.

## 5. CARRIED FORWARD, UNRESOLVED (from sessions 72–78)

1. **GA4 health UNKNOWN.** Session 27's "LaunchDarkly breaks GA4" is probably a DNT=1 artifact.
   Retest with Do-Not-Track OFF; confirm `VITE_GA_MEASUREMENT_ID` is set in Vercel prod.
2. **🔴 Session replay has no consent gate — needs Tre's decision, not code.** `src/main.tsx:7` calls
   `initMonitoring()` unconditionally; `src/lib/monitoring.ts` starts LD observability + replay with
   `networkRecording:{enabled:true}`, honoring no consent / GPC / DNT, while `initGA()` honors all
   three. `AuthContext.tsx:205` sends his **email** to it. `src/lib/cookie-consent.ts:10,39` describes
   analytics as "Vercel Speed Insights" — installed but never imported. Do not silently delete
   `@vercel/speed-insights`; that makes the disclosure *more* wrong.
3. **4 dead deps, Tre hasn't approved removal:** `cmdk`, `embla-carousel-react`, `input-otp`,
   `react-resizable-panels` (dropping `cmdk` also drops `@radix-ui/react-dialog`).
4. Stale `linked_rule_ids` on goals; the Sep–Dec 2026 + Jan 2027 interest band. Untouched.
5. `vendor-motion` (123 kB) is the next first-paint win but needs a source change to
   `src/pages/Landing.tsx:3`. **Tre chose config-only in session 71 — re-offer only if he raises
   page speed.**
6. Recorded snapshot history predates both the loan-liability rule and the vehicle rule, so the Net
   Worth History chart will step-change where the rules meet. Old rows left as recorded.
7. `getCurrentMonthDebtRecommendations` has zero callers, `@deprecated` in `credit-card-engine.ts`,
   not deleted. `getMonthlyDebtBreakdown` is **still live** behind `useForecastEngineInputs.ts:141` /
   `Forecast.tsx` — deliberately left alone.

## 6. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 7. FILES

- **New:** `src/lib/month0-budget-snapshot.ts`, `src/lib/__tests__/month0-budget-snapshot.test.ts`.
- **Modified:** `src/lib/debt-model-types.ts`, `src/hooks/useCardProjection.ts`,
  `src/components/dashboard/MonthlyBudgetSnapshot.tsx`, `src/pages/Dashboard.tsx`,
  `src/lib/__tests__/month0-debt-breakdown.test.ts`, `site-walk-findings.md`.
- **Backups:** `backups/2026-08-05_075202/` (five source files, pre-change).
- **Not pushed.** 14 commits ahead of origin.

## 8. LESSON WORTH KEEPING

Session 78's lesson was "correct numbers with lying labels." This session's is the mirror image:
**when a UI shows a total it did not derive, it hides whatever it failed to model.** The $2,632 gap
was never a math error — it was every engine term Dashboard didn't know about, summed. The fix that
holds is not adding the missing rows (a previous session tried that with one hand-patched line and
the gap came back); it is making the leftover a *computed, labeled row* so a term that goes missing
shows up as a number on screen instead of silently widening a gap. It worked within minutes:
finding §2.8 above is the first thing it caught.
