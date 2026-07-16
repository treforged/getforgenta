# Handoff — 2026-07-16 ~00:25 — main

## ACTIVE TASK: Q7 — Venture X misses full Jan 2029 statement (LIVE-ONLY, root cause narrowed)

Tre reported: "venture x misses a full statement balance in 2029."
CONFIRMED LIVE on localhost:8080 /debt → Venture X → Monthly Projection → 2029:
Jan 2029 pays **$50 of a $300 statement** (start 300, +300 purchases, end $555), $4.79 interest
charged Feb 2029, caught up Feb (-$555). VX card header shows TOTAL INTEREST $5.

Q6 (PV 2028) prerequisite check: live `__convergenceDebug` = converged:true, passes:12,
usedFallback:false; Debt tab ETA 12 mo; ledger pays PV/Discover statements fine. Q6 itself looks
OK live, but do a proper PV-2028-rows check next session (didn't finish it).

## WHAT WAS ESTABLISHED (all reproducible)

1. **Old golden fixture (07-15) does NOT repro** — VX pays every statement in full thru 2030.
2. **Captured a fresh live fixture WITH debtPayoffOptions**:
   `src/lib/__tests__/fixtures/forecast-inputs.real.live-2026-07-16.json` (gitignored via the
   `forecast-inputs.real*.json` pattern). Captured via new DEV dump (see change below) POSTed to
   a temp local node receiver. debtPayoffOptions live = `{strategy:'avalanche',
   paymentMode:'variable', cashFloor:2800, overrides:{}}` — overrides are EMPTY live, so the
   07-15 "fidelity gap = overrides" theory is DEAD.
3. **Offline run of the live capture is CLEAN** (harness rebuild → converge, 17 passes): VX
   m30 pays 300, mand=300, no backlog. So live and offline converge to DIFFERENT fixed points.
4. **The BASE projections differ** (live captured `inputs.cardProjectionData` vs harness
   `renderProjectionFromFixture(inputs)` on identical data):
   - live base: payoffM=36, saveUp={13,15,16,17,18,19,20,23,24,27}, maxDebt tiny/0 everywhere
     (m10-12=0, m16-20=227, m27=1)
   - offline base: payoffM=11, saveUp={}, maxDebt mostly inf
5. **ROOT-CAUSE CANDIDATE (verify first next session):** the app passes
   `persistedDebtFundingId` from localStorage `tre:debt:fundingAccount` =
   `"933cbc10-bceb-4c20-8227-4a02e6db728a"` (JSON-quoted string), while projection-harness.ts
   hardcodes `persistedDebtFundingId: null`. That's the only identified live-vs-harness input
   delta (pauseSavings=false matches; strategy avalanche matches; scheduledEvents same
   generator/args; overrides {}).
6. Live converged state (from new `__convergenceDebug.convergedProjection`): VX
   mand=25 (only min!) m24-m30 then mand=300 from m31; ledger m30 total=383
   (PV 212.99 + Disc 120 + VX 50.01) while final maxDebtPaymentByMonth[30]=Infinity — i.e. the
   converged ledger ECHOES a stale low target at m30 that the final look-ahead no longer
   justifies (echo-ratchet fixed point). Jan (m30) is VX's annual-spike month in the chart.

## NEXT STEPS
1. Extend `fixtures/projection-harness.ts` to accept `persistedDebtFundingId` (and ideally
   capture it into future fixtures); rerun `vx-2029-diagnostic.test.ts` (untracked, repo root
   src/lib/__tests__/) with `933cbc10-bceb-4c20-8227-4a02e6db728a` → expect live repro (base
   payoffM=36, saveUps, then converged VX m30 pay=50).
2. Root-cause with the repro: (a) why does pinning the funding account degrade the cash walk so
   badly (payoff 11→36 in the BASE — this alone may be its own bug), and (b) why VX's mandatory
   cycling statement demotes to min ($25) m24-30, letting the Step-5 pool shortchange it, and
   (c) why the converged ledger keeps a 383 target at m30 when the final look-ahead cap is inf
   (convergence accepts a fixed point the final pass's look-ahead would not produce).
   Fix at the correct layer; add regression to forecast-convergence.manualISB.test.ts pattern
   using the NEW live fixture + funding id.
3. ALSO SPOTTED live: Prime Visa card header "TOTAL INTEREST **$132,085**" — absurd; investigate
   (display calc in CreditCardEngine projections vs sim; may be projectCardVariable flat-APR walk
   on ISB-pinned card).
4. Q6 live-verify completion: open PV Monthly Projection 2028 (Feb–Jun) and confirm full
   statement payments, and re-check Q5 acceptance (PV Jul "—", Aug −$1,165).

## CHANGES MADE THIS SESSION (uncommitted until this handoff commit)
- `src/contexts/CardProjectionContext.tsx` (backup: backups/2026-07-16_003000/): DEV-only
  `__convergenceDebug` now also exposes `convergedProjection`, `engineInputs`,
  `debtPayoffOptions` (for live debugging + fixture capture). Keep — it's `import.meta.env.DEV`
  gated.
- `src/lib/__tests__/vx-2029-diagnostic.test.ts` — TEMP diagnostic, left UNTRACKED on purpose
  (header says delete before commit). Has two tests: converge live capture + dump VX m24-36;
  diff live base vs harness base.
- New gitignored fixture `forecast-inputs.real.live-2026-07-16.json` (real data — NEVER commit).

## FAILED ATTEMPTS / GOTCHAS
- `window.__simDebug.raw` is the PASS-0 hook result, NOT converged — don't diagnose from it.
- `cp.cards[].id` is empty string on the converged projection — look cards up via
  `cp.perCardPayments.find(p => p.name === ...)` instead.
- App routes: debt page is `/debt` (NOT /debt-payoff); dev server localhost:8080, Tre logged in.
- vitest: use `--disable-console-intercept` to see console.logs.
- Repo PUBLIC — real-data fixtures stay gitignored. Supabase user_id
  a72f416e-433a-4055-9ab0-9feae4e60edf. Never push.
