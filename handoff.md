# Handoff — 2026-07-11 (session 3) — branch main — Discover 2yr-payoff: LIVE DATA PULLED, harness half-built

## STATUS
Symptom root cause narrowed further. **All live Supabase rows pulled** (user not home to log in, so
went headless via Supabase MCP). Diagnostic instrumentation added to floor-protection.ts (dev-only,
UNCOMMITTED — must be reverted before any real fix ships). Headless repro harness NOT yet built.
NO fix applied yet.

## THE TASK (unchanged)
Discover CC pays off ~2yr+ out (CC Debt Free Jun 2029, ETA 36mo) on Debt Payoff + Forecast while cash
balloons to $18k (floor only $2,800). Payments stuck near CC minimums (~$570/mo) across 2027–2028
instead of scaling up to kill Discover. Root cause suspected in the save-up look-ahead
(computeFloorProtection reserveNeeded, src/lib/floor-protection.ts) OR in the inputs fed to it
(expenseByMonth/floorByMonth overstating outflow → phantom reserve). Prior sessions ruled out: merge,
stale deploy, surplus-gate (revBal0 gate). HEAD live = cc6d7cbc.

## SESSION 3 — WHAT I DID
1. **Instrumented computeFloorProtection** (src/lib/floor-protection.ts, before the final `return`):
   pushes a dev-only dump to `globalThis.__floorDumps` with startingBalance, ccMinTotal,
   incomeByMonth, expenseByMonth, oneTimeNetByMonth, carDownPaymentByMonth, floorByMonth, netAtMin,
   reserveNeeded, maxDebtPaymentByMonth, saveUpMonths, strictSaveUpMonths. tsc clean.
   **THIS IS TEMP — revert it (backup at backups/2026-07-11_090803/src/lib/floor-protection.ts) before
   shipping any fix.**
2. Started dev server `npm run dev` (port 8081; 8080 was already in use) — user couldn't log in.
3. **Pulled ALL live rows via Supabase MCP** (project mdtosrbfkextcaezuclh, user
   a72f416e-433a-4055-9ab0-9feae4e60edf). Saved to scratchpad:
   - `scratchpad/live-rows.json` — full profile (incl. forecast_assumptions, cash_floor 2800,
     paycheck_deductions, paycheck_rule_id, default_deposit_account 933cbc10…).
   - `scratchpad/accounts.json` — all 12 accounts verbatim.
   - `scratchpad/misc-rows.json` — debts(2), car_funds(1, w/ 24 lumps), savings_goals(4),
     budget_items(1), payment_plans(4).
   - `scratchpad/txns-rules.json` — 20 transactions verbatim; **recurring_rules NOT saved (re-pull —
     see SQL below), 30 rows, need full columns.**
   Scratchpad dir: `C:\Users\tvonh\AppData\Local\Temp\claude\C--Users-tvonh-Desktop-getforgenta\b28cf834-0cce-4498-8417-3e17f2ce81b0\scratchpad`

### Re-pull SQL (recurring_rules — the one file I didn't finish saving)
```sql
select coalesce(json_agg(r),'[]') from recurring_rules r
where r.user_id='a72f416e-433a-4055-9ab0-9feae4e60edf';
```

## SMOKING GUN IN THE DATA (new this session — explains a LEGIT-but-overestimated reserve)
- **Income cliff:** rule "GF Half of Rent/Groceries" = +$1,100/mo income, **end_date 2027-08-31**.
  So liquid income drops $1,100/mo starting Sep 2027 (~m14, projection starts Jul 2026 = m0).
- **Promotion** to $70k gross effective 2027-02-25 (~m7) raises the paycheck (partly offsets cliff).
- **Car cost ramp:** loan $422.89/mo (payment_start 2026-08-07) + insurance $173.23/mo + 24× $150
  lump_sum_payments Oct 2027 (m15) → Sep 2029 (m38), all on funding acct 933cbc10.
- Weekly Paycheck rule (id 3a30b089) $848.89/wk net; Rent $1,915/mo; groceries $300 ends 2026-12-31.
- These create genuine tightness after m14 → a REAL reserveNeeded seed. Question is whether
  floor-protection back-propagates it into a wildly-too-large reserve (~$15k) that caps Discover
  payments for 20+ months while real cash balloons to $18k. The $18k real cash vs the cap staying at
  minimums is the tell: reserveNeeded is being over-estimated OR expenseByMonth is overstated.

## MECHANISM ANALYSIS (high-confidence reasoning, still needs the dump to confirm)
floor-protection.ts math is internally consistent for its stated invariant: reserveNeeded[m] =
max(0, floor[m+1]+reserveNeeded[m+1] - (floor[m]+netAtMin[m])); forward pass caps debt so endBal ≥
floor[m+1]+reserveNeeded[m+1]. KEY: if the forward-pass cash balloons (netAtMin>0), reserveNeeded
should DECAY backward to ~0 → no cap. Observed (cap active + cash at $18k) is only possible if
reserveNeeded[m+1] ≈ bal−nextFloor ≈ $15k. For reserveNeeded to reach $15k, cumulative future
netAtMin must be ≈ −$15k — which CONTRADICTS cash ballooning. **Therefore the arrays
computeFloorProtection sees (expenseByMonth) very likely OVERSTATE real outflow vs the engine's own
month rows (double-count savings/car-contrib/lump-transfer/cycling), producing a phantom reserve
while the engine's real ending cash grows.** If confirmed, fix is in the input construction at
forecast-engine.ts:928-941 (expenseByMonth = baseData.map(... monthlySavingsContrib + getMonthCarContrib
+ activeCarLoanByMonth + getMonthVehicleInsurance + getMonthProjLoan + mortgage + monthTransfers +
lumpTransferByMonth + cyclingByMonth)), NOT the floor-protection algorithm. CONFIRM with the dump
first — do not assume.

## NEXT STEP — build the headless harness (no browser needed) and read the dump
useForecastEngineInputs (src/hooks/useForecastEngineInputs.ts) builds the full ForecastInputs from
raw rows via useSupabaseData hooks. Plan for a TEMP test `src/lib/__tests__/discdiag.tmp.test.ts`
(@vitest-environment jsdom, must DELETE after — never ship):
1. `vi.mock('@/hooks/useSupabaseData', ...)` returning the scratchpad rows for useDebts, useSavingsGoals,
   useCarFunds, useAccounts, useBudgetItems, useProfile, useRecurringRules, useTransactions,
   usePaymentPlans (each as `{ data: rows }`; useProfile also needs `{ update: { mutate: () => {} } }`).
2. Pin Date to 2026-07-11 (vi.useFakeTimers toFake:['Date']).
3. Build config exactly like CardProjectionContext.tsx:104-165:
   - payConfig = buildPayConfig(profile)  (import from '@/lib/pay-schedule')
   - cashFloor = 2800; forecastFundingAccountId = '933cbc10-bceb-4c20-8227-4a02e6db728a'
   - assumptions = { ...DEFAULT_ASSUMPTIONS, ...profile.forecast_assumptions } (DEFAULT_ASSUMPTIONS is
     defined in CardProjectionContext.tsx:17-24; export or copy it)
   - pauseSavings = false; debtStrategy = 'avalanche'; syncCutoffDate = '2026-07-11'
   - projectionAssumptions per CardProjectionContext:146-165; debtPayoffOptions {strategy:'avalanche',
     paymentMode:'variable', cashFloor:2800, overrides:{}}
   - scheduledEvents = generateScheduledEvents(rules, accounts, PROJECTION_MONTHS)
4. renderHook(useCardProjection, {rows+config as props}) → base (matches realData test harness at
   src/lib/__tests__/forecast-convergence.realData.test.ts:71-92).
5. renderHook(useForecastEngineInputs, {cardProjectionData: base, assumptions, pauseSavings, payConfig,
   cashFloor, forecastFundingAccountId, syncCutoffDate, scheduledEvents, debtPayoffOptions}) → engineInputs.
6. runDebtCashConvergence(base, engineInputs, { engine: calculateForecast }).
7. `writeFileSync(scratchpad + '/floordump.json', JSON.stringify(globalThis.__floorDumps))` — console.log
   is swallowed by the test runner; write to file. Also dump out.projections.milestones.
8. **FIDELITY ORACLE:** run must reproduce CC Debt Free ≈ Jun 2029 (payoff 36mo) + cash ballooning.
   If it does, repro is faithful → inspect floordump.json: find months where strictSaveUpMonths is set
   and maxDebtPaymentByMonth ≈ ccMin while reserveNeeded is large; compare expenseByMonth vs the
   engine's actual per-month cash outflow (out.projections.data[m]) to prove/deny the double-count.
9. Once proven: fix at the correct layer (input construction OR reserve math), back up the file to
   ./backups/, preserve the legit save-up-before-real-breach behavior, keep full suite green
   (43 files/163 tests) + tsc clean. Do NOT push.

## Key anchors
- src/lib/floor-protection.ts:76-198 computeFloorProtection (+ TEMP dump before return ~L198).
- src/lib/forecast-engine.ts:928-941 PASS-2 computeFloorProtection call (expenseByMonth build = suspect input).
- src/hooks/useForecastEngineInputs.ts:329 engineInputs assembly.
- src/contexts/CardProjectionContext.tsx:104-197 config derivation (payConfig/cashFloor/funding/assumptions).
- src/lib/forecast-convergence.ts runDebtCashConvergence.
- Harness pattern to copy: src/lib/__tests__/forecast-convergence.realData.test.ts:41-104.
- Backup of clean floor-protection.ts: backups/2026-07-11_090803/src/lib/floor-protection.ts

## Rules
- Never push without explicit ask. Cash floor $2,800. Back up any file before editing to ./backups/.
- Repo is PUBLIC — the scratchpad rows contain real personal finance data; keep them in scratchpad,
  never commit them. discdiag.tmp.test.ts must be deleted before finishing (never ship in src/).
- Kill the background dev server (task bvkrg2h4l) when done.
