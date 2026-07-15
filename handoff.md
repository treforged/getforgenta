# Handoff — 2026-07-14 ~21:30 — main

## ACTIVE TASK: Q4 investigation (continued from 16:45 handoff)

## MAJOR FINDINGS THIS SESSION (live, 2026-07-14 evening data)

1. **Fallback hypothesis DISPROVEN for today's data — but confirmed as the intermittent
   mechanism.** Added dev-only `window.__convergenceDebug` (CardProjectionContext.tsx, after
   the convergence memo): live shows `converged: true, passes: 15, usedFallback: false`.
   `maxPasses` default is **18** (forecast-convergence.ts:48 — the handoff's "12" was stale).
   So today the loop converges at 15/18 and Debt tab shows **PAYOFF ETA 32 mo** (not 12!),
   vs forecast payoff 38 — the "36 vs 12" split is gone today. Yesterday's data evidently
   pushed the ISB-pin oscillation past 18 passes → silent base-pair fallback → 12-vs-36.
   The loop running at 15/18 means small data shifts flip the UI between two regimes.
   **Robustness, not correctness, is the fix target.**

2. **The long payoff (38 mo) is the save-up cap machinery, mostly legitimate.**
   `saveUpMonths` = {13,15-21,23-24,26-27,29,33} with `maxDebtPaymentByMonth` ≈ $222
   (Discover min). Reasons (`saveUpReason`): reserving for Venture X mandatory statements —
   $300/mo recurring + **$2,738 April 2028** (m21). Total revolving drops to $1,870 by m13
   then rebounds/stalls at $2-3k until m37. This IS the original Q4 "Feb–Jun 2028
   underpayment" window. Checked the classic double-count: CC-sourced rules ARE excluded
   from cash expenses (useCardProjection.ts:165), so no naive double-count found. Post-Q5
   the extra ~$4.8k real PV debt makes the reserve directionally legitimate; whether the
   look-ahead over-reserves (netAtMin too pessimistic) is still OPEN.

3. **Aug 2026 floor breach ($2,461 vs $2,800) persists.** Forecast Aug: income 4,496,
   out 4,835 (incl. CC $471), so it pays only $471 CC vs the sim's mandatory 1,165 (ISB pin)
   + 222 (Discover min) = 1,387 — engine floor-clips a payment the sim treats as mandatory,
   AND still ends below floor. July ends exactly at floor ($2,800) so no room to pre-save.
   Partly real post-Q5 tightness; the engine/sim disagreement about Aug's mandatory outflow
   is the Q4-adjacent bug (engine's cash walk models $471 out; reality per sim is $1,387).

4. **Root cause of the pin oscillation (mechanism confirmed in code):**
   credit-card-engine.ts:1365 `availableCash = max(mDebtTarget - pinnedStep5Total, totalMins)`
   — engine's floor-clipped Aug value comes back as target, pin pays 1,165 regardless →
   payment↔clip two-cycle, damped 0.5 → slow decay (gaps 2320→1732→1069→875→505…).

## CHANGE MADE THIS SESSION (committed, UNPROVEN as a pass-count fix)
Implemented the 16:45 handoff's proposed fix — exclude manual-ISB pinned months from
convergence target feedback (like m0's NaN anchor):
- `debt-model-types.ts`: new optional `manualIsbPinMonths?: number[]` on CardProjectionResult.
- `useCardProjection.ts` (before hookResult): computes it mirroring the engine's
  manualStatementByCard eligibility (statement pref + statementBalance != null + balance > 0
  + not future-start; dueMonth = dueDay >= today ? 0 : 1; keeps only >0).
- `forecast-convergence.ts`: `pinnedMonths` set → target[m] = NaN for pinned months (both
  raw and damped branches).
- `CardProjectionContext.tsx`: dev-only `__convergenceDebug` useEffect (keep — cheap).

**RESULT: did NOT reduce passes.** q4-diagnostic dueMonth=1 still 13 passes (converged,
Jun 2027, breach Mar 2027 — identical to before the fix). Gap trace shows oscillation is at
m6–m9 and m20 (targets swinging 4009→765→2151→3099), NOT at the pinned m1: the pin's cash
error propagates into later months' engine cash walk, and THOSE months' feedback oscillates.
All 3 tests pass (m0 scenario: 5 passes; realData baseline: unchanged) — change is additive
and harmless, kept as semantically-correct groundwork, but the real lever is elsewhere.
⚠️ Not yet verified that `manualIsbPinMonths` actually populates in the diagnostic run
(fixture card must map account `statement_balance` → CardData.statementBalance with
paymentPreference==='statement'); verify with a console.log before trusting the negative.

## NEXT STEPS (in order)
1. Verify the exclusion actually bit: log `base.manualIsbPinMonths` in the diagnostic. If
   empty → fix the population (check how the hook builds CardData.paymentPreference /
   statementBalance from the fixture account), re-measure.
2. If it bit and passes stay 13: the oscillation driver is the ENGINE side — its Aug cash
   walk models $471 CC out while the sim spends $1,387 (finding 3). Fix candidate: engine
   must treat pinned ISB amounts as mandatory (like cycling statements / minimums) in its
   cash walk instead of floor-clipping them — that removes the inconsistency feeding
   m6–m9's oscillation AND makes the Aug floor row honest (breach may grow — it's real).
   Files: forecast-engine.ts (where revolvingDebtCash/floor clip happens, ~PASS 2/3);
   needs `manualIsbPinMonths`+amounts threaded in (extend the new field to carry amount).
3. Then re-examine the save-up over-reserve question (finding 2) — is netAtMin in
   floor-protection.ts too pessimistic post-Q5 (payoff 38 vs debt-tab 32 residual gap)?
4. Recapture fixture from live post-Q5 data (statement_balance + PV min $0) so offline
   matches live exactly — fixture-io helper exists; fixture stays gitignored; repo PUBLIC.
5. Original Q4 Feb–Jun 2028 symptom: reassess after 2-3; likely the same save-up caps.

## Carry-over guardrails / gotchas
- Dev server: `npm run dev` on :8080. Browser tab was tabId 1527577946 (re-run
  tabs_context_mcp after /clear — IDs go stale).
- `__convergenceDebug` (converged/passes/usedFallback) now exists on the Debt page, DEV only.
- vitest hides console.logs by default — use `--disable-console-intercept` to see the
  diagnostic traces.
- Q5 acceptance re-verified today: PV Jul "—", Aug −$1,165, all intact.
- ctrl+a+type into month-payment inputs APPENDS — use form_input.
- Repo PUBLIC — never commit real financial data. Supabase: always filter
  user_id a72f416e-433a-4055-9ab0-9feae4e60edf. Never push. Backups per CLAUDE.md
  (this session's: backups/2026-07-14_212415/).
- Anomaly A (floor clamp at mandatory obligation) + Anomaly B (pin flips all rows to local
  sim) still await Tre's design ruling — see 16:45 handoff content in git history
  (f4f90234) for full detail.
