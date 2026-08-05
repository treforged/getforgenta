# Handoff — 2026-08-05 — session 81 — branch `main` — §1.1 decomposed, part 1 landed

Continues session 80. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **21 local commits ahead**.

## 1. THE BIG RESULT THIS SESSION: §1.1 IS FULLY DECOMPOSED

§1.1 was "Dashboard `MONTH-END CASH $5,833` vs Forecast `Aug 2026 END CASH $2,346`, $3,487 apart."
I walked both pages term by term in the live demo. **It is three separate defects, and the
arithmetic now closes exactly.** Do not re-derive this; it cost most of a session.

Measured live (demo, 2026-08-05):

| Term | Dashboard snapshot (engine chain) | Forecast Aug-2026 popup |
|---|---|---|
| Balance on hand | $0 | Current Cash $0 |
| Income | $5,850 | Paycheck $5,850 |
| Bills | $645 | Bills & Expenses **$795** |
| Savings goals | $150 | Vacation Fund $150 |
| Car down payment | $267 | Reserving for Civic $267 |
| Car loan | *(absent)* | Car Loan Payments **$537** |
| Transfers | $450 | Roth $250 + Brokerage $200 |
| CC payment | avail. to deploy $1,572 | Sapphire $1,485 + Discover $87 = $1,572 ✓ |
| **=** | projected remaining **$4,338** | ending cash **$2,346** (incl. $267 reserve) |

**Cause A — $3,487 of it (the whole visible gap): Dashboard's tile is on a different engine.**
`Dashboard.tsx:587` builds `monthEndCash` from the transaction-merge helpers
(`getRemainingTransaction*`) — the exact source `useCardProjection.ts:382-389` records the engine
*deliberately abandoned* — and it omits savings, car reserve, car loan, insurance, mortgage and
transfers **entirely**. The same page's own snapshot already showed $4,338 while the tile said
$5,833. **Not yet fixed. This is next step 1.**

**Cause B — $150: `cashPreDebt` omitted payment-plan installments. ✅ FIXED (`ac187a71`).**
`planCashExpensesEarly[0]` was already in the sim's month-0 expenses *and* the floor, just not in
`cashPreDebt`/`m0Chain`. Engine folds it into `baseExpenses` at `forecast-engine.ts:697`.

**Cause C — $537: car-loan cutoff asymmetry. NOT FIXED — needs Tre's decision (see §2.2).**
`useCardProjection.ts:1218-1224` drops a car loan whose due day is ≤ `syncCutoffDate` ("already in
the Plaid balance"); `forecast-engine.ts:268-277` (`activeCarLoanByMonth`) applies **no such
cutoff**, so Forecast charges the RAV4's $537 and the hook does not. Same month, same loan,
opposite answers.

## 2. NEXT STEPS (in order)

1. **Finish §1.1: wire Dashboard to `month0.endCash`.** The engine side landed in `ac187a71`:
   `Month0Result.endCash = chain.cashPreDebt − safeToPayTotal + carReserveHeld`, which is
   byte-for-byte `forecast-engine.ts`'s `endingCash` at i=0 (`finalLiquid` at :1126 plus the
   reserved-vehicle add-back at :1282). New `carReserveHeld` excludes a vehicle purchased in
   month 0, mirroring `cumulativeCarReserveHeld` (:1080-1084). To do:
   - `Dashboard.tsx:587` `monthEndCash` → `cardProjection?.month0?.endCash`, keeping the current
     transaction-merge expression **only** as the `cardProjection == null` fallback (the hook
     returns null when the user has no credit cards — `useCardProjection.ts:86`). Comment the
     fallback as such.
   - `Dashboard.tsx:700-728` `openMonthEndCalc` still prints the old five-line tx-merge chain.
     Rebuild it from `month0.chain` (+ the `carReserveHeld` add-back line) so the drawer shows the
     same derivation the tile shows — this is the §2.6 lesson applied to the tile.
   - Add `planExpenses` as a row in `month0-budget-snapshot.ts` (`buildMonth0Snapshot`) — the term
     now exists in the chain and would otherwise be an invisible part of the fold. The
     rows-fold-to-their-subtotals test in `month0-budget-snapshot.test.ts` is what guards this.
   - Live-verify: Dashboard tile must equal Forecast's Aug END CASH **exactly**, modulo the $537
     of Cause C if that is still open.
2. **§1.1 Cause C — ASK TRE, do not pick silently.** "A car-loan payment whose due day already
   passed the Plaid sync date: already paid (hook) or still to come (Forecast)?" My recommendation
   is **adopt the hook's cutoff in the engine's month 0** — it matches the established
   `syncCutoffDate` principle used for bills, CC minimums and plan installments (Q11/Q12), and it
   is a month-0-only change. Counter-argument to put to him: it makes cash look *higher*, which is
   the unsafe direction if the balance does not actually reflect the payment (demo fixtures do not
   — there is no Plaid there).
3. **§2.9 (needs Tre's decision, don't code it blind)** — car-fund earmark can exceed the account
   it is earmarked from. Demo shows `Balance on hand $0` while Chase Checking holds $2,800 and
   LIQUID CASH reads $9,900, because `getCarFundEarmark` (`vehicle-loan-engine.ts:183`) earmarks
   the Civic's `current_saved` $3,200 against `linked_account: 'd1'` and the balance clamps at 0.
   **Confirmed live again this session** — the engine's whole month-0 chain starts from $0, which
   makes every number on both pages look stranger than it is. Two tangled things: a demo-fixture
   defect (persona "saved" $3,200 into an account holding $2,800; presumably meant to be Marcus
   HYS) and a modeling gap (no check the saved cash is actually in `linked_account`; shortfall
   silently clamped instead of surfaced).
4. **§1A Plaid auto-pull + rule matching** — Tre's request, not started. His decision is final:
   **a matched actual overrides the rule ONLY for the month it lands in**; it does NOT re-base the
   rule. Store a per-(rule, month) override row keyed by rule_id + year-month; leave
   `recurring_rules.amount` untouched. Do not add "update the rule from the last actual" — he
   considered that shape and chose against it. Three parts: (a) scheduled auto-pull, not today's
   manual/on-open path; (b) match UI + persisted link; (c) **the deep one** — engine reads the
   matched actual instead of the estimate, moving month-0 expenses, the cash floor and Safe to Pay.
   Ground to read first: `src/hooks/usePlaidItems.ts`, the Plaid sync edge function, and
   `mergeWithGeneratedTransactions` in `src/lib/pay-schedule.ts` (it fabricates a transaction per
   rule — exactly what a real matched transaction must displace). `linked_rule_ids` (§5.4)
   collides here. Needs `/multi-plan` before any file is touched.
5. Remaining unblocked demo bugs: **§4.2** (allocation percentages sum to 146%, Remaining clamped
   to 0% instead of showing the −46% overspend), **§2.5** (Emergency Fund Dec 2028 on Goals vs
   Mar 2029 in Forecast — Goals appears to apply the Marcus 4.5% APY and Forecast does not),
   **§2.1 / §3.2 / §3.4** (income double-count, paycheck mis-categorised "Other", duplicate
   recurring rows — these three may be **demo-fixture** defects; check the fixture before coding).
6. **Forecast's stale floor copy.** Milestone text still reads "Cash floor raised to **$1,655**"
   while the same page's own popup reads Cash Floor **$2,402** (verified live this session). Small,
   self-contained, and it is the "second thread" §1.1 mentioned — it is NOT part of the $3,487.
7. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT
   answered.** Ask when it next comes up. (Cause C above is a second one of the same shape.)
8. **§2.3 leftovers:** Debt tab's `$1,000` copy was not touched. **Settings exposes no cash-floor
   control at all**, contradicting Forecast's "your floor setting" copy — raise with Tre.
9. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
10. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
    Forecast, Goals, Transactions never walked on real data.
11. Mobile/Capacitor viewport pass — not started.

## 3. LATENT DEFECT FOUND, NOT FILED, NOT FIXED

`forecast-engine.ts:159` picks its starting `liquidBal` from `forecastFundingAccountId` with **no
account-type check** (`active.find(a => a.id === …)` — a savings account would be accepted), while
`useCardProjection.ts:135` resolves `resolveFundingAccountId(accounts, persistedDebtFundingId,
forecastFundingAccountId)`. Two consequences: (a) if the user picks a different debt-funding
account in the Debt tab, the engine still starts from the profile default; (b) the engine skips the
§2.8 type validation. Invisible in demo (the persisted id resolves to null, so both land on the
same account). Fix is to route the engine through `src/lib/funding-account.ts` too — but it moves
real numbers, so pair it with a live check.

## 4. ⚠️ ENVIRONMENT GOTCHAS

1. **The dev server can serve a STALE transform and silently invalidate a live check.** Always
   confirm the served module before trusting a live verification:
   `await fetch('/src/<path>?t='+Date.now()).then(r=>r.text())` and grep it for something you just
   wrote. Fix: restart vite (`Stop-Process -Id <pid on 8080> -Force`, then `npm run dev`).
2. Landing CTA is **"See Demo"**. `find` + `computer left_click` does nothing; what works is
   `javascript_tool` → `[...document.querySelectorAll('button,a')].find(x=>/see demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,6000))`. Same trick for in-app nav
   (`querySelectorAll('a')` + exact text match), which keeps demo state alive.
3. **Opening a Forecast month row:** `[...document.querySelectorAll('div')].find(e =>
   e.innerText.trim().startsWith('Aug 2026') && e.innerText.includes('CC $') &&
   e.innerText.length < 60).click()` — then read `document.body.innerText.split('\n')` **from the
   END** (`.slice(-100)`); the breakdown renders at the bottom of the page, not in a dialog, and
   `[role=dialog]` finds nothing. One click toggles it, so don't click twice.
4. `javascript_tool` returning a long `|`-joined string, or any `body.innerText.slice(...)` around
   a `$`-heavy region, gets `[BLOCKED: Cookie/query string data]`. Return a structured array
   instead (e.g. `document.body.innerText.split('\n').slice(a,b)`) — that always works.
5. Don't put a long sleep in the same `javascript_tool` call as a `location.href` navigation.
6. Reading component props off the DOM via `__reactFiber$` + walking `.return`/`memoizedProps`
   works **only where a component boundary exists**. The Forecast month row is inline JSX inside
   `Forecast.tsx`, so the walk finds nothing but `className/onClick/children` — I burned three
   turns on it. Read the rendered popup text instead. Walking `memoizedState` never works.
7. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth`. An HMR reload
   can land you on **Tre's real account** if the browser is signed in. **Read-only there.**
8. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
9. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
   `git commit -F -` works and is what I used.
10. Dev server on **8080 with `--strictPort`**; up and serving fresh transforms as of this session.

## 5. CARRIED FORWARD, UNRESOLVED (from sessions 72–80)

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
7. `getCurrentMonthDebtRecommendations` has zero callers, `@deprecated` in `credit-card-engine.ts`,
   not deleted. `getMonthlyDebtBreakdown` is **still live** behind `useForecastEngineInputs.ts:141`
   / `Forecast.tsx` — deliberately left alone.

## 6. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 7. FILES

- **Modified (committed `ac187a71`):** `src/hooks/useCardProjection.ts`,
  `src/lib/debt-model-types.ts`, `src/lib/__tests__/month0-budget-snapshot.test.ts`,
  `src/lib/__tests__/month0-debt-breakdown.test.ts`.
- **Backups:** `backups/2026-08-05_122418/` (four source files, pre-change).
- `npx tsc --noEmit` clean, `npx vitest run` **336/336 green**.
- **Not pushed.** 21 commits ahead of origin.

## 8. LESSON WORTH KEEPING

Session 79: *a UI showing a total it did not derive hides whatever it failed to model.*
Session 80: *validate identifiers at the boundary; make the failure mode "no filter", not "filter
everything".*

This session's: **when two surfaces disagree, do not look for THE bug — line the two derivations up
term by term and read off the differences.** §1.1 survived four sessions of single-cause hunting
because it is three causes that happen to point the same direction. Twenty minutes of putting the
Dashboard snapshot rows and the Forecast popup rows in one table closed it completely, and two of
the three causes ($150 plan installments, $537 car loan) were invisible at the total level — they
only appear when a term is present on one side and *absent* on the other. **An absent row is the
hardest kind of discrepancy to see, and a table is what makes it obvious.**
