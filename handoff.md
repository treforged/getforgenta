# Handoff — 2026-07-08 ~06:35 — branch debt-model-fixes-p0 — Stages 0+1 of unify-cycling-model SHIPPED; Discover-transition-purchase fix DIAGNOSED+SCOPED, not yet coded

## Goals
1. Execute `.claude/plan/unify-cycling-model.md` (6 stages, one-per-session per the plan's own
   risk mitigation). Invoked via `/remote-control execute .claude/plan/unify-cycling-model.md`.
2. Mid-session, user reported a live bug via dev-server screenshot (NOT part of the plan, but
   same subsystem): credit cards should defer new purchases to next month's statement when
   transitioning to debt-free, instead of sweeping purchases into the final payoff month.
3. User also flagged, explicitly "for later" (not this session): cash-floor look-ahead — when
   next month would drop below the cash floor, this month's debt payment should shrink a little
   to protect it. NOT STARTED, NOT SCOPED. Just log it (roadmap/memory) — do not implement yet.
4. Dev server requested — started, running (see below).

## Current State
- **Stage 0 SHIPPED** (commit 7cd9055e): new
  `src/lib/__tests__/forecast-engine.simAgreement.test.ts` — characterization test recording
  (not yet asserting) the per-month gap between `row.debtPayment` (Model A) and
  `cardProjectionData.allPaymentTotals` (Model B/sim). Baseline gap on the real fixture: months
  0-1 and 7-8 large (-851, -502, -291, +701), settling to ~$0.01 residue from month 9 on.
  152/152 tests green, tsc clean.
- **Stage 1 SHIPPED** (commit 93dc9715): type-seam extraction, zero behavior change.
  - `credit-card-engine.ts`: named `export interface SimResult` (was an anonymous return-type
    object literal on `simulateVariablePayoff`).
  - `cardProjectionResim.ts`: consumes the new `SimResult` instead of its local
    `ReturnType<typeof simulateVariablePayoff>` alias.
  - New `src/lib/debt-model-types.ts`: `Month0Result`, `ProjectionDataRow`,
    `CardProjectionResult` moved here from `useCardProjection.ts` (which re-exports them
    unchanged — zero import churn for the 8+ consumers).
  - 152/152 tests green, tsc clean, diff confined to exactly the 4 planned files.
- **Stage 2 NOT STARTED.** Plan: add `paymentLedger: { total, revolving, cycling, perCard }[]`
  to `CardProjectionResult`, built from the sim's own outputs; rebuild it in
  `resimulateWithDebtCash`/`buildResimOverrides`; new unit test asserting ledger identities on
  synthetic data. See the plan file for full detail (Stage 2 section).
- **Discover-transition-purchase bug: ROOT CAUSE FOUND, FIX SCOPED WITH USER, NOT YET CODED.**
  See "Next Steps" #1 below for the exact edit — do this FIRST in the next session (small,
  independent of the cycling-model plan stages, but touches the same file/function Stage 3
  will also touch, so land it before Stage 2/3 resume).
- Working tree: only `handoff.md` uncommitted right now (everything else committed). Verify
  with `git status` before doing anything.
- Dev server IS RUNNING in background (bash task id `birp8zn6l`, started this session,
  `npm run dev`, localhost:8080). If it's no longer running when you resume, restart it
  (`npm run dev`, `run_in_background: true`) — the user asked for it to be up.

## Active Files
- `.claude/plan/unify-cycling-model.md` — the 6-stage plan being executed; Stage 2 is next
  cycling-model work (after the Discover fix below).
- `src/lib/credit-card-engine.ts` — **the Discover fix goes here**, function `cascadeTarget`
  inside `simulateVariablePayoff`, currently at approximately line 1108-1124 (line numbers may
  have drifted ±5 from edits already made this session — search for `const cascadeTarget = `).
- `src/lib/__tests__/forecast-engine.simAgreement.test.ts` — Stage 0 characterization test.
- `src/lib/debt-model-types.ts` — Stage 1 shared types module.
- `src/hooks/useCardProjection.ts`, `src/hooks/cardProjectionResim.ts` — Stage 1 touch points;
  Stage 2 will add `paymentLedger` here.

## Changes Made (this session, all committed except handoff.md)
- Commit 7cd9055e — Stage 0 characterization test (see above).
- Commit 93dc9715 — Stage 1 type-seam extraction (see above).
- `npm run dev` started in background per user request (task id `birp8zn6l`); confirmed serving
  (benign ResponsiveContainer console warnings only, no errors).

## Failed Attempts
- None this session. (Prior-session failed attempts — damping 0.6, raising convergence passes —
  are documented in the git log message for d25d9b23 / 640dfc13; not re-litigated here.)

## Next Steps — DO THESE IN ORDER

### 1. Discover-transition-purchase fix (do this FIRST, before resuming Stage 2)
**Diagnosis** (verified against code, not yet coded): in `simulateVariablePayoff`
(`credit-card-engine.ts`), the `cascadeTarget` function decides how much "extra" cash beyond the
minimum a card can absorb in Step 5b's avalanche/snowball cascade. Today:
```ts
const cascadeTarget = (card: CardData): number => {
  if (balBeforePayment.has(card.id)) {
    const instBal = installmentBals.get(card.id) ?? 0;
    if (card.paymentPreference === 'statement') {
      const startBal = balances.get(card.id) ?? 0;
      const interest = interestMap.get(card.id) ?? 0;
      return Math.max(0, startBal - instBal + interest);       // excludes this month's purchases
    }
    const bnplPay = installmentChargeByMonth?.[m]?.[card.id] ?? 0;
    return Math.max(0, balBeforePayment.get(card.id)! - instBal - bnplPay); // INCLUDES purchases
  }
  return cyclingBacklog.get(card.id) ?? 0;
};
```
Only `paymentPreference === 'statement'` cards get the "exclude this month's purchases" carve-out.
Discover has `paymentPreference === 'full'`, so its target includes purchases — in the live
Jul 2027 row this produced a target of $1,386.23 (balance $1,246 + interest $20.23 + purchases
$120) against only $1,350 cash, leaving a stray $36.23 revolving remainder instead of cleanly
clearing the $1,266.23 statement balance and deferring the $120 purchase (which is what Aug 2027
does correctly, by coincidence of cash timing).

**User's decision** (via AskUserQuestion): apply the purchase-exclusion **only at the debt-free
transition month**, not universally to every month for every card. My analysis (present this
reasoning again to the user or just proceed — it was reasoned through, not re-confirmed after
the context-gate fired): capping the cascade target at `startBal - instBal + interest` (excluding
purchases) for ALL debtCards, not just `'statement'` ones, is **structurally a no-op except
exactly at the transition month** — because the cap only binds when available cash exceeds the
card's remaining balance+interest, which by definition only happens once the card is about to
clear. In every earlier month (still deep in debt), `remaining` cash in Step 5b is smaller than
`target` regardless of whether purchases are included, so the cap never binds and behavior is
unchanged. When the cap DOES bind (transition), any freed-up cash (that would have prepaid
purchases) naturally cascades to the NEXT priority card in the same Step 5b loop (`remaining`
carries forward) instead of being "wasted" prepaying a not-yet-due purchase — which is the
correct avalanche/snowball behavior. So the **planned edit** is:

```ts
const cascadeTarget = (card: CardData): number => {
  if (balBeforePayment.has(card.id)) {
    // Cascade targets only the prior cycle's statement balance (starting balance + this
    // cycle's interest) — never this month's new purchases. Real credit card statements only
    // bill charges through the prior closing date; this cycle's purchases aren't due until
    // next cycle. Because this cap only binds once available cash exceeds the remaining
    // balance+interest (i.e. exactly at the debt-free transition), this is a no-op for every
    // earlier month still deep in debt — any freed cash at the transition naturally cascades
    // to the next-priority card in this same loop instead of prepaying a not-yet-due purchase.
    const instBal = installmentBals.get(card.id) ?? 0;
    const startBal = balances.get(card.id) ?? 0;
    const interest = interestMap.get(card.id) ?? 0;
    return Math.max(0, startBal - instBal + interest);
  }
  return cyclingBacklog.get(card.id) ?? 0;
};
```
This removes the `paymentPreference === 'statement'` branch entirely (both branches converge to
the same formula) and drops the now-unused `bnplPay` local in this function (BNPL is still
handled correctly elsewhere as a mandatory Step 2.5 deduction — unaffected).

**Before coding**: re-verify the `owedForCard`/comment above `cascadeTarget` (~line 1099-1107)
still makes sense once the `statement`-only branch is gone — update that comment too (it
currently says "genuinely-revolving statement-preference cards cap at..."; should become
generic). Also check for any other reference to `paymentPreference === 'statement'` nearby that
assumed cascadeTarget was preference-gated (grep the file) — e.g. line ~1207-1213's comment
about "Cards with a paymentPreference still have a revolving balance here" may need a reread but
likely doesn't need a code change, just verify.

**After coding**: run full suite + tsc. Watch specifically for:
- `credit-card-engine` tests (payoff timing, cascade allocation).
- `useCardProjection` tests (anything asserting exact payment amounts for 'full'/no-preference
  cards near payoff).
- Golden Tier-A (`forecast-engine.goldenTierA.test.ts`) — the milestone month is pinned to
  `simRevolvingPayoffMonth`; if this fix makes Discover clear one cycle earlier on the real
  fixture, the golden's pinned "May 2027" / month index could shift. Per CLAUDE.md, do NOT
  silently re-pin — diff old vs new and present to Tre before updating.
Then live-verify on localhost:8080 (/debt accordion, Discover card, Jul/Aug 2027 rows) that the
transition row now shows the full statement paid off with purchases cleanly deferred (no stray
$36-style remainder). Backup first per CLAUDE.md backup policy (multi-file risk — this touches
core payoff math). Commit with a clear message citing the root cause and the reasoning above.

### 2. Resume `.claude/plan/unify-cycling-model.md` Stage 2
Sim publishes an authoritative per-month payment ledger. See plan file Stage 2 section for full
detail: add `paymentLedger: { total, revolving, cycling, perCard }[]` to `CardProjectionResult`
(now in `debt-model-types.ts`), built from the sim's own outputs (`monthlyPayments`,
`monthlyRevolvingBalances`, `monthlyCyclingOwed`, `monthlyMandatoryCyclingPayment`); rebuild it in
`resimulateWithDebtCash`/`buildResimOverrides` on every resim pass; new unit test asserting
ledger totals match existing `allPaymentTotals`/`debtPaymentTotals` identities on synthetic data;
no consumer change yet. Commit. Then Stages 3-5 per the plan, one per session.

### 3. Cash-floor look-ahead protection (explicitly "for later" — not scoped, not started)
User's request, verbatim: "seeing a drop below cash floor next month, when we should cut back a
little of the debt payment this month to protect it." This is a NEW feature idea, not yet
investigated against the existing `computeFloorProtection` / `maxDebtPaymentByMonth` look-ahead
machinery already in `useCardProjection.ts`/`floor-protection.ts` (there is SOME look-ahead
already — e.g. `saveUpMonths`, `strictSaveUpMonths` — so this may be a refinement of existing
logic rather than net-new). Do not start until asked; when picked up, first audit the existing
floor-protection look-ahead to see how close it already gets, per CLAUDE.md root-cause rules.

### 4. Memory/roadmap
Once 1-2 land, update `project_cycling_debt_engine` memory + roadmap. Add the Stage-2+ backlog
item (#3 above) to the roadmap memory too so it isn't lost.

## Key anchors (unchanged from prior handoffs)
- Dev server localhost:8080 (background task `birp8zn6l` this session), signed in; route /debt
  (accordion = expand card → Monthly Projection table), /forecast (popup = tap Monthly
  Breakdown row).
- Never push. Backups before high-risk edits. Supabase user_id
  `a72f416e-433a-4055-9ab0-9feae4e60edf`.
- Golden Tier-A untouched by Stage 0/1 (pure engine on fixture — provider-path changes don't
  feed it) — but the Discover fix (Next Steps #1) and Stage 3+ of the plan MAY shift it; handle
  per the plan's explicit "present delta before re-pinning" rule.
- Popup ≠ accordion display gap (from the PRIOR handoff, 2026-07-08 ~00:00) is a separate,
  already-diagnosed design issue — the unify-cycling-model plan is the fix path (Stage 3+ closes
  it structurally instead of needing display-layer scaling).

## Backlog (unchanged)
Milestone eyeball on Forecast tab; Transactions.tsx plan-progress purchase-date anchoring.
