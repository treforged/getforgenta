# Handoff — 2026-07-16 — main

## Q7 RESOLVED (live-verified 2026-07-16)

VX missed its full Jan 2029 statement (paid $50 of $300, $4.79 interest Feb).

**Root cause:** `CardProjectionContext.projectionAssumptions` omitted `promotions`, so the SIM
never saw the scheduled 2027-02-25 salary promotion ($70k) while the ENGINE did. From m7 the sim
underestimated income, its floor look-ahead throttled debt payments into save-up mode (base
payoff 13 → 36 months), and convergence settled on a degenerate fixed point where VX's mandatory
cycling payment demoted to the $25 min m24–m30 and Step-5 shorted the Jan 2029 statement.

**Fix:** one line — thread `promotions: assumptions.promotions` into projectionAssumptions
(CardProjectionContext.tsx). Backup: backups/2026-07-16_003600/.

**Offline repro required closing two more harness fidelity gaps** (now supported via
`ProjectionHarnessOverrides` in fixtures/projection-harness.ts):
- `paymentPlans` — live passes usePaymentPlans() rows; fixtures never captured them. Saved to
  gitignored `fixtures/forecast-inputs.real.payment-plans-2026-07-16.json` (numeric amounts!).
- `persistedDebtFundingId` — localStorage `tre:debt:fundingAccount` =
  `933cbc10-bceb-4c20-8227-4a02e6db728a`.
With those + promotions stripped from sim assumptions, harness base matched live base EXACTLY
(saveUp, payoffM 36, mand arrays, debtPaymentTotals) and convergence reproduced the m30 $50
payment bit-for-bit. (Live capture's maxDebt "0"s are JSON-serialized Infinity — not real zeros.)

**Regression test:** forecast-convergence.promoParity.test.ts — behavioral (VX never carries
cycling backlog/interest in any month on the live 2026-07-16 fixture) + static tripwire (context
source must thread promotions). Full lib suite green (34 files / 155 tests).

**Live verification (localhost:8080/debt):** converged 12 passes, VX pays $300 every month,
zero backlog anywhere; UI Jan 2029 shows full -$300; Debt tab ETA 12 mo; Q6 acceptance (PV Mar
2028 $831 statement paid in full, no 2028 backlog) and Q5 acceptance (PV Jul 2026 $0 / Aug 2026
$1,165 ISB pin) both intact.

## NEXT TASK: Prime Visa "TOTAL INTEREST $132,107" card header (Q8)

Still absurd post-Q7 (was $132,085). PV is ISB-pinned ($1,165 manual), header also shows
MIN PAYMENT $0, INTEREST/MO $0.00, "Interest-free: N/A". Handoff hypothesis: display calc in
CreditCardEngine projections vs sim — possibly projectCardVariable flat-APR walk on an
ISB-pinned card whose displayed payment never amortizes the balance, so interest accrues for
the whole horizon. Investigate at the display layer; the sim/engine numbers live are sane.

## GOTCHAS (carry forward)

- `window.__simDebug.raw` is PASS-0, not converged; use `__convergenceDebug.convergedProjection`.
- `cp.cards[].id` empty on converged projection — look up via perCardPayments by name.
- Debt page is `/debt`; dev server localhost:8080 (DEV server, not prod).
- vitest: `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored (`forecast-inputs.real*.json`). Never push.
- Supabase user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
