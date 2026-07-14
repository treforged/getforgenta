# Handoff — 2026-07-14 ~10:35 — main

## Goals
1. ~~Q5: fix manual interest-saving-balance semantics~~ — **CODE DONE + tests green this
   session (182/182 vitest, tsc clean). NOT yet verified live in the browser.**
2. Live-verify Q5 against Tre's acceptance numbers (below), then resume the previous
   queue: Anomaly A decisive test, revert leftover Oct pin, Anomaly B options to Tre,
   `python -m graphify update .`, Q4 investigation. (See "Next Steps".)

## What Q5 was (Tre's authoritative ruling)
- Prime Visa TOTAL balance = $6,004; `statement_balance` 1164.79 = amount due at the NEXT
  due date only (PV due day 7). NOT the card's balance.
- Expected: Jul 2026 payment $0 (due day passed), Aug pays exactly 1164.79, Discover's Aug
  payment pulls back to fund it, floor holds. DB value 1164.79 is correct — interpretation
  was fixed, data untouched.

## What was changed this session (all committed)
Plan: `.claude/plan/interest-saving-balance-semantics.md` (full design + rationale).
Backup: `backups/2026-07-14_102854/src/lib/credit-card-engine.ts`.

`src/lib/credit-card-engine.ts` (only source file changed):
1. `buildCardData` (~:238): removed `simBalance` substitution — `balance` stays the real
   balance; `autopayFullBalance = balance <= 0`; `statementBalance` passed through.
2. Grace inits (projectCard ~:272, projectCardVariable ~:394, sim graceMap ~:834): also in
   grace when `statementBalance != null`.
3. New `manualStatementByCard` map in `simulateVariablePayoff` (after graceMap init):
   `dueMonth = dueDay >= today ? 0 : 1`; synthetic pin 0 before dueMonth, = ISB at dueMonth.
4. Pin-resolution block (~:975): merged synthetic pins with user overrides (user wins);
   loop now runs when either exists.
5. Step-6 grace update (~:1550): m<dueMonth → grace persists; m==dueMonth → grace iff
   pay ≥ ISB; else old full-statement rule.
6. `generateRecommendations`: `manualStmtDueNow` helper — month-0 rec = $0 if due passed
   ("Statement paid this cycle") else exactly ISB ("Pay interest-saving balance"); no
   extra-cascade cash; totalMinDue uses min(minPayment, obligation).

New tests: `src/lib/__tests__/credit-card-engine.manualStatementBalance.test.ts` (8 tests,
frozen clock 2026-07-14). Covers: Jul $0 / Aug exact ISB, cycling-card pullback, grace
held (no interest m0-m2), real-balance walk, dueDay-not-passed → month-0 payment,
user-override-wins, buildCardData mapping.

## Key discovery (documented in the pullback test)
When the competing cycling card's statement is pulled back, the shortfall becomes backlog
the SAME month and the minimum-enforcement guard pays its $25 contract min even with the
pool exhausted → cash can dip up to that min below floor. Pre-existing engine behavior
(same class as Q2's "single small dip", previously ruled working-as-designed). Not
introduced by Q5; mention to Tre if the live floor shows a tiny dip in Aug.

## Live verification of Q5 (NEXT STEP — not started)
On http://localhost:8080/debt with Tre's real data, expect:
- PV header balance back to $6,004; total CC balance back to ~$14,453; utilization off 8.1%.
- "$1,165 manual" ISB badge still shown (UI unchanged).
- PV monthly projection: Jul $0, Aug $1,164.79, no interest while grace holds.
- Discover Aug payment lower than its no-ISB value; floor intact (± the $25 note above).
- Dashboard current-month rec for PV: $0 "Statement paid this cycle".
- FIRST: revert the leftover PV Oct pin from the previous session ("Revert All" in the PV
  monthly-projection header) — it's still active and will distort rows (Anomaly B basis
  switch: ANY pin flips all rows to overrideSim). NOTE: browser tools were 429-rate-limited
  until ~3:30am ET on 07-14; should be reset by now.
- `window.__simDebug.raw` reflects the SHARED pipeline only — use UI rows (get_page_text).
- Note: if PV has an active installment plan (installment_balance > 0), Jul shows the
  installment payment instead of $0 — installments are contractual, paid outside the pin.

## Then resume previous queue (from the 02:50 handoff, preserved in git history ddd08cde/62fadc68)
1. Anomaly A decisive test: pin PV Oct to exactly 100 via form_input (atomic set — ctrl+a
   typing APPENDED digits last time) → row must show −$100; then pin exactly the natural
   payment → must show that value. If the cycling clamp cap (< natural statement payment)
   is real, fix credit-card-engine.ts pin-resolution cycling branch (owedCycle/backlog cap).
   NOTE: Q5's fix may reframe the "139" (statement-split math changed).
2. Anomaly B (display basis switches to overrideSim when ANY pin exists; even pre-pin
   months change) — present options to Tre: (a) accept + UI note, (b) always local sim on
   Debt tab, (c) thread overrides through convergence (plan rejected as risky). His call.
3. `python -m graphify update .` — never run for Q1 override-rebalance NOR this Q5 change;
   commit if graphify-out/ changes.
4. Q4: cycling card not paying full statement in later years despite cash (screenshot
   Feb–Jun 2028; suspects: Step-2 pool double-reserve, maxDebtPaymentByMonth save-up cap
   with allRevolvingClear; reproduce WITHOUT overrides; lean-fix flow). Q5's machinery is
   adjacent (same statement-vs-balance code) — re-check symptoms after Q5 verify.

## Failed Attempts (carry-overs worth keeping)
- ctrl+a + type into month-payment inputs appends instead of replacing — use form_input.
- `window.__simDebug.raw` ignores overrides — UI rows are ground truth under pins.
- (This session: first pullback-test expectation assumed no backlog-min guard — the guard
  fires same-month; test now asserts 1135.21 statement + 25 backlog min = 1160.21.)

## Guardrails
- Repo PUBLIC — never commit real financial data (sim dumps, fixtures).
- Supabase: always filter user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Never push. No amend/rebase. Backups before source edits per CLAUDE.md.
