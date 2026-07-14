# Handoff — 2026-07-14 ~afternoon — main

## Status
Q5 (manual interest-saving-balance semantics) is **live-verified** in the browser against
Tre's real data. Anomaly A decisive test **done** — it's a floor clamp, characterized below.
Graphify updated (no diff). Two NEW findings on the Forecast page need Tre's ruling before
any further engine work.

## Q5 live verification — PASSED (Debt tab, all acceptance items)
- PV header balance $6,004; TOTAL CC BALANCE $14,453; utilization 31.8%. ✓
- "$1,165 manual" ISB badge intact. ✓
- PV monthly projection: Jul 2026 payment "—" ($0), Aug −$1,165 (exact ISB), no interest
  lines in Jul/Aug (grace held); Sep shows +$11.24 interest (grace ends after ISB month —
  by design, old full-statement rule resumes). ✓
- Discover Aug payment pulled back to its $222 contract min (was funding PV's ISB). ✓
- Month-0 rec for PV = $0 on both the Debt-page strip and Dashboard. ✓ (amount right;
  label shows "Saving for Aug 7th" / "Minimum payment" instead of "Statement paid this
  cycle" — the reason string isn't threaded to those components; cosmetic.)
- Leftover Oct pin from the 07-13 session: already gone on arrival (no Revert All shown).

## NEW FINDINGS — Forecast page regressions vs pre-Q5 (A/B tested, decisive)
Method: temporarily copied backups/2026-07-14_102854 engine over src, hard-reloaded
(vite needed a `touch` + ctrl-shift-R to pick it up), compared, then `git checkout --`
restored Q5. Both states confirmed live via TOTAL CC BALANCE (9,614 pre / 14,453 post).

1. **Aug 2026 floor breach $339** (was the predicted "≤$25 dip"): Forecast shows Aug end
   cash $2,461 vs $2,800 floor, milestone "⚠️ Cash below safe minimum". Pre-Q5: $3,115,
   no warning. Forecast's Aug "CC $406" ≠ debt-tab Aug payments ($1,165+$222=$1,387) —
   the forecast-adjusted CC pipeline disagrees with the debt sim about Aug.
2. **"CC Debt Free" milestone gone**: pre-Q5 forecast said May 2027 debt free;
   post-Q5 `__simDebug.raw.forecastRevolvingPayoffMonth = 36` (~Jul 2029) while the debt
   tab still says PAYOFF ETA 12 mo. The two pipelines diverge hard post-Q5. Also a new
   "May 2027 ⚠️ cash below safe minimum" (end cash $2,799 — $1, Q2-class noise).
   Q4-adjacent (same statement-vs-balance code in the forecast-side resim).
Direction is partly legitimate (real $6,004 vs the old phantom $1,165 = $4.8k more debt →
later payoff, tighter cash), but the floor is supposed to be enforced and the 36-vs-12
divergence is not explainable by that alone. **Needs Tre's call / dedicated investigation
(fold into Q4).**

## Anomaly A — RESOLVED to a characterization (Tre's design call pending)
Decisive test done with form_input (atomic set, no appended-digit artifact):
- Pin PV Oct = 100 → row renders **−$511 "edited"** (clamped UP to $510.50 = the month's
  mandatory cycling obligation; same constant as `paymentLedger[].cycling`).
- Pin PV Oct = 1032 (natural value) → honored exactly, −$1,032. ✓
So: **floor clamp at the mandatory cycling payment, not a cap**. Pre-Q5 "139" was the same
clamp with the old statement-split math. Plausibly by design (pin can't go below the
contractual statement obligation), but the UI showing "edited $511" after typing 100 is
confusing at minimum. Options for Tre: (a) accept + show a "raised to obligation" hint,
(b) let pins go below obligation (breaks grace/contract modeling), (c) clamp silently but
toast the adjustment. Pins fully reverted after the test (Revert All clicked, verified).

## Anomaly B — unchanged, still needs Tre's ruling
ANY pin flips ALL rows (even pre-pin months) to the local overrideSim basis — observed
again during the test (Sep changed from −$511 to −$1,012 the moment Oct was pinned).
Options: (a) accept + UI note, (b) always local sim on Debt tab, (c) thread overrides
through convergence (previously rejected as risky).

## Remaining queue
1. Forecast findings 1+2 above — fold into Q4 investigation (cycling card not paying full
   statement in later years; screenshot Feb–Jun 2028; suspects: Step-2 pool
   double-reserve, maxDebtPaymentByMonth save-up cap with allRevolvingClear; reproduce
   WITHOUT overrides; lean-fix flow). Note `maxDebtPaymentByMonth` is null for m0–m12 in
   __simDebug — that itself may be a clue.
2. Anomaly A + B design decisions — waiting on Tre.
3. Cosmetic backlog: rec reason string not threaded ("Statement paid this cycle" never
   shown); PV "TOTAL INTEREST $132,134" (runaway min-payment stat with $0 min payment —
   pre-existing?); Dashboard "Due 1th" typo.

## Carry-over guardrails / gotchas
- ctrl+a+type into month-payment inputs APPENDS — use form_input (confirmed good today).
- `window.__simDebug.raw` ignores overrides — UI rows are ground truth under pins.
- vite on :8080 didn't hot-pick a `cp` overwrite of credit-card-engine.ts — needed
  `touch` + hard reload; verify which engine is live via TOTAL CC BALANCE.
- Repo PUBLIC — never commit real financial data.
- Supabase: always filter user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Never push. No amend/rebase. Backups before source edits per CLAUDE.md.
