# Handoff — 2026-08-05 — session 84 — branch `main` — three UI-vs-engine disagreements closed

Continues session 83. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **32 local commits ahead**.

## 1. WHAT THIS SESSION DID — three commits, one theme

All three are the same defect shape: **a surface showing a number it did not derive.** Session 79's
lesson, now hit for the third session running. Worth treating as the default hypothesis whenever two
surfaces disagree.

- **`0bcf0ed1` — Forecast's stale floor copy (session 83's next-step 1). LIVE-VERIFIED.**
  The "Cash floor raised to …" banner re-derived its total from `getPrePaycheckNextMonthBills`
  (raw base bills) while the engine's floor comes from `getAugmentedMinSafeCash` (base + car loans
  + vehicle insurance + CC minimums). Banner said $1,655; the popup on the same page said $2,402.
  Now reads month 0's engine row (`projections.data[0]`: `monthMinSafe` / `settingsCashFloor` /
  `floorItems`). Demo now shows **$2,402 = 1600 Rent + 55 Gas + 537 RAV4 loan + 210 RAV4
  insurance**, and the two missing chips appear. Display-only: Forecast Aug END CASH and Dashboard
  MONTH-END CASH both still **$2,883** (§1.1 invariant holds).

- **`ca1536ae` — Budget allocation donut (§4.2). LIVE-VERIFIED, on REAL data.**
  Legend clamped Remaining with `Math.max(0, remaining / income)`, so an over-allocated month
  printed five shares summing to 146% with `Remaining (0%)`. The donut had the matching flaw: a
  segment past 100% wrapped back over arcs already drawn, making over-allocation look *smaller*.
  Extracted the arithmetic to **`src/lib/budget-allocation.ts`** (`getBudgetAllocationShares` +
  `clipSegment`, 9 unit tests incl. the exact 146% shape) — it was inline JSX in a 1400-line page
  and therefore untestable. Remaining now renders signed and red; the ring **clips** at the full
  circle; a red line states the overspend in dollars.
  **Tre's decision (asked this session):** ring keeps meaning *share of take-home* and clips —
  chosen over rescaling it to share-of-spending. Don't re-litigate.

- **`b80b381d` — Goal completion milestone (§2.5). NOT live-verified — see §3 step 1.**
  Goals' "Est. completion" uses `estimateGoalCompletionMonths` (monthly compounding, lump sums,
  start date); Forecast's "<goal> Complete!" re-derived it as a straight line, no interest, no
  lump sums. Dec 2028 vs Mar 2029 on a goal earning Marcus's 4.5%. Extracted the APY rule to
  `getGoalEffectiveApyPercent` (savings-growth.ts) and pointed both at it; the engine now
  precomputes each goal's completion index and fires the milestone there. `resolvedGoals` gained
  `resolvedContributionStartDate` + `effectiveApyPercent`. **Milestones are display-only — moves
  no cash.**

### ⚠️ §4.2's headline number no longer reproduces — and that matters

Demo Debt now reads **23%, not 77%**, and the five shares sum to exactly 100%. An earlier fix
(most likely §1.2's $2,673 debt-payment discrepancy) corrected it. The clamp was still a genuine
defect, just **latent**. Generalize: **site-walk findings from 08-04 may already be fixed by later
commits — re-observe before coding.**

### ⚠️ FINDING FOR TRE, not a bug: his real budget is over-allocated

The live check landed on his real account (see §5.8) and it exercises the over-budget branch the
demo cannot: Fixed 52 + Variable 14 + Debt 40 + Transfers 2 = **108%**, `Remaining (−7%)`,
**"Over budget by 7% of income ($324/mo more allocated than you take home)"**. Until this commit
that read `Remaining (0%)`. Ring measured 51.50 + 13.94 + 34.56 = 100.00 exactly, Debt clipped
from 39.86, Transfers and the negative Remaining not drawn — so the fix is verified on the real
path. **Check it against §2.4 (three competing expense definitions) before calling it a true
overspend.** Raise with him either way.

## 2. HOW TO LIVE-CHECK (session 83's §2 rules held up perfectly — keep them)

- **Wait ~10–11s after "See Demo" and ~10s after each in-app nav click.** Reading mid-settle
  returns plausible-but-wrong numbers — session 83 nearly reverted a correct change over it.
- **The tell that you read too early is an impossible result.** If a change moves a month it
  structurally cannot reach, suspect the read, not the code.
- **Confirm a suspected regression by stashing the change and re-reading** before believing it.
- Confirm the dev server is serving your edit first:
  `curl -s "http://localhost:8080/src/<path>?t=$(date +%s)" | grep -c <something you just wrote>`.

## 3. NEXT STEPS (in order)

1. **Live-verify `b80b381d` (§2.5). Start here; it is one read.** Open Goals, note Emergency Fund's
   `Est. completion`; open Forecast, find the `… Emergency Fund Complete! 🎯` milestone. They must
   now name the **same month** (expect Goals' Dec 2028 to win, since it was the one already
   compounding). Vacation Fund must still read Nov 2027 on both (zero-APY control — if that one
   moves, the change is wrong). Also worth adding: `getGoalEffectiveApyPercent` has **no unit
   test**; it was a pure extraction, but pin it.
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
   collides here. Needs `/multi-plan` before any file is touched. **This is what retires the whole
   date heuristic in `sync-cutoff.ts`** — when transaction sync lands, "captured iff a settled
   transaction matches it" should REPLACE the lag, not tune it.
4. Remaining demo bugs: **§2.1 / §3.2 / §3.4** (income double-count, paycheck mis-categorised
   "Other", duplicate recurring rows). These three may be **demo-fixture** defects — check the
   fixture before coding, and re-observe first (see §1's warning about stale findings).
5. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT
   answered.** Ask when it next comes up. §1's over-allocation finding is a reason to ask sooner.
6. **§2.3 leftovers:** Debt tab's `$1,000` copy was not touched. **Settings exposes no cash-floor
   control at all**, contradicting Forecast's "your floor setting" copy — raise with Tre.
7. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
8. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data. Session 83's cutoff sweep moves real
   numbers for any Plaid user (3-day lag, strict boundary). Note the demo could NOT positively
   exercise the CC-minimum gate: demo cards carry no `payment_due_day`, so `dueDay` is null and the
   gate short-circuits. Unit tests are its only positive verification.
9. Mobile/Capacitor viewport pass — not started.

## 4. LATENT DEFECT FOUND SESSION 82, STILL NOT FILED, NOT FIXED

`forecast-engine.ts` picks its starting `liquidBal` from `forecastFundingAccountId` with **no
account-type check** (`active.find(a => a.id === …)` — a savings account would be accepted), while
`useCardProjection.ts:135` resolves `resolveFundingAccountId(accounts, persistedDebtFundingId,
forecastFundingAccountId)`. Two consequences: (a) if the user picks a different debt-funding
account in the Debt tab, the engine still starts from the profile default; (b) the engine skips the
§2.8 type validation. Invisible in demo (the persisted id resolves to null, so both land on the
same account). Fix is to route the engine through `src/lib/funding-account.ts` too — but it moves
real numbers, so pair it with a live check. **Line number moved this session — grep, don't trust it.**

## 5. ⚠️ ENVIRONMENT GOTCHAS (carried forward; all still accurate)

1. **The dev server can serve a STALE transform and silently invalidate a live check.** Confirm the
   served module before trusting a live verification (curl recipe in §2). Fix: restart vite
   (`Stop-Process -Id <pid on 8080> -Force`, then `npm run dev`).
2. Landing CTA is **"See Demo"**. `find` + `computer left_click` does nothing; what works is
   `javascript_tool` → `[...document.querySelectorAll('button,a')].find(x=>/see demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,11000))`. Same trick for in-app nav
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
   instead — that always works. **Reading `.split('\n')` and slicing an index range is fine**, and
   is what every recipe here does.
6. Don't put a long sleep in the same `javascript_tool` call as a `location.href` navigation. Do
   the navigation, then sleep in the NEXT call.
7. Reading component props off the DOM via `__reactFiber$` works only where a component boundary
   exists. The Forecast month row is inline JSX — the walk finds nothing. Read rendered text.
8. **Demo state is in-memory. An HMR reload lands you on Tre's real account if signed in — this
   happened again this session.** Check before interpreting numbers:
   `/demo/i.test(document.body.innerText.slice(0,600))` — false means real account. **Read-only
   there.** It is also the ONLY way to exercise branches the demo persona doesn't hit (that is how
   §4.2's over-budget path got verified), so it is useful, not just a hazard.
9. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
10. **Don't put a PowerShell here-string in a compound `;`-chained command.** Bash heredoc +
    `git commit -F -` works and is what I used for all three commits this session.
11. Dev server on **8080 with `--strictPort`**; up and serving fresh transforms as of this session.
12. After a browser tool errors with "Couldn't determine which page this action targets", call
    `tabs_context_mcp` once and retry — the tab is still fine.

## 6. CARRIED FORWARD, UNRESOLVED (from sessions 72–83)

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
8. `python -m graphify update .` **not run this session** (context gate). Run it next session — two
   new files landed (`src/lib/budget-allocation.ts` + its test).

## 7. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 8. FILES

- **`0bcf0ed1`:** `src/pages/Forecast.tsx`.
- **`ca1536ae`:** `src/pages/BudgetControl.tsx`, **new** `src/lib/budget-allocation.ts`,
  **new** `src/lib/__tests__/budget-allocation.test.ts`, `site-walk-findings.md`.
- **`b80b381d`:** `src/lib/forecast-engine.ts`, `src/lib/savings-growth.ts`,
  `src/pages/SavingsGoals.tsx`.
- **Backups:** `backups/2026-08-05_185630/` (all five source files, pre-change).
- `npx tsc --noEmit` clean, `npx eslint` clean, `npx vitest run` **358/358 green** (349 + 9 new).
- **Not pushed.** 32 commits ahead of origin.

## 9. LESSONS WORTH KEEPING

- Session 79: *a UI showing a total it did not derive hides whatever it failed to model.*
- Session 80: *validate identifiers at the boundary; make the failure mode "no filter", not "filter
  everything".*
- Session 81: *when two surfaces disagree, line the two derivations up term by term in one table.*
- Session 82: *a shared helper is only safe if every caller is asking the same question.*
- Session 83: *when a live check reports a regression, check the measurement before the code.*
- **This session: a stale bug report is as misleading as a stale measurement.** §4.2's headline
  (146%, Debt 77%) had already been fixed by an unrelated commit; coding against the report instead
  of re-observing would have chased a number that no longer existed. Re-observe, then fix what is
  actually still broken — which here was the *latent* clamp underneath, worth fixing on its own.
- Corollary, three sessions running: when two surfaces disagree, **the one that re-derives is the
  one that's wrong.** All three fixes this session were "point the display at the derivation that
  already exists" — never "write new math".
