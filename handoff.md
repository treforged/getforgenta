# Handoff — 2026-07-19 (session 5) — Q12 fixed on branch, BLOCKED on payment-cap undershoot

## State: main clean at 55f24e06. Q12 work committed on branch `q12-floor-cutoff` (5998c911).

Main is untouched and green. Do NOT merge the branch yet — see the blocker below.

## Q12: RESOLVED (code + tests), NOT MERGEABLE

Branch `q12-floor-cutoff`, commit `5998c911`. The handoff-3 diagnosis was correct line-for-line.

- Extracted `getNextMonthPrePaycheckCutoff(config, now)` → `{ nextMonthStart, nextMonthEnd,
  effectiveCutoff }` in `src/lib/pay-schedule.ts`. `getPrePaycheckNextMonthBills` now calls it
  (verified byte-neutral: full suite unchanged after the extraction alone).
- `getAugmentedMinSafeCash` calls the same helper and applies `duePostPaycheck(dueDay)` to all
  three loops (car loan, car insurance, both CC branches). Compares **Dates**, not raw day
  numbers, so a last-day-of-month paycheck and the no-paycheck `fullMonthCutoff` fallback need no
  special case; `dueDay` is clamped to next month's length so a day-31 obligation can't roll past
  the cutoff and silently vanish.
- New suite `src/lib/__tests__/pay-schedule.floorPrePaycheckCutoff.test.ts` (6 tests) covers each
  loop excluded post-paycheck, all three included pre-paycheck, and the due-ON-paycheck-day edge.
- Three existing suites were re-pinned by **moving fixture due days pre-paycheck**, NOT by
  changing expected numbers — their intent (insurance anchoring, card_start_date gating, backlog
  accounting) is preserved and the cutoff is tested in its own file. pay-schedule: 20/20 green.

Live effect confirmed on the real fixture: Aug 2026 `floorItems` lose the day-7 car loan
(422.89), car insurance (173.23) and PV min, floor 3807.59 → 2800 base.

## BLOCKER: pre-existing payment-cap undershoot, exposed (not caused) by Q12

Full suite with Q12 applied: **207/212**, 5 failures in 3 files (goldenTierA,
forecast-convergence.realData, forecast-convergence.manualISB). Left deliberately un-re-pinned —
re-pinning would encode a real floor breach as expected. Tre decided: **fix the cap first, then
merge Q12 and re-pin once against correct behavior.**

Measured on `forecast-inputs.real.json` (m0 = Jul 2026):

| | Aug ending cash | augmented floor | base floor | breach milestone |
|---|---|---|---|---|
| pre-fix  | 2967 | 3269 | 2800 | none |
| post-fix | 2574 | 2670 | 2800 | **Aug 2026** |

- The engine lands **below the augmented floor in BOTH runs** ($302 under pre-fix, $96 under
  post-fix). The undershoot is pre-existing; the inflated floor merely kept cash above the $2,800
  base so it never tripped the milestone.
- The breach milestone (`forecast-engine.ts:1317`) compares against `cashFloor` — the **base**
  user setting (destructured :136, aliased `settingsCashFloor` :1386) — NOT `monthMinSafe`. It is
  also **edge-triggered** (fires only if the previous month was ≥ floor), which is why pre-fix
  Aug breached silently.
- Convergence also slowed: realData 11 → 14 passes; manualISB 18 vs its `≤12` pin. Still
  converges, payoff still Jun 2027 in both.

### What is NOT the problem
PASS-3's target feedback is sound. `step3DrainTo = max(b.monthMinSafe, baseData[i+1].monthMinSafe)
+ FLOOR_CUSHION_DOLLARS` (`forecast-engine.ts:1135-1144`) and post-fix months 2 and 3 land at
**exactly 2802.00** — floor + cushion, working as designed. Only Aug is stuck low.

### Leading hypothesis (UNVERIFIED — do not treat as fact)
`forecast-engine.ts:1160` says that when the revolving target is already 0 and cash is still under
the floor, the deficit is *structural* and the milestone correctly stands. So Aug's extra ~$393 of
spend is likely **mandatory**, which PASS-3 cannot claw back by design. Suspected mechanism: the
floor no longer covers the day-7 PV minimum → `ccRevolvingMinIncluded` drops → `simulateVariablePayoff`'s
`reservedForRevolving` reserves it instead → mandatory pool grows. That is exactly the
double-reservation seam `pay-schedule.ccRevolvingMinIncluded.test.ts` exists to guard.

### Next diagnostic (start here)
Instrument `simulateVariablePayoff` for m1 with and without the branch applied, and print:
mandatory pool size, `reservedForRevolving`, `ccRevolvingMinIncluded`, and the per-card forced
payments. Confirm whether Aug's revolving target actually reaches 0 (structural) or whether the
deficit branch is being outrun by a growing mandatory pool. That single comparison decides between
"floor and reservedForRevolving must net to the same dollars" (accounting fix) vs "the cap needs a
hard clamp at monthMinSafe" (engine fix).

Use `--silent=false --reporter=verbose` — vitest hides console.log on PASSING tests, which cost
time this session.

## Still queued (untouched)

- **Anomaly A** — pin clamp UX: show effective value + inline note instead of a negative delta.
  UI-only, no engine change, no goldens. Smallest item; good filler session.
- **Anomaly B** — route `overrideSim` through `runDebtCashConvergence` (`CreditCardEngine.tsx:760`,
  :908-915, :973). Engine-layer, needs goldens.

## Gotchas (carry forward)

- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- SIM = `__convergenceDebug.convergedProjection`; ENGINE rows = `.forecastResult.data[]`;
  milestones live on `forecastResult`, not convergedProjection.
- Floor composition is on each row as `floorItems` + `prePaycheckBillsTotal` — use it, don't
  reconstruct by hand.
- vitest failure details on STDERR — use Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- Manual-min cards can have $0 contract revolving min (PV) — that's why Q10's engine-side fixes
  hit starvation branches.
- `getActiveCarLoanPayments` reads `expected_apr`, NOT `interest_rate` — a CarFund test fixture
  missing it silently yields NaN payments.
- Pre-existing and untouched: `dueSynced` builds its date from the CURRENT month (`m0MonthStr`)
  while the floor's semantics are next-month obligations. Orthogonal to Q12, left alone.
