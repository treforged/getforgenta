# Handoff — 2026-07-14 ~02:50 — main

## Goals
1. Finish live verification (plan step 6) of the Q1 override-rebalance feature
   (`.claude/plan/override-rebalance.md`). Code + 9 unit tests shipped and green in the
   previous session (174/174 vitest, tsc clean).
2. Then: `python -m graphify update .` (never run yet this feature), then investigate Q4
   (cycling card not paying full statement in later years despite cash on hand — see the
   2026-07-14 00:39 handoff content preserved in git history at commit abb8e80e / 3c7ee25a).

## Current State
- **Interest-saving balance set**: user gave Prime Visa's real interest-saving balance =
  **1164.79**. Entered via the Q3 UI control on the /debt Prime Visa card row → now shows
  "$1,165 manual" badge. This changed the whole baseline sim (PV balance now $1,165,
  utilization 8.1%, interest-free ETA Oct 2026; Discover rec $1,775). NOTE: this was set via
  UI only — verify it persisted (updateAccount mutation) if the dev server was restarted.
- **Live verify: partially done, 2 anomalies found, 1 resolved-by-diagnosis, 1 open.**
- Live state RIGHT NOW: dev server http://localhost:8080/debt has ONE active override:
  Prime Visa Oct 2026 pinned (typed "100" via ctrl+a+type — see Anomaly A; stored value
  uncertain). Revert it via "Revert All" in the PV monthly-projection header before further
  testing.
- **Browser tools rate-limited** (Claude 5h usage window exceeded ~02:45, resets ~07:30 UTC
  = 3:30am ET). Model-backed browser helpers (find, javascript_tool safety classifier)
  fail with 429. Local tools (Read/Grep/Bash/Edit) work fine.
- Tests: not re-run this session; expected still 174/174 (no code edits made this session).
- NO source-code changes this session. Zero edits. Nothing to back up.

## What live verification established (evidence)

Baseline (no overrides), Discover 2026 UI rows EXACTLY match `window.__simDebug.raw`
(shared pipeline): Jul 1775, Aug 222, Sep 363, Oct 1702, Nov 920, Dec 1213.

**✓ Working as designed:**
- Override edit UI: pencil → inline input → Enter/check applies; "edited" badge on row;
  "overrides" badge on card header; "Revert All" appears and fully restores baseline
  (verified: Discover back to 11-mo/May-2027/$818 after Revert All).
- Same-month rebalance: with a PV pin, Discover's same-month payment moved (920 → 1225).
- Rows reconcile under overrideSim: checked Discover Oct/Nov 2026 and PV Oct/Nov by hand,
  End = Start + purchases + interest − payment holds to rounding.
- Grace-loss flows through: pinning PV Oct below its statement produced Nov interest
  ($6.78) and "Interest-free" ETA moved Oct→Nov 2026. Correct.
- PV's own pre-pin months unchanged (Aug 513 / Sep 799 identical under pin).

**Anomaly A (OPEN — must resolve): pinned row shows −$139 after typing 100.**
- Nov-pin experiment: input prefilled "148", pressed ctrl+a, typed "600", Enter → row
  showed −$148 "edited".
- Oct-pin experiment: input prefilled "287", ctrl+a, typed "100", Enter → row shows
  −$139 "edited" (Start 287, +148 purchases, End 296).
- Leading hypothesis (NOT yet proven): ctrl+a select-all did not take effect in the
  number input, so the typed digits APPENDED ("148600", "287100"); parseFloat stores a
  huge pin; engine clamps at max payable. Nov: clamp = 148 ✓ fits. Oct: clamp would be
  `min(pinFloor, owedCycle + backlog)` (engine :972, cycling branch) = 139 ⇒ implies
  owedCycle+backlog = 139 while the NATURAL Oct payment was 287. If owedCycle (Step-2
  owedByCard) is really 287, the clamp cap and Step 2 disagree — possible real bug where
  the pin-resolution clamp cap for cycling cards is LOWER than the natural statement
  payment (i.e. pinning a value equal to the natural payment would still cut it). If
  owedCycle is really 139 (287 = 139 carried + 148 current-cycle deferred), the clamp is
  self-consistent and the whole anomaly is just my typing artifact.
- **Decisive test (do this first, it's cheap):** re-apply the pin with an unambiguous
  value. Either use browser form_input (sets value atomically) once rate limit resets, or
  clear the input with select-all via triple_click before typing. Pin PV Oct 2026 to
  exactly 100 → row must show −$100. Then pin to exactly 287 (the natural payment) → row
  must show −$287 (if it shows −$139, the clamp-cap bug above is real → fix in
  credit-card-engine.ts:963-994 cycling branch).
- Alternative local test (no browser): add a scratch vitest in
  src/lib/__tests__/ reproducing: statement-pref cycling card, carried 139 + deferred 148
  (start 287), pin 100 → expect payment 100; pin 287 → expect 287; pin 10000 → expect
  clamp = full owed (287), not 139.

**Anomaly B (DIAGNOSED — design consequence, needs Tre's decision, no code bug):**
- With ANY override active, ALL rows (all cards, all months, including months BEFORE the
  pinned month) switch display basis from the shared Forecast-converged pipeline
  (perCardPayments prop etc.) to the local `overrideSim` (= `variableSim.runSim(overrides)`).
  The two models genuinely differ: Discover Jul 2026 shows 1775 baseline but 1660 under
  any pin (Aug 222→890, Sep 363→1024 — identical regardless of which month/value is
  pinned, proving it's the basis switch, not the pin).
- Code: CreditCardEngine.tsx projections memo — no-override branch prefers shared props
  (:916-923 `rawPays ?? localPays`), override branch uses overrideSim for everything
  (:903-911). Also step3CumSurplus display adjustment applied only in baseline (:968,
  :1719-1728).
- This is what the approved plan chose (plan "Scope decision": convergence pipeline NOT
  threaded, overrideSim is ground truth when pins exist; unit test "prefix identity"
  passes because it compares engine-to-engine, not engine-to-shared-pipeline).
- User-visible effect: setting any pin makes even Jul (current month) jump ~$115 and
  mid-months jump hundreds. Options for Tre: (a) accept + maybe add a UI note ("projections
  recalculated locally while overrides active"), (b) always display the local sim on the
  Debt tab (consistent, but permanently diverges from Forecast popup/export), (c) thread
  overrides through convergence (explicitly rejected in plan as regression-risky).
- Possibly related to Q4: the local-vs-shared divergence smell is the same one flagged in
  the Q4 notes (`[projectCardVariable] ... does not reconcile` vitest warnings).

## Active Files
- `src/components/debt/CreditCardEngine.tsx` — overrides state :133, handleOverrideMonth
  :1049-1061, runSim closure :720-740, overrideSim memo :755-758, projections basis switch
  :887-939, row render/edit input :1715-1758, step3 display adjustment :1719-1728.
- `src/lib/credit-card-engine.ts` — pin resolution block :953-1001 (cycling clamp :972 is
  the Anomaly-A suspect), mandatory loop pinned path :1159-1191, Step-5 pin injection
  :1426-1439.
- `.claude/plan/override-rebalance.md` — approved plan; step 6 (live verify) is what's
  in progress; "Scope decision" section explains Anomaly B.

## Changes Made
- No commits yet this session (this handoff commit will be the first).
- Previous session's feature commit: 3c7ee25a.
- One UI data change: Prime Visa interest_saving_balance set to 1164.79 via the app
  (Supabase update through updateAccount mutation — user-requested, keep it).

## Failed Attempts
- Verifying override effects via `window.__simDebug.raw` — it reflects the SHARED pipeline
  only; it does NOT update when overrides are applied. Use UI rows (get_page_text) instead.
- ctrl+a + type into the month-payment number input — produced ambiguous stored values
  (Anomaly A). Use form_input or triple_click next time.
- `find` browser tool + javascript_tool — 429 rate-limited after ~02:45; don't retry until
  ~3:30am ET. get_page_text / computer(screenshot/click) kept working (no model gating).

## Next Steps
1. Resolve Anomaly A with the decisive test above (browser once limits reset, or the
   scratch vitest locally right now). If the cycling clamp cap is really < natural
   statement payment, fix credit-card-engine.ts:963-994 (cycling branch owedCycle/backlog
   cap) with backup + tests per policy.
2. Revert the leftover Oct pin in the live app ("Revert All" on Prime Visa) so Tre's
   view is clean.
3. Present Anomaly B options (a)/(b)/(c) to Tre — AMBIGUITY RULE: this is his call.
4. `python -m graphify update .`; commit if graphify-out/ changes.
5. Q4 investigation (later-years statement underfunding, screenshot Feb–Jun 2028; suspects:
   Step-2 pool sizing double-reserve, maxDebtPaymentByMonth save-up cap with
   allRevolvingClear; reproduce WITHOUT overrides; lean-fix flow).

## Guardrails
- Repo PUBLIC — never commit real financial data (sim dumps, fixtures).
- Supabase: always filter user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Never push. No amend/rebase. Backups before source edits per CLAUDE.md.
