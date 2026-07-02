# Unified Forecast Engine — Staged Plan (for review)

> STATUS: PLAN ONLY. No engine code changes until this is approved. Working tree is at the
> stable baseline (Forecast "CC Debt Free = Jun 2027" renders correctly). Dev server on
> http://localhost:8080.

## 1. Why we're doing this

Today the app runs **several independent month-by-month cash simulations over the same data**:

- **Forecast page** — the authoritative walk (PASS 1/2/3) inside the `projections` useMemo in
  `src/pages/Forecast.tsx` (~lines 1250–1760). Produces ending cash, floor, per-card adjusted
  balances, step-3 surplus, and the "CC Debt Free" milestone.
- **`useCardProjection` hook** — a *separate* PASS-3 (`src/hooks/useCardProjection.ts`, the
  `pass3RevTotals` walk ~1160–1240) that mirrors Forecast but is not identical.
- **Debt Payoff, Goals, AI Advisor** — consume bits of the above.

Because Forecast's authoritative numbers live *inside the Forecast component*, other surfaces
can only match Forecast **after Forecast has been mounted** (it publishes
`forecastStep3ExtraByMonth` to context on render). Before that, Debt Payoff falls back to the
hook's approximation, which diverges.

**The target** (your architecture):

```
            calculateForecast(inputs)  ← ONE projection engine
                        │
   ┌───────────┬────────┴────────┬───────────────┬────────────────┐
Forecast   Debt Payoff       Savings Goals    AI Advisor    Future planning
```

One pure engine, every surface reads it, no visit-order dependency, one place to fix bugs.

## 2. Evidence on your real data (captured 2026-07-01, baseline)

| Surface | What it shows | Notes |
|---|---|---|
| Forecast | **CC Debt Free = Jun 2027** | Trusted anchor (best current accuracy) |
| Debt Payoff (fresh, no Forecast visit) | **Payoff ETA = 59 mo**; Prime Visa line rises to ~$14k then crashes | The visit-order bug + suspected Prime Visa mis-model |
| Forecast Feb 2027 | End Cash **$3,463** | Below that month's floor (~$3,575) once Feb pet-insurance annual bills are added |

## 3. Known accuracy concerns to resolve (NOT just the visit-order bug)

You've flagged that prior "alignment" fixes may have drifted the numbers themselves — so the
current baseline is the *best available* anchor, **not** automatically ground truth. Concrete
items to nail down before/while extracting:

1. **Prime Visa `upfront` installment plan (HIGH).** `payment_plans` row "Car Amazon Starter
   Pack": total **$4,210**, **$350.83/mo × 12**, interest-free, `plan_type='upfront'`, start
   2026-06-23. Prime Visa balance is **$4,308.43** — i.e. almost the entire balance is this
   0%-APR, fixed-payment installment. The engine appears to treat the whole balance as revolving
   at **27.49% APR**, which overstates interest, mis-times payoff, and likely causes the rising
   Prime Visa chart line. Correct model: carve the plan sub-balance out of the card, amortize at
   the fixed plan amount/month over its term at **0% interest**; only the remaining balance
   accrues APR.
2. **`monthly_charge` plans.** "payback to mom" ($285/mo × 4) and "Bucket Seats" ($404.25/mo × 4)
   are recurring *charges/expenses* over their term (not part of current balance) — must be
   modeled as scheduled outflows, distinct from `upfront`.
3. **Two-model divergence.** Forecast's PASS-3 and the hook's PASS-3 differ structurally
   (Forecast has the `hookScaledTotal` preference, save-up `revolvingCap`, `adjustedRevBal`
   tracking; the hook is a simplified mirror). This divergence is the root of "Debt Payoff only
   matches after visiting Forecast."
4. **Venture X mandatory statement (late 2028).** Forecast's save-up cap (PASS-3, ~line 1442)
   throttles the mandatory cycling statement to ~0 once revolving debt is gone → statement not
   paid in full despite ample cash. Fix once, on the unified engine.
5. **Feb 2027 floor breach.** Mid-month annual bills (pet insurance $583 + Pettable $100, due
   Feb 21) aren't pre-saved for; the reserve can only throttle debt to the CC minimum. Confirm
   affordability, then extend the reserve to bank for annual/lump mid-month outflows.
6. **Discover chart artifact (Apr 2031).** Cycling branch reads `cyclingOwedByMonth[m]` (next
   cycle), so the terminal backlog element lands on the second-to-last chart bucket. Fix in the
   chart/series layer once the engine is unified.
7. **Post-payoff out-year balloon (HIGH — new, from 2026-07-01 chart).** All four cards pay to
   ~$0 by early 2027 (correct, matches CC Debt Free Jun 2027), but every card's projected balance
   then **ramps up steadily from ~2029 → 2031** (Discover ~$18k, Prime Visa ~$9k, Venture X ~$4k)
   before crashing to $0 at the final bucket. This is systematic, not the single terminal artifact
   in §3.6: once a cycling card is "paid off," its new-purchases/statement (and any `cyclingBacklog`)
   accumulate un-paid in the out-years, so the trajectory shows growing phantom debt. Root-cause in
   the cycling model (are post-payoff statements being funded each cycle? is backlog compounding
   without paydown?), then fix once on the unified engine. Likely interacts with §3.4 (mandatory
   statements) and §3.1 (Prime Visa plan).

## 4. Target engine shape

`src/lib/forecast-engine.ts`

```
export interface ForecastInputs {
  accounts, debts, recurringRules, carFunds, goals, paymentPlans,
  assumptions, payConfig, cashFloor, syncCutoffDate,
  cardProjection /* raw sim balances from credit-card-engine */, now,
}
export interface ForecastResult {
  months: ForecastMonth[];              // ending cash, floor, income/out, oneTime, breakdowns
  perCardAdjustedRevolving: Map<string, number[]>;
  step3ExtraByMonth: number[];          // cumulative surplus (today's revolving3Extra)
  ccDebtFreeMonthIndex: number | null;  // the milestone
  milestones: Milestone[];
}
export function calculateForecast(inputs: ForecastInputs): ForecastResult
```

Pure, deterministic, no React. Consumed via the existing `CardProjectionProvider` (or a new
`ForecastProvider`) so it runs once per data change regardless of active route.

## 5. Staged execution (each stage independently verifiable)

### Stage 0 — Establish the TRUE baseline (no code moves)
- **History bisect (read-only):** walk `git log` on `Forecast.tsx` + `useCardProjection.ts`
  across the recent alignment series (`6746a6e → ae7a691 → 5e03fa2 → d514a59 → ad16ff6`),
  reconstruct the CC-Debt-Free/End-Cash numbers at each, and pinpoint where drift entered. Output:
  a short table "commit → CC Debt Free date / notable number" so we know whether to extract from
  HEAD or an earlier cleaner state, and whether any commit is worth reverting on its own.
- **Hand-verified anchors (you):** you confirm a small set of figures as *correct* (not just
  "matches current"): CC Debt Free month; End Cash for ~4 representative months incl. Feb 2027;
  each card's payoff month and the avalanche order; Prime Visa interest total (should be ~$0 on
  the installment portion). These become the test assertions.

### Stage 0 — FINDINGS (2026-07-01, read-only)

Commit classification across the recent alignment series (newest first):

| Commit | Touches | Affects Forecast's OWN numbers? |
|---|---|---|
| `ad16ff6` use hook forecastAdjustedRevolvingBalances directly | hook (4 ln) | No — Debt Payoff feed |
| `d514a59` compute forecastStep3ExtraByMonth in hook | hook + Forecast (−9) | Mostly plumbing |
| `5e03fa2` align Debt Payoff per-card labels/ETA | Forecast (+9) | Display alignment |
| `ae7a691` align Debt Payoff chart/labels | hook (+23) | No — Debt Payoff feed |
| **`6746a6e` align Forecast CC balance *display* with step-3 model** | **Forecast (40 ln)** | **YES — prime suspect** |
| **`8864486` route surplus to Discover via `adjustedRevBal`** | **Forecast (40 ln)** | **YES — changed surplus routing + CC-Debt-Free milestone condition** |
| `7cd610e` / `6cca345` / `051da61` CC Debt Free milestone timing | Forecast/hook | Milestone month only |
| `bf99d87` model installment as look-ahead expense; `b5e3bf9` cap installmentBalance at live Plaid balance | Forecast | **Existing installment logic — relevant to §3.1 Prime Visa** |

Key takeaways:
- The two commits that most plausibly drifted Forecast's *own* displayed numbers are **`8864486`**
  (replaced the `virtualRevBal` surplus cap with `adjustedRevBal = ccEngRevBalEnd −
  cumulativeStep3Extra`, and changed the CC-Debt-Free milestone to fire on `adjustedRevBalFinal <= 0`)
  and **`6746a6e`** (Forecast CC balance display vs step-3 routing). `8864486` fixed a real
  surplus dead-lock, so it's likely net-correct, but it is where the routing/milestone model
  changed — the first place to diff numbers against your trusted anchors.
- **There is already installment handling** (`bf99d87`, `b5e3bf9`) that models an installment as a
  look-ahead expense capped at the live Plaid balance. The Prime Visa concern (§3.1) is likely that
  this existing path does NOT read the `payment_plans` `upfront` row ($4,210 @ $350.83/mo, 0%) — it
  keys off `accounts.installment_balance`, which is **null** for Prime Visa. So the 0% installment
  is being treated as ordinary 27.49% revolving. Confirm in Stage 5.
- A full numeric bisect (exact CC-Debt-Free per commit) needs the app run against your data at each
  commit — deferred unless your anchors disagree with HEAD, in which case we `git bisect` to the
  offending commit.

### Stage 1 — Golden-reference test (safety net)

**Hand-verified anchors (confirmed by user 2026-07-01):**

*Tier A — invariants the CURRENT engine already gets right; extraction (Stage 2) must preserve:*
- **CC Debt Free month ∈ Apr–Jun 2027.** (Set by Discover clearing — see below. Today shows Jun
  2027, the late edge; correcting Prime Visa may pull it earlier within the window.)
- **Per-card payoff order: Prime Visa → Venture X → Apple Card → Discover.**
  - Venture X and Apple Card are **already free** (balance $0 → payoff month 0).
  - **Prime Visa is statement-preference**, mostly the 0% Amazon installment (clears early).
  - **Discover it Card is the LAST revolving card to clear, in Apr–Jun 2027** → this sets CC Debt Free.

*Tier B — TARGET behavior the current engine FAILS; these assertions pass only after Stage 5 fixes
(they define "correct," and document the known current gaps):*
- **Feb 2027 End Cash ≥ that month's floor** (must be *higher* than today's $3,463 after properly
  saving for the Feb pet-insurance annual bills). §3.5.
- **Prime Visa interest ≈ $0 on the $4,210 Amazon installment** — modeled as flat **$350.83/mo × 12
  at 0%**; only the ~$98 remainder + new purchases revolve at 27.49%. §3.1 / §3.2.

**Test mechanics / chicken-and-egg:** the engine isn't callable in a test until Stage 2 extraction
exists, so Stage 1 defines these as executable assertions written **test-first at the start of
Stage 2** against `calculateForecast()`. Tier A must pass immediately after the pure extraction
(proves no drift); Tier B stays red until its Stage-5 fix lands (guards the bug fixes). Build the
fixture from the user's real data shape (accounts/debts/recurringRules/carFunds/goals/paymentPlans
per the live Supabase snapshot).

### Stage 2 — Pure extraction, ZERO behavior change
- Lift Forecast's PASS 1/2/3 walk and its helper closures verbatim into `calculateForecast()`.
- Forecast calls the engine and renders its result. Output must be **byte-identical** to today's
  baseline (diff against golden fixture). This is the highest-risk stage — done in isolation, no
  logic edits, reviewed on its own.

### Stage 3 — Wire Debt Payoff to the engine
- Debt Payoff consumes `calculateForecast()` via the provider → matches Forecast with no visit
  dependency. The 59-mo ETA becomes Jun 2027. Verify both tabs match on a cold load.

### Stage 4 — Retire duplicates
- Remove the hook's separate PASS-3, `forecastStep3ExtraByMonth` context plumbing, and Forecast's
  mount-effect publish. One code path remains.

### Stage 5 — Fix the real bugs ONCE, on the unified engine
- (a) Prime Visa `upfront` installment modeled interest-free (§3.1).
- (b) `monthly_charge` plans as scheduled outflows (§3.2).
- (c) Venture X mandatory statement funded before save-up cap (§3.4).
- (d) Feb 2027 reserve for mid-month annual/lump outflows (§3.5).
- (e) Discover chart terminal-artifact fix (§3.6).
- Each guarded by the golden test + its own targeted assertion.

### Stage 6 — Wire Goals + AI Advisor to the engine
- Point remaining surfaces at `calculateForecast()`; delete their ad-hoc projections.

## 6. Risks & guardrails
- **This is the app's most delicate code.** Every stage is a separate, reviewable change with the
  golden test as the gate; no "big bang."
- **Backups + local commits per stage** (`./backups/TIMESTAMP/…`), no push.
- **Web + mobile (Capacitor)** share this logic — verify both.
- If any stage can't reproduce the anchors, we stop and reconcile before proceeding.

## 7. Open questions — RESOLVED (2026-07-01)
1. **Anchors:** ✅ CC Debt Free Apr–Jun 2027; payoff order Prime → Venture X → Apple → Discover
   (VX/Apple already free; Discover last, Apr–Jun 2027); Feb 2027 should be *higher* (save for pet
   bills). Recorded in Stage 1.
2. **Prime Visa:** ✅ $4,210 @ flat $350.83/mo × 12 at 0%; remainder + new purchases revolve at
   27.49%. Root cause identified: existing installment path reads `accounts.installment_balance`
   (null for Prime Visa), not the `payment_plans` `upfront` row.
3. **Scope:** ✅ Stage 0 done (this doc). Next: Stage 2 extraction as a dedicated, focused session.

## 8. Recommended next session (Stage 2 kickoff)
Start fresh (this planning session's context is large; the 500-line extraction of the most delicate
code deserves a clean budget). First actions next session:
1. Backup + branch. Write the Tier-A golden test against the `calculateForecast()` signature (fails
   to compile until the function exists — test-first).
2. Pure-extract Forecast's PASS 1/2/3 into `src/lib/forecast-engine.ts`; make Forecast call it;
   confirm Tier-A green + byte-identical output vs baseline. Commit.
3. Only then Stage 3 (wire Debt Payoff), Stage 4 (retire duplicates), Stage 5 (the five bug fixes,
   each flipping its Tier-B assertion green).
