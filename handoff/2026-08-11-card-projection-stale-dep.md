# 2026-08-11 — relay s1 (evening) — 🟢 Stale card projection after bank sync FIXED

Branch `autopilot/getforgenta-0811-173709` (cut fresh from `origin/main` `bbd440d7`, no PR on it),
one commit `d0ac30ac`, two files.

## The slice

The backlog's known eslint warning — `useCardProjection.ts:2121` `react-hooks/exhaustive-deps`
missing `syncedTransactions` — was a real staleness bug, not lint noise. The projection memo reads
`syncedTransactions` in both car-charge evidence gates (`:588`, `:1339`) but didn't depend on it,
so a Plaid refetch settling the car-loan debit left the mounted projection charging month 0 for a
payment the bank already took. Worse, `useForecastEngineInputs` HAS the dep, so the engine side
recomputed while the sim side didn't — the exact "two surfaces disagree about the same car payment"
shape (§1.1 cause C) the file's own comment warns against.

## What changed

- `src/hooks/useCardProjection.ts` — `syncedTransactions` added to the projection memo's dep array.
  Safe: the array comes from react-query (`CardProjectionContext:167`), whose structural sharing
  keeps the identity stable unless the fetched data actually changed, so no recompute-per-render.
- `src/hooks/__tests__/useCardProjection.captureEvidence.test.ts` — new rerender-based regression
  test ("a LIVE sync landing the debit updates the projection in place"): same mounted hook,
  coverage-only rows first (charge stays), then a rerender handing in the settled debit — the
  charge must drop to 0 without a remount. Every pre-existing test mounts a fresh hook and could
  never catch the memo going stale.

## Proof

- Test was RED before the fix (stale memo kept the $386.66 synthetic loan charge), GREEN after.
- `npx tsc --noEmit` 0; eslint clean on both files (the backlog warning is gone).
- Full suite **883/883 across 114 files** (the 5 `(KNOWN GAP)` tests from PR #86 are now green on
  main — PR #89 fixed them; that backlog item is CLOSED, checked this session by running both files).
- `npm run build` green.
- Backup skipped deliberately: single-line source change + one test, "trivial edits, backup
  optional" per CLAUDE.md.
- Not browser-verified — the fix is a dep-array change covered by the render-level test; there is
  no visual surface beyond numbers already pinned by tests.

## Also established this session

- `conductor answers`: nothing outstanding (Finding 4 card `20648b6f` still unanswered).
- `gh pr list` is permission-denied in this relay; branch freshness was instead established by the
  branch being newly created for this relay at `origin/main`'s tip.

## Next session should pick up

1. Signed-in live passes still owed: N7 single-toast, `/builds` maintenance save/delete round-trip,
   N9/N10 Forecast, N11 Debt page.
2. Finding 4 — still blocked on card `20648b6f`.
3. N1 audit (loan-account link + the "charts didn't update" half) — read-only, doable unattended.
4. N6 audit (paid-but-not-settled CC contribution suppression) — read-only, doable unattended.
5. Relay end files the PRs for this branch plus the four older fix branches +
   `feat/build-maintenance-log`.
