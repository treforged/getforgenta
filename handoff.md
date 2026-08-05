# Handoff — 2026-08-05 — session 82 — branch `main` — §1.1 CLOSED

Continues session 81. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **23 local commits ahead**.

## 1. THE BIG RESULT: §1.1 IS CLOSED, LIVE-VERIFIED

Dashboard MONTH-END CASH **$2,883** == Forecast Aug 2026 END CASH **$2,883**. The $3,487
discrepancy that survived five sessions is **zero**. All three causes fixed:

- **Cause A** ($3,487, the visible gap) — Dashboard's tile was on a different engine. Fixed
  `6368a3fd`: `monthEndCash = cardProjection.month0.endCash`, tx-merge expression kept only as the
  `cardProjection == null` fallback. `openMonthEndCalc` now prints `month0.chain` term by term.
- **Cause B** ($150, plan installments) — fixed last session `ac187a71`; this session added the
  `planExpenses` row to `buildMonth0Snapshot` + the donut, so it is no longer invisible in the fold.
- **Cause C** ($537, car-loan cutoff asymmetry) — fixed `6b6256c5`, see §2.

**Do not re-derive any of this.** It cost two full sessions.

## 2. WHAT CAUSE C ACTUALLY WAS, AND THE RULE THAT NOW OWNS IT

Four sites answered "is this outflow already in the stored balance?" with three different rules.
New **`src/lib/sync-cutoff.ts`** owns it; tests in `src/lib/__tests__/sync-cutoff.test.ts`.

- `resolveSyncCutoffDate` — the date the balance is accurate AS OF: Plaid `last_synced_at`, else
  `accounts.updated_at`, else today; clamped to today. **No lag here.**
- `isCapturedInBalance(dueDate, balanceAsOf)` — strict `<` against `balanceAsOf −
  SETTLEMENT_LAG_DAYS (3)`. Tre's call 2026-08-05.

Two facts behind it, both verified: `plaid-sync/index.ts:232` stores **`balances.current`**, which
for depository accounts EXCLUDES pending (`available` is the netted one); and `plaid-sync` pulls
balances + liabilities **only, no transactions**, so there is no settled/pending evidence to
consult. When transaction sync lands (§1A), "captured iff a settled transaction matches it" should
**replace** this date heuristic, not tune it.

### ⚠️ THE TRAP — read before touching the lag

The lag went into `resolveSyncCutoffDate` first. **The live check caught it and tests did not.**
That date also gates **income**, so lagging it re-admitted a $1,463 deposit already sitting in the
balance and pushed Forecast month-0 END CASH $2,346 → **$4,346** (a `1× +$1,463` badge appeared on
the Aug row — that badge is the tell). Deposits settle into `current`; only debits sit pending
outside it. **The lag is an OUTFLOW-only correction.** Never move it back onto the cutoff date.

Tre approved applying the rule to **all month-0 cutoff sites**. Routed so far: engine
`activeCarLoanByMonth` (new gate) + `activeCarLoanInsuranceByMonth`; hook vehicle-extras,
loan-insurance and `m0CarFundsForLoan` gates; both inline cutoff derivations
(`CardProjectionContext`, `CreditCardEngine`). **Still NOT routed — this is next step 1:** the
bills / CC-minimum / plan-installment month-0 gates (Q11/Q12 sites) still compare against
`syncCutoffDate` directly with no lag. Sweeping them was deliberately deferred after the income
regression above; do them **one at a time with a live check each**, and confirm each site is an
outflow gate before applying the lag.

## 3. NEXT STEPS (in order)

1. **Finish the cutoff sweep** — the remaining outflow gates above. One at a time, live-verify each.
2. **§2.9 (needs Tre's decision, don't code it blind)** — car-fund earmark can exceed the account
   it is earmarked from. Demo shows `Balance on hand $0` while Chase Checking holds $2,800 and
   LIQUID CASH reads $9,900, because `getCarFundEarmark` (`vehicle-loan-engine.ts:183`) earmarks
   the Civic's `current_saved` $3,200 against `linked_account: 'd1'` and the balance clamps at 0.
   Two tangled things: a demo-fixture defect (persona "saved" $3,200 into an account holding
   $2,800; presumably meant to be Marcus HYS) and a modeling gap (no check the saved cash is
   actually in `linked_account`; shortfall silently clamped instead of surfaced).
3. **§1A Plaid auto-pull + rule matching** — Tre's request, not started. His decision is final:
   **a matched actual overrides the rule ONLY for the month it lands in**; it does NOT re-base the
   rule. Store a per-(rule, month) override row keyed by rule_id + year-month; leave
   `recurring_rules.amount` untouched. Do not add "update the rule from the last actual" — he
   considered that shape and chose against it. Three parts: (a) scheduled auto-pull, not today's
   manual/on-open path; (b) match UI + persisted link; (c) **the deep one** — engine reads the
   matched actual instead of the estimate, moving month-0 expenses, the cash floor and Safe to Pay.
   Ground to read first: `src/hooks/usePlaidItems.ts`, the Plaid sync edge function, and
   `mergeWithGeneratedTransactions` in `src/lib/pay-schedule.ts` (it fabricates a transaction per
   rule — exactly what a real matched transaction must displace). `linked_rule_ids` (§5.4)
   collides here. Needs `/multi-plan` before any file is touched. **This is also what retires the
   §2 date heuristic.**
4. Remaining unblocked demo bugs: **§4.2** (allocation percentages sum to 146%, Remaining clamped
   to 0% instead of showing the −46% overspend), **§2.5** (Emergency Fund Dec 2028 on Goals vs
   Mar 2029 in Forecast — Goals appears to apply the Marcus 4.5% APY and Forecast does not),
   **§2.1 / §3.2 / §3.4** (income double-count, paycheck mis-categorised "Other", duplicate
   recurring rows — these three may be **demo-fixture** defects; check the fixture before coding).
5. **Forecast's stale floor copy.** Milestone text still reads "Cash floor raised to **$1,655**"
   while the same page's own popup reads Cash Floor **$2,402**. Small, self-contained, unblocked.
6. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT
   answered.** Ask when it next comes up.
7. **§2.3 leftovers:** Debt tab's `$1,000` copy was not touched. **Settings exposes no cash-floor
   control at all**, contradicting Forecast's "your floor setting" copy — raise with Tre.
8. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
9. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data. **The §2 change moves real numbers for
   any Plaid user** (3-day lag) — this walk matters more than it did.
10. Mobile/Capacitor viewport pass — not started.

## 4. LATENT DEFECT FOUND, NOT FILED, NOT FIXED

`forecast-engine.ts:159` picks its starting `liquidBal` from `forecastFundingAccountId` with **no
account-type check** (`active.find(a => a.id === …)` — a savings account would be accepted), while
`useCardProjection.ts:135` resolves `resolveFundingAccountId(accounts, persistedDebtFundingId,
forecastFundingAccountId)`. Two consequences: (a) if the user picks a different debt-funding
account in the Debt tab, the engine still starts from the profile default; (b) the engine skips the
§2.8 type validation. Invisible in demo (the persisted id resolves to null, so both land on the
same account). Fix is to route the engine through `src/lib/funding-account.ts` too — but it moves
real numbers, so pair it with a live check.

## 5. ⚠️ ENVIRONMENT GOTCHAS

1. **The dev server can serve a STALE transform and silently invalidate a live check.** Always
   confirm the served module before trusting a live verification:
   `curl -s "http://localhost:8080/src/<path>?t=$(date +%s)" | grep -c <something you just wrote>`.
   Fix: restart vite (`Stop-Process -Id <pid on 8080> -Force`, then `npm run dev`).
2. Landing CTA is **"See Demo"**. `find` + `computer left_click` does nothing; what works is
   `javascript_tool` → `[...document.querySelectorAll('button,a')].find(x=>/see demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,7000))`. Same trick for in-app nav
   (`querySelectorAll('a')` + exact text match), which keeps demo state alive.
3. **Reading the Forecast table without opening anything:** `const L=document.body.innerText.split('\n');
   const i=L.lastIndexOf('MONTH'); L.slice(i,i+16)` gives MONTH/+INCOME/−OUT/END CASH then the rows.
   Far more reliable than the row-click popup. To open a month row anyway:
   `[...document.querySelectorAll('div')].find(e => e.innerText.trim().startsWith('Aug 2026') &&
   e.innerText.includes('CC $') && e.innerText.length < 60).click()` — read from the END
   (`.slice(-100)`); it renders at page bottom, not in a dialog. One click toggles it.
4. **Reading the Dashboard calc drawer:** click the tile via
   `[...document.querySelectorAll('*')].find(e=>/MONTH-END CASH/i.test(e.textContent||'') &&
   (e.textContent||'').length<80).click()`, wait ~1.2s, then `document.body.innerText.split('\n').slice(-45)`.
5. `javascript_tool` returning a long `|`-joined string, or any `body.innerText.slice(...)` around
   a `$`-heavy region, gets `[BLOCKED: Cookie/query string data]`. Return a structured array
   instead — that always works.
6. Don't put a long sleep in the same `javascript_tool` call as a `location.href` navigation. Do
   the navigation, then sleep in the NEXT call.
7. Reading component props off the DOM via `__reactFiber$` works only where a component boundary
   exists. The Forecast month row is inline JSX — the walk finds nothing. Read rendered text.
8. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth` (then "See Demo"
   again works). An HMR reload can land you on **Tre's real account** if signed in. **Read-only there.**
9. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
10. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
    `git commit -F -` works and is what I used. A `python - <<'EOF'` heredoc is the reliable way to
    do multi-point edits to a test file.
11. Dev server on **8080 with `--strictPort`**; up and serving fresh transforms as of this session.

## 6. CARRIED FORWARD, UNRESOLVED (from sessions 72–81)

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

## 7. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 8. FILES

- **`6368a3fd`:** `src/pages/Dashboard.tsx`, `src/lib/month0-budget-snapshot.ts`,
  `src/lib/__tests__/month0-budget-snapshot.test.ts`.
- **`6b6256c5`:** `src/lib/sync-cutoff.ts` (new), `src/lib/__tests__/sync-cutoff.test.ts` (new),
  `src/lib/forecast-engine.ts`, `src/hooks/useCardProjection.ts`,
  `src/contexts/CardProjectionContext.tsx`, `src/components/debt/CreditCardEngine.tsx`.
- **Backups:** `backups/2026-08-05_180704/` (all seven source files, pre-change).
- `npx tsc --noEmit` clean, `npx vitest run` **347/347 green**.
- **Not pushed.** 23 commits ahead of origin.

## 9. LESSONS WORTH KEEPING

- Session 79: *a UI showing a total it did not derive hides whatever it failed to model.*
- Session 80: *validate identifiers at the boundary; make the failure mode "no filter", not "filter
  everything".*
- Session 81: *when two surfaces disagree, line the two derivations up term by term in one table.*
  An absent row is the hardest discrepancy to see, and a table is what makes it obvious.
- **This session: a shared helper is only safe if every caller is asking the same question.**
  Collapsing four inline copies into one predicate closed §1.1 — but folding the settlement lag
  into the shared *date* silently changed the answer for income, a caller that was asking a
  different question ("has this happened yet?") than the outflow gates ("has this cleared yet?").
  347 green tests did not catch it; one live read of the Forecast table did, in ten seconds.
  **Before unifying, enumerate the callers and check they share the question — not just the shape.**
