# Handoff — 2026-07-20 (session 8) — Q12 merged+pushed, fixture recaptured, Anomaly A done; NEXT: Anomaly B

## State: on `main`, all committed, main is IN SYNC with origin through `e59efd46`; two later local commits (Anomaly A `64a1182b` + this handoff) NOT pushed — push only when Tre asks

## Done this session
1. **maxPasses 18→24** (`8cf8fe6c`, forecast-convergence.ts:48) — Tre's decision on the Q12
   convergence-margin question. Observed pass counts unchanged.
2. **Q12 merged to main** (`a08eb34b`), branch `q12-floor-cutoff` deleted, main pushed.
3. **Golden fixture recaptured live** (capturedAt 2026-07-20T21:59:45Z) from
   `window.__convergenceDebug.engineInputs` on localhost:8080 (blob-download → moved into
   `src/lib/__tests__/fixtures/forecast-inputs.real.json`; old one kept as
   `forecast-inputs.real.bak-2026-07-15.json`). It now carries `paymentPlans` (4 rows) natively —
   the harness `loadRealPaymentPlans()` fallback is dormant. Live convergence took 17 passes
   (under the new 24 budget). Only pin that moved: goldenTierA Jun 2029 → **Jul 2027**
   (`e59efd46`) — the embedded cardProjectionData is now the live CONVERGED sim, so the raw
   single-pass agrees with the converged pins. 212/212 green.
4. **Anomaly A shipped** (`64a1182b`): CreditCardEngine.tsx accordion month rows — when a pin is
   clamped, detail column shows "Pinned $X raised to this month's required payment" (or
   "reduced to available cash"). Live-verified: PV Aug 2026 pin $100 → −$511 edited + note.
   Test pin reverted via Revert All. Tre chose this option (vs toast / allow-below) explicitly.

## NEXT: Anomaly B (approved by Tre this session — implement, don't re-ask)
Route `overrideSim` through `runDebtCashConvergence`. Today `CreditCardEngine.tsx:760` builds
`overrideSim = variableSim.runSim(overrides)` (single-pass) and :908-916/:972-973 switch ALL rows
to it when any pin exists — pinned projections show single-pass numbers while unpinned show
converged ones (the Q4 divergence class). Pointers:
- `runDebtCashConvergence(cardProjection, engineInputs, opts)` lives in
  src/lib/forecast-convergence.ts; CardProjectionContext.tsx:206-216 is the reference caller.
- CreditCardEngine gets its converged data via props (perCardPayments/perCardPaymentsScaled/
  monthly* maps from DebtPayoff.tsx ← CardProjectionContext). overrideSim is the component's own
  LOCAL sim — the design question is where convergence runs: probably rebuild a
  CardProjectionResult-shaped object around runSim(overrides) and feed it through
  runDebtCashConvergence with the same engineInputs the context uses (may need engineInputs as a
  new prop or via context). paymentOverridesByMonth must survive resim passes —
  check resimulateWithDebtCash threading in useCardProjection.ts.
- Needs goldens re-check + live verify (pin a month, confirm pinned + unpinned rows both shift
  to converged basis and reconcile).
- Backup dir for this session's files already exists: backups/2026-07-20_181416 (has
  CreditCardEngine.tsx, useCardProjection.ts, forecast-convergence.ts pre-Anomaly-A).

## Also queued (unchanged)
- Optional hardening (discuss first): sim/engine cash-walk divergence warning; Step-5 drain
  clamp for ISB-pinned months (pinned months get NaN targets BY DESIGN, forecast-convergence.ts:61-66).

## Gotchas (carry forward)
- backups/ untracked — never git add. Repo PUBLIC — real fixtures gitignored. Never push unless asked.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf; always filter by it.
- Q9 display coloring SETTLED (current-month floor) — don't re-propose next-month.
- vitest hides console.log on passing tests — `--silent=false --reporter=verbose`; failures on
  STDERR → Bash 2>&1, not PowerShell.
- FLOOR_CUSHION_DOLLARS must stay ≥ convergence toleranceDollars (2 ≥ 1).
- otherAccountExpense suite runs on the REAL clock — assertions must stay cumulative/clock-robust.
- Payoff pins are Jul 2027 everywhere now (incl. goldenTierA as of `e59efd46`).
- manualISB test titles still say "(2026-07-15)" but the clock derives from the fixture's own
  capturedAt (now 07-20) — titles are cosmetically stale, assertions correct.
- Dev server localhost:8080 has Tre's logged-in session; browser tab from this session may still
  be open on /debt.
