# Handoff — 2026-07-12 — Discover 2yr-payoff: ROOT-CAUSED & FIXED

## STATUS — RESOLVED
The Discover "pays off ~2.5yr out (Feb 2029) while cash balloons to ~$38k" bug is fixed.
Root cause found, one-line fix applied, full suite green (43 files / 163 tests), tsc clean.
NOT pushed (per policy).

## ROOT CAUSE (proven headless, not hypothesised)
The debt-cash convergence loop (`runDebtCashConvergence`, forecast-convergence.ts) was
**one pass short of its budget** on current live data.

Pass-by-pass trace on the 2026-07-11 live rows (damping 0.5): the loop converges
**monotonically** and every single pass already yields the correct payoff (Discover **Jul 2027**,
~m12). The residual `maxGap` decays ~40%/pass:
`2307 → 916 → 262 → 164 → 98 → 57 → 33 → 18 → 11 → 5 → 4 → 2(@pass12) → 1(@pass13) → 0(@pass15)`.
The old `maxPasses = 12` cut it off at gap **$2**, one pass before it crossed the $1 tolerance.
On exhaustion the loop **falls back to the un-accelerated `base` projection** — which is the
pathological Feb 2029 / $38k-cash-hoard result. So a run that had already found the right answer
was thrown away for the wrong one.

Prior sessions' floor-protection / `reserveNeeded` / `revolvingDebtCash`-collapse theories were
all **wrong**: floor-protection arrays are healthy, and `revolvingDebtCash` "collapsing to
minimums" was just the published *base* pair (which correctly pays minimums because its own cash
walk underestimates surplus) — never the resim. The resim was fine; it was just never published.

## THE FIX
`src/lib/forecast-convergence.ts`: default `maxPasses` **12 → 18** (5-pass margin over the observed
13-pass convergence; still covers earlier fixtures that needed 6 and 11). Rationale comment updated
with the live-data evidence. The fallback-to-base guard is unchanged — it remains the correct
zero-regression behavior for *genuine* (non-decaying) oscillation, which no budget can fix.

Verified via the headless harness: `runDebtCashConvergence` now returns
`converged:true, passes:13`, published payoff **Jul 2027**. (The ~$38k cash at m39 is now correct
and benign — it accumulates only AFTER both cards are paid off mid-2027; there is no revolving debt
left to route it to.)

## CLEANUP DONE
- Reverted TEMP dump instrumentation in `src/lib/floor-protection.ts` (now byte-identical to the
  clean backup `backups/2026-07-11_090803/src/lib/floor-protection.ts`).
- Deleted the TEMP headless harness `src/lib/__tests__/discdiag.tmp.test.ts` (was untracked).
- Backup of the edited file: `backups/2026-07-12_003425/src/lib/forecast-convergence.ts`.

## FOLLOW-UP (optional, NOT done — needs your call)
The exhaustion fallback-to-`base` is catastrophic when `base` is far from the (converging) fixed
point, as here. A budget bump fixes today's data but a future dataset needing 19+ passes would hit
the same cliff. A more robust design would publish the last resim on exhaustion *when the gap
sequence is decaying* (converging-but-slow) and only fall back to base on true oscillation. That
changes the documented contract + the `$1.5-gap → base` unit test, so I left it as a deliberate
decision for you rather than silently altering tested behavior.

## Rules
- Not pushed. Repo is PUBLIC — scratchpad holds real financial data, never commit it.
