# Handoff — 2026-07-07 — branch debt-model-fixes-p0

## Goals
User (Tre) approved ("go ahead") **Increment 2 + 3 of the manual-min feature**:
1. **Increment 2:** add a per-card `min_payment_is_manual` boolean so the debt engine honors a
   user-set `min_payment` EXACTLY, **including 0** (Prime Visa: min_payment=0, balance-transfer
   intent — everything on 0% payment plans, nothing due). Do NOT fall back to the 2% formula or
   the $25 floor when the flag is true. Plaid sync must NEVER overwrite `min_payment` (or the
   flag) when the flag is true. Requires a **prod Supabase migration** (project
   `mdtosrbfkextcaezuclh`) + **Plaid edge function changes** — user has ALREADY approved both.
2. **Increment 3:** UI toggle on the card editor ("I set this minimum manually") so the flag is
   user-settable. Also set Prime Visa's flag = true via SQL (user's stated intent).
3. Done = engine tests green (incl. new manual-min tests), tsc clean, migration applied, edge
   functions deployed, toggle works, Prime shows min $0 in the app, local commit (NO push).

## Current State
- **Nothing for Increment 2 has been edited yet.** Work stopped right after locating the Plaid
  write sites (read-only grep). No half-done edits anywhere; working tree clean at `77cdc11`.
- Verify with: `npx tsc --noEmit` (clean) and `npx vitest run` → **109/112** — the only 3
  failures are pre-existing `useCardProjection.activeLoanInsurance.test.ts` (task #11, unrelated).
- Two big fixes landed and LIVE-VERIFIED this session (ETA 43mo → 15mo on the Debt Payoff tab):
  see commits below. Dev server: `npm run dev` on **localhost:8080** (may still be running in a
  background task; probe with curl before starting another).

## Active Files (open these first)
- `supabase/functions/plaid-sync/index.ts` — lines ~298–346 write `min_payment` (liability value
  at 333 sets `updateFields.min_payment = liabMin` + `min_payment_plaid_synced = true`; fallback
  at ~337–346 estimates via `calcMinPayment`). Guard BOTH paths behind the flag.
- `supabase/functions/plaid-sync-all/index.ts` — same two write paths at lines ~205–218.
- `src/lib/credit-card-engine.ts` —
  - `buildCardData` (~line 196): `const minPay = (acctMin != null && acctMin > 0) ? acctMin : 25;`
    floors 0→$25. Must become: if `min_payment_is_manual` → use `acctMin` exactly (incl. 0);
    else keep current behavior. Add `minPaymentIsManual` to the `CardData` type.
  - `revolvingMinDue(card, revOwed)` (~line 117 area): currently
    `min(max(contractRevMin, calcMinPayment(revOwed, apr)), revOwed)` where
    `contractRevMin = max(0, minPayment − installmentMonthlyPayment)`. For manual cards: return
    `min(contractRevMin, revOwed)` EXACTLY — no formula fallback (manual 0 ⇒ 0).
  - `perCardMinPayments` push (~line 808) uses `calcMinPayment(revBal, apr) + instMinPay`; for
    manual cards use exact manual rev-min instead of the formula (keeps floor honest for min-0).
- `src/integrations/supabase/types.ts` — add `min_payment_is_manual` to accounts Row/Insert/Update
  (or regenerate via Supabase MCP `generate_typescript_types`).
- UI toggle: find the card editor where `min_payment` is edited (likely `src/pages/Accounts.tsx`);
  not yet located — grep `min_payment` in `src/pages`/`src/components`.

## Changes Made (this session, all local, NOT pushed)
- `c9b1565` [debt-engine]: honor real contract min in sim payment layer, decoupled from the floor
  (B1/B2) — `revolvingMinDue` at 4 cascade sites + `reservedForRevolving`; B2 cap floored at
  `totalMins`; look-ahead `ccMinByMonth` sourced from contract mins. 4 tests re-blessed.
- `77cdc11` [debt-engine]: anchor upfront CC plan installments to real due dates —
  `getUpfrontCardPlanDates`/`getUpfrontPlanProgress`/`deriveUpfrontPlanFields` (shared by BOTH
  tabs) in `src/lib/payment-plan-generator.ts`; engine `upfrontPayByMonth` param (schedule-aware
  Step 2.5 / perCardMinPayments / reservedForRevolving via `upfrontDueFor`, flat fallback when
  omitted); `CreditCardEngine.tsx` now filters plan purchase-injection to `monthly_charge` only
  and applies the shared carve-out to its internal sim. New tests:
  `src/lib/__tests__/payment-plan-upfront-dates.test.ts` (8 passing).
- Session notes: `C:\Users\tvonh\Desktop\claudecontext\sessions\2026-07-06_upfront-plan-anchoring.md`.
- Backups: `backups/2026-07-04_020014/`, `backups/2026-07-06_231055/` (committed).

## Failed Attempts / critical gotchas (do NOT repeat)
- **Supabase `accounts`/`payment_plans` contain OTHER USERS' rows.** An unfiltered query led to a
  completely wrong root-cause theory (accounts "Jose"/"Fairwinds"/"Chase College" are NOT Tre's).
  ALWAYS filter `user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf'`.
- Raising `perCardMinPayments` to the contract min (B1 prototype path) over-reserves the floor →
  payoff m38. The landed design keeps the floor on the formula and enforces contract mins at the
  payment/reservation layer only. Don't "simplify" them back into one source.
- The save-up throttle was NOT the root cause of the Prime balloon — bad plan-date inputs were.
  Don't weaken floor-protection.ts.
- `useCardProjection.cyclingFloor.test.ts` Card B dips to ~$564 in the single annual-bill month
  (genuine floor protection); test asserts ≥560 + full recovery. Don't "fix" it back to strict 600.
- Engine tests call `simulateVariablePayoff` positionally — new params go at the END
  (`upfrontPayByMonth` is currently arg 19).

## Next Steps (in order)
1. **Migration** (user-approved): `alter table accounts add column min_payment_is_manual boolean
   not null default false;` — save SQL under the repo's migration convention (see existing
   `migration_*.sql` files in repo root and/or `supabase/migrations/`) AND apply to prod via
   Supabase MCP `apply_migration` (project `mdtosrbfkextcaezuclh`).
2. Engine: `CardData.minPaymentIsManual` + `buildCardData` exact-min (incl. 0) + `revolvingMinDue`
   manual branch + `perCardMinPayments` manual branch (files/lines above).
3. TDD: new test file (e.g. `credit-card-engine.manualMin.test.ts`): manual min 0 → card never
   forced above $0 revolving min (cascade may still pay it by priority); manual min 50 < formula →
   exactly 50; manual flag false → unchanged behavior.
4. Plaid guard: in BOTH edge functions, fetch/carry `min_payment_is_manual` for the account and
   skip both min_payment write paths when true. Deploy BOTH via MCP `deploy_edge_function`
   (user-approved). Back up files first per backup policy.
5. `types.ts`: add the column.
6. UI toggle (Increment 3): checkbox in the card editor bound to `min_payment_is_manual`.
7. `UPDATE accounts SET min_payment_is_manual = true WHERE user_id = 'a72f416e-433a-4055-9ab0-9feae4e60edf' AND name = 'Prime Visa';`
8. Verify: tsc, vitest (expect 3 pre-existing failures only), live check on localhost:8080/debt —
   Prime min should show $0 (not $25) and sim unchanged except Prime's floor/min reservations.
9. Commit locally `[debt-engine]: manual-min flag ...` with backups; NO push. Update
   `python -m graphify update .`.
10. Still open after this: full Phase-5 Forecast↔DebtPayoff unification; milestone eyeball on
    Forecast tab; Transactions.tsx plan-progress display still purchase-date-anchored (minor);
    3 activeLoanInsurance failures (task #11).

## Open questions
- None blocking — user pre-approved migration + edge deploys ("go ahead").
