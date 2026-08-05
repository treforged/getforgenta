# Handoff — 2026-08-05 — session 83 — branch `main` — cutoff sweep CLOSED

Continues session 82. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **29 local commits ahead**.

## 1. WHAT THIS SESSION DID: THE CUTOFF SWEEP IS FINISHED

Session 82's next-step 1 is **done**. Every month-0 OUTFLOW gate now shares one rule
(`isCapturedInBalance` in `src/lib/sync-cutoff.ts`). Three commits, each live-verified:

- **`0380d56d` (1/4) — CC-minimum gate.** `m0MinDueSettled` open-coded `dueDate <= syncCutoffDate`;
  now routes through `isCapturedInBalance`. Also collapsed the **two open-coded copies** of the same
  predicate — `month0-debt-breakdown.ts` and `CreditCardEngine.tsx` each re-derived the inverse
  (`dueDateStr > syncCutoffDate`), so the minimums they DISPLAYED could disagree with the minimums
  the engine RESERVED. §1.1 cause C in miniature.
- **`72455ec2` (2/4) — floor bill-reservation gate.** `getAugmentedMinSafeCash`'s `dueSynced` in
  `pay-schedule.ts`.
- **`309865d0` (3+4/4) — plan-installment cash gate + autopay-full zeroing.**
  `deriveUpfrontPlanFields`'s `upfrontPayByMonth` loop, and `useCardProjection`'s autopay $0
  recommendation.

Each inherits two things deliberately: the **settlement lag** (a debit inside the last 3 days is no
longer assumed settled, because `balances.current` excludes pending debits) and a **strict
boundary** (a charge due exactly ON the cutoff day stays reserved). Both err toward reserving cash
— reading cash LOW, the safe direction.

### Deliberately NOT swept — documented in place, do not "finish the job"

Two sites ask a **credit-card-balance** question, not a funding-cash question, so the outflow lag
does not belong there. Both now carry a comment saying so:

- `getUpfrontPlanProgress` (`payment-plan-generator.ts`) — counts installments PAID to size the
  remaining 0% principal on the CARD.
- `useCardProjection`'s plan-charge loop (~line 256) — grows a card balance.

This is session 82's lesson applied: **a shared helper is only safe where the callers ask the same
question.**

### Test changes were behavior pins, not goalpost moves

`cyclingFloor` is the one that moved a bound (560 → 530). Card A is due day 1 and that fixture's
`syncCutoffDate` **is** day 1, so its month-0 minimum used to be waived on the sync day itself —
unknowable. Correctly reserved now, which costs the save-up $200 and deepens that fixture's
already-documented bounded dip to 539. Recovery next month unchanged; the guard against the
~$120/$0 double-reservation bug still bites.

## 2. ⚠️ NEW ENVIRONMENT GOTCHA — THIS ONE ALMOST REVERTED A CORRECT CHANGE

**Reading the Dashboard or Forecast before the engine converges returns plausible-but-wrong
numbers.** Mid-settle, step 2 appeared to move Dashboard to **$2,701**, Forecast Aug END CASH to
**$2,873** (breaking the §1.1 invariant), income Aug $5,850 → $4,548 **and Sep $6,750 → $4,548**,
with a `1× +$173` badge — i.e. it looked exactly like the income regression session 82 warns about.
All of it was a partial render. With a **10–11 second** wait the same build reproduced the baseline
byte-for-byte.

Rules that follow:
- **Wait ~10s after "See Demo" and ~10s after each in-app nav click.** The 5–7s in session 82's
  notes is not enough now.
- **The tell that you read too early is an impossible result** — a month-0-only gate cannot change
  Sep income. If a change moves a month it structurally cannot reach, suspect the read, not the code.
- **Confirm a suspected regression by stashing the change and re-reading** before believing it.
  `git stash push <file>` → verify the served transform reverted via curl → re-read. That is what
  proved the demo is deterministic and the reading was the problem.

## 3. NEXT STEPS (in order)

1. **Forecast's stale floor copy — DIAGNOSED THIS SESSION, NOT YET FIXED. Start here; it is small.**
   `Forecast.tsx:827` renders "Cash floor raised to {max(cashFloor, prePaycheckBillsInfo.total)}"
   ($1,655) while the same page's popup reads Cash Floor **$2,402**. Root cause found:
   `useForecastEngineInputs.ts:72` sets
   `prePaycheckBillsInfo = getPrePaycheckNextMonthBills(rules, payConfig, forecastFundingAccountId)`
   — the **raw base bills only**. The floor the engine actually uses comes from
   `getAugmentedMinSafeCash`, which augments that base with car loans, vehicle insurance and CC
   minimums. So the milestone text shows the **un-augmented** total. Fix is to have the copy read
   the engine's augmented floor instead of re-deriving from the base — the same "a UI showing a
   total it did not derive" shape as §1.1. Live-check it (see §2 for wait times).
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
4. Remaining unblocked demo bugs: **§4.2** (allocation percentages sum to 146%, Remaining clamped
   to 0% instead of showing the −46% overspend), **§2.5** (Emergency Fund Dec 2028 on Goals vs
   Mar 2029 in Forecast — Goals appears to apply the Marcus 4.5% APY and Forecast does not),
   **§2.1 / §3.2 / §3.4** (income double-count, paycheck mis-categorised "Other", duplicate
   recurring rows — these three may be **demo-fixture** defects; check the fixture before coding).
5. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT
   answered.** Ask when it next comes up.
6. **§2.3 leftovers:** Debt tab's `$1,000` copy was not touched. **Settings exposes no cash-floor
   control at all**, contradicting Forecast's "your floor setting" copy — raise with Tre.
7. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
8. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data. **The sweep moves real numbers for any
   Plaid user** (3-day lag, strict boundary) — this walk matters more than it did. Note the demo
   could NOT positively exercise the CC-minimum gate: demo cards carry no `payment_due_day`, so
   `dueDay` is null and the gate short-circuits. Unit tests are its only positive verification.
9. Mobile/Capacitor viewport pass — not started.

## 4. LATENT DEFECT FOUND SESSION 82, STILL NOT FILED, NOT FIXED

`forecast-engine.ts:159` picks its starting `liquidBal` from `forecastFundingAccountId` with **no
account-type check** (`active.find(a => a.id === …)` — a savings account would be accepted), while
`useCardProjection.ts:135` resolves `resolveFundingAccountId(accounts, persistedDebtFundingId,
forecastFundingAccountId)`. Two consequences: (a) if the user picks a different debt-funding
account in the Debt tab, the engine still starts from the profile default; (b) the engine skips the
§2.8 type validation. Invisible in demo (the persisted id resolves to null, so both land on the
same account). Fix is to route the engine through `src/lib/funding-account.ts` too — but it moves
real numbers, so pair it with a live check.

## 5. ⚠️ ENVIRONMENT GOTCHAS (carried forward; §2 above is the new one and the most important)

1. **The dev server can serve a STALE transform and silently invalidate a live check.** Always
   confirm the served module before trusting a live verification:
   `curl -s "http://localhost:8080/src/<path>?t=$(date +%s)" | grep -c <something you just wrote>`.
   Fix: restart vite (`Stop-Process -Id <pid on 8080> -Force`, then `npm run dev`).
2. Landing CTA is **"See Demo"**. `find` + `computer left_click` does nothing; what works is
   `javascript_tool` → `[...document.querySelectorAll('button,a')].find(x=>/see demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,10000))`. Same trick for in-app nav
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
12. After a browser tool errors with "Couldn't determine which page this action targets", call
    `tabs_context_mcp` once and retry — the tab is still fine.

## 6. CARRIED FORWARD, UNRESOLVED (from sessions 72–82)

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

- **`0380d56d`:** `src/lib/credit-card-engine.ts`, `src/lib/month0-debt-breakdown.ts`,
  `src/components/debt/CreditCardEngine.tsx`, + 3 test files.
- **`72455ec2`:** `src/lib/pay-schedule.ts`.
- **`309865d0`:** `src/lib/payment-plan-generator.ts`, `src/hooks/useCardProjection.ts`.
- **Backups:** `backups/2026-08-05_184157/` (all six source files, pre-change).
- `npx tsc --noEmit` clean, `npx vitest run` **349/349 green**.
- `python -m graphify update .` run (15622 nodes / 112903 edges).
- **Not pushed.** 29 commits ahead of origin.

## 9. LESSONS WORTH KEEPING

- Session 79: *a UI showing a total it did not derive hides whatever it failed to model.* (Next
  step 1 is another instance of exactly this.)
- Session 80: *validate identifiers at the boundary; make the failure mode "no filter", not "filter
  everything".*
- Session 81: *when two surfaces disagree, line the two derivations up term by term in one table.*
- Session 82: *a shared helper is only safe if every caller is asking the same question.* Applied
  this session to STOP a sweep at two sites rather than finish it uniformly.
- **This session: when a live check reports a regression, check the measurement before the code.**
  A mid-settle read produced a coherent, believable, entirely fake regression — right down to the
  specific badge session 82 taught me to watch for. What exposed it was an *impossible* detail: a
  month-0 gate cannot move September. Stash-and-re-read is the cheap confirmation, and it takes
  under a minute.
