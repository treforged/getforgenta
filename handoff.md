# Handoff — 2026-08-05 — session 80 — branch `main` — §2.8 closed

Continues session 79. `site-walk-findings.md` (repo root, committed) is still the source list.
**Read it before touching anything.**

## 0. GOAL

Tre: "continue working all issues. and fix demo findings." then "sequence as u see fit."
Standing constraint: **do not delete his account.** Nothing is pushed — **20 local commits ahead**
(`git rev-list --count origin/main..HEAD`).

## 1. DONE THIS SESSION (1 commit, local, NOT pushed)

### ✅ `a2d73f6a` — §2.8 closed, live-verified; §2.9 recorded; §1.1 re-measured

**Root cause (this is the reusable part): the debt funding account id lives in localStorage
(`tre:debt:fundingAccount`) and was never validated against the account list.** The key held
`933cbc10-…`, a **real account UUID from Tre's own data**, and demo mode reads the same key — so
`persistedDebtFundingId` named an account that does not exist in the current data set, and
`persistedDebtFundingId || forecastFundingAccountId` let the stale id always win.

Every consumer asks "is this expense paid from the funding account?", so an id matching nothing
makes every answer *no* and **all cash expense rules dropped out of the engine at once**: month-0
expenses read $0 with bills visibly due, and the cash floor collapsed to its base $1,500. The
balance term hid it — `debtFundingBalance` falls back to *total liquid cash* when the account isn't
found ($4,100 rather than Chase Checking's $2,800), so the total looked plausible while its inputs
were wrong. Watch for the two guard styles that made this asymmetric:
`if (id && srcId !== id) return false` excludes **everything** on a bad id, while
`if (!id) return false` excludes **nothing** — same stale value, opposite behavior, same engine.

- **New `src/lib/funding-account.ts`** — one rule. `resolveFundingAccountId(accounts, ...candidates)`
  returns the first candidate that is an **active account of a fundable type**
  (`FUNDING_ACCOUNT_TYPES` = checking/business_checking/cash), else **`null`**. `null` means *no
  exclusion*: bills get counted, never silently dropped. Keep that direction.
- Applied in `useCardProjection.ts` (~line 128), `CreditCardEngine.tsx` (had its own copy of the
  resolution + a `<select>` displaying a value it wasn't using) and `CardProjectionContext.tsx`.
- **The persisted localStorage value is deliberately NOT rewritten** — self-healing writes would let
  opening the demo overwrite Tre's real saved choice. Validation is read-side only. Don't "improve"
  this into a write.

**Verification:** `npx tsc --noEmit` clean, `npx eslint` clean on all touched files,
`npx vitest run` **336/336 green** (72 files, +18 new). The new hook test was **confirmed RED**
against the old resolution (a $1,800 bill vanished; balance read $3,500 instead of $3,000).
**Live in demo:** `Bills still coming $645` now renders, floor $1,500 → $2,402,
`BILLS THIS MONTH` $11,025 → $5,434 (the old figure was inflated by the same asymmetry).

## 2. NEXT STEPS (in order)

1. **§1.1 — highest severity, still open, now has a concrete lead.** Re-measured live today:
   Dashboard `MONTH-END CASH $5,833` vs Forecast `Aug 2026 END CASH $2,346` — **$3,487 apart**
   (originally ~$3,300, so §2.8 moved both pages but did not close this).
   **The lead:** `Dashboard.tsx:587` builds `monthEndCash` as
   `fundingBalance + remainingTxIncome − remainingTxExpenses − remainingTxDebt − planCashThisMonth`
   — i.e. the **transaction-merge** engine (`getRemainingTransaction*`). The comment at
   `useCardProjection.ts:374-383` records that the engine **deliberately abandoned exactly that
   source** in favour of `forecastMonthEvents[0]`, because the two disagree. Dashboard's month-end
   tile is the last consumer still on the old path. Also check `Dashboard.tsx:581` — `fundingBalance`
   uses Dashboard's own `fundingAccountId`, which may still be the §2.3 class of defect for this
   tile specifically (§2.3 fixed the floor row and popover, not this).
   **Second, smaller thread:** Forecast still says the floor was "raised to **$1,655**" while the
   engine's floor row now reads **$2,402**. $747 does not explain $3,487, so expect **two causes**.
2. **§2.9 (NEW, needs Tre's decision, don't code it blind)** — car-fund earmark can exceed the
   account it is earmarked from. Demo now shows `Balance on hand $0` while Chase Checking holds
   $2,800, because `getCarFundEarmark` (`vehicle-loan-engine.ts:183`) earmarks the Civic's
   `current_saved` $3,200 against `linked_account: 'd1'` and the balance clamps at 0. Two tangled
   things: a **demo-fixture defect** (persona "saved" $3,200 into an account holding $2,800 — it was
   presumably meant to sit in Marcus HYS) and a **modeling gap** (no check the saved cash is
   actually in `linked_account`; the shortfall is silently clamped instead of surfaced).
3. **§1A Plaid auto-pull + rule matching** — Tre's request, still not started, still next in line
   after §1.1. His decision is final: **a matched actual overrides the rule ONLY for the month it
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
4. Remaining unblocked demo bugs: **§4.2** (allocation percentages sum to 146%, Remaining clamped to
   0% instead of showing the −46% overspend), **§2.5** (Emergency Fund Dec 2028 on Goals vs Mar 2029
   in Forecast — Goals appears to apply the Marcus 4.5% APY and Forecast does not), **§2.1 / §3.2 /
   §3.4** (income double-count, paycheck mis-categorised "Other", duplicate recurring rows — these
   three may be **demo-fixture** defects rather than code; check the fixture before writing code).
5. **§2.4 (three expense definitions) is the one canonical-definition question Tre has NOT answered.**
   Ask when it next comes up.
6. **§2.3 leftovers:** Debt tab's `$1,000` copy was not touched. **Settings exposes no cash-floor
   control at all**, contradicting Forecast's "your floor setting" copy — raise with Tre.
7. **§2.7** RAV4 double representation — decision input for the open `car_funds` question. Any fix
   must pick one source of truth per vehicle, never sum both.
8. Full real-data walk. Budget and Debt were spot-checked on real data in session 77 and agree;
   Forecast, Goals, Transactions never walked on real data.
9. Mobile/Capacitor viewport pass — not started.

## 3. ⚠️ ENVIRONMENT GOTCHAS

1. **🆕 The dev server can serve a STALE transform and silently invalidate a live check.** After the
   fix, the demo still rendered the old numbers; `fetch('/src/hooks/useCardProjection.ts')` did not
   contain the new symbol. **Always confirm the served module before trusting a live verification**:
   `await fetch('/src/<path>?t='+Date.now()).then(r=>r.text())` and grep it for something you just
   wrote. Fix is to restart vite (`Stop-Process -Id <pid on 8080> -Force`, then `npm run dev`).
2. The landing-page CTA is **"See Demo"**, not "Try Demo" (the old handoff's string no longer
   matches). `find` + `computer left_click` still does nothing; what works is
   `javascript_tool` → `[...document.querySelectorAll('button,a')].find(x=>/see demo/i.test(x.textContent)).click()`
   then `await new Promise(r=>setTimeout(r,5000))`. Same trick for in-app nav (`querySelectorAll('a')`
   + exact text match), which also keeps demo state alive.
3. Don't put a long sleep in the same `javascript_tool` call as a `location.href` navigation — the
   evaluation dies with "Inspected target navigated or closed". Navigate, then act in a second call.
4. `javascript_tool` returning a long `|`-joined string gets `[BLOCKED: Cookie/query string data]`.
   Return a structured array instead (e.g. `.map(d => d.innerText.split('\n'))`) — that works fine.
5. Reading component props off the DOM via `__reactFiber$` + walking `.return` and checking
   `memoizedProps` WORKS. Walking `memoizedState` to find a hook's return value **does not** — don't
   burn turns on it.
6. **Demo state is in-memory.** A hard `navigate` drops it and bounces to `/auth`. An HMR reload also
   drops it and can land you on **Tre's real account** if the browser is signed in.
   **Read-only there. Do not write, and do not delete his account.**
7. `npx vitest run --reporter=basic` fails on vitest 4.1.10 (`basic` was removed). Use `npx vitest run`.
8. **Don't put a PowerShell here-string in a compound `;`-chained command.** Write the commit message
   to a scratchpad file and `git commit -F`. (Bash heredoc + `git commit -F` works.)
9. Dev server on **8080 with `--strictPort`**; restarted this session and currently up.

## 4. CARRIED FORWARD, UNRESOLVED (from sessions 72–79)

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

## 5. MEASUREMENT ARTIFACT — do not "fix"

The landing page looks blank in automation screenshots: the driven tab is
`document.visibilityState === "hidden"`, so `requestAnimationFrame` never fires, framer-motion never
runs, and every `initial={{opacity:0}}` stays invisible (verified `rafFired: false`).
**Use `get_page_text` / DOM reads, never screenshots, to judge this app under automation.**

## 6. FILES

- **New:** `src/lib/funding-account.ts`, `src/lib/__tests__/funding-account.test.ts`,
  `src/hooks/__tests__/useCardProjection.staleFundingId.test.ts`.
- **Modified:** `src/hooks/useCardProjection.ts`, `src/components/debt/CreditCardEngine.tsx`,
  `src/contexts/CardProjectionContext.tsx`, `site-walk-findings.md`.
- **Backups:** `backups/2026-08-05_085526/` (three source files, pre-change).
- **Not pushed.** 20 commits ahead of origin.

## 7. LESSON WORTH KEEPING

Session 79's lesson — *when a UI shows a total it did not derive, it hides whatever it failed to
model* — paid out within one session: the computed-residual row is what made §2.8 visible at all.

This session's is about **where the bad value came from**. An id in localStorage is not data; it
outlives the thing it names, and it is shared across data sets the user can switch between (real ↔
demo). The engine trusted it, and because "is this paid from the funding account?" is asked in a
dozen places, one unvalidated string silently deleted **every expense in the model** while every
total on screen stayed plausible. The general rule: **validate identifiers at the boundary where
they enter the model, and make the failure mode "no filter" rather than "filter everything."** Ask
of any persisted id — what happens when it names nothing?
