# Handoff — 2026-07-07 — branch debt-model-fixes-p0

## Goals
Manual-min feature (Increments 2+3) is **DONE and deployed** (details below). Two things remain:
1. **Live-verify** the manual-min flag on localhost:8080 → Debt Payoff tab: Prime Visa should show
   a **$0 minimum** (not $25), sim otherwise unchanged except Prime's floor/min reservations.
   Also verify the Accounts editor: editing Prime Visa should show the "I set this minimum
   manually" checkbox CHECKED and Minimum Payment "0".
2. **NEW user report (next work item):** "on Forecast pop-ups, CC balances do not match what's on
   the Debt Payoff tab yet." This is the known Phase-5 Forecast↔DebtPayoff unification gap
   (previous handoff step 10). Forecast month-detail popups show CC balances from the forecast
   engine's own projection, not the debt-engine sim that DebtPayoff now uses (which has
   upfront-plan anchoring via deriveUpfrontPlanFields + manual-min). Start by comparing
   `src/lib/forecast-engine.ts` CC balance projection vs `simulateVariablePayoff` outputs used in
   `src/pages/DebtPayoff.tsx`; the unification work from commits a146c72/77cdc11 shows the intended
   direction (share the sim / shared helpers between both tabs). This is a NEW task — plan it
   holistically (per feedback memory: validate against real data, scoped/additive changes).

## Current State
- Manual-min flag fully implemented, tested, committed locally at **d8d15f2** (not pushed), and
  handoff commit follows. tsc clean; vitest **122/125** — the only 3 failures are pre-existing
  `useCardProjection.activeLoanInsurance.test.ts` (task #11, unrelated).
- **Prod is LIVE** (user approved "go ahead with the prod steps"):
  - Migration applied to project `mdtosrbfkextcaezuclh`: `accounts.min_payment_is_manual boolean
    not null default false` (also saved as `supabase/migrations/20260707_accounts_min_payment_is_manual.sql`).
  - Edge functions deployed: `plaid-sync` v43 (verify_jwt true), `plaid-sync-all` v29
    (verify_jwt false — cron-secret auth). Both now skip BOTH min_payment write paths (Plaid
    liability value + formula fallback) for accounts with the flag set.
  - `UPDATE accounts SET min_payment_is_manual = true` applied to Prime Visa
    (id 9111bd9f-4704-4acb-97f7-cf1ab40bc764; min_payment already '0', flag now true — verified
    via RETURNING).
- Dev server: `npm run dev` on localhost:8080 (may or may not still be running; probe first).

## Changes Made (commit d8d15f2, all local, NOT pushed)
- `src/lib/credit-card-engine.ts`: `CardData.minPaymentIsManual?`; `buildCardData` uses stored min
  EXACTLY when flag true (incl. 0; null→0; no $25 floor); `revolvingMinDue` manual branch returns
  `min(contractRevMin, revOwed)` (no formula); `perCardMinPayments` (both normal + backlog-card
  branches) uses `revolvingMinDue` for manual cards instead of `calcMinPayment`.
- `supabase/functions/plaid-sync/index.ts` + `plaid-sync-all/index.ts`: batch-fetch
  `min_payment_is_manual=true` plaid_account_ids per item; guard both min_payment writes.
- `src/components/shared/FormModal.tsx`: new `checkbox` field type (string values 'true'/'',
  placeholder = inline label text).
- `src/pages/Accounts.tsx`: "I set this minimum manually" checkbox for credit cards; manual save
  stores typed amount exactly (blank=0, allows $0) + `min_payment_plaid_synced=false`; openEdit
  shows manual $0 instead of blanking it.
- `src/integrations/supabase/types.ts`: `min_payment_is_manual` in accounts Row/Insert/Update.
- New tests: `src/lib/__tests__/credit-card-engine.manualMin.test.ts` (13, all green — TDD, written
  RED first). Also fixed pre-existing tsc error in `payment-plan-upfront-dates.test.ts` (schedule
  fixture needed explicit `{ [cardId: string]: number }[]` annotation).
- Backups: `backups/2026-07-07_065941/` (committed).

## Failed Attempts / critical gotchas (do NOT repeat)
- All gotchas from the previous handoff still apply, especially:
  - Supabase `accounts`/`payment_plans` contain OTHER USERS' rows — ALWAYS filter
    `user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf'`.
  - Engine tests call `simulateVariablePayoff` positionally — new params go at the END
    (`upfrontPayByMonth` is arg 19).
  - Don't move contract-min enforcement into `perCardMinPayments`' formula floor for NON-manual
    cards (over-reserves; payoff regressed to m38 in the B1 prototype).
- Auto-mode permission classifier blocks prod Supabase actions unless the user's CURRENT message
  authorizes them ("continue from handoff.md" was not enough; explicit "go ahead with the prod
  steps" was). Don't retry denied calls verbatim — ask.

## Next Steps (in order)
1. Live-verify manual-min (goal 1 above): probe localhost:8080 (`curl` first; start `npm run dev`
   if down), check Debt Payoff tab Prime min = $0 and Accounts editor checkbox state.
2. Investigate + plan the Forecast-popup CC balance mismatch (goal 2 above). Get user confirmation
   of the plan before large edits.
3. Update session notes at `C:\Users\tvonh\Desktop\claudecontext\sessions\2026-07-07_manual-min-flag.md`
   when the session wraps.
4. Still open (unchanged backlog): milestone eyeball on Forecast tab; Transactions.tsx
   plan-progress display purchase-date-anchored (minor); 3 activeLoanInsurance failures (task #11).

## Open questions
- None blocking. Prod steps were explicitly approved and are done.
