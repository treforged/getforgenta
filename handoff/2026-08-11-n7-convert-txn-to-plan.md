# 2026-08-11 — relay session 1 — 🟢 N7 SHIPPED: convert a ledger transaction into a payment plan

Branch `autopilot/getforgenta-0811-160304` (cut from `origin/main` `14614279`), one commit, three files.
Built by an opus-executor subagent against a brief; diff and lib read in full by the manager session.

## What it does

A new per-row action (lucide `Split` icon, between Edit and Delete) on real expense rows in the
Transactions ledger opens the existing Payment Plan modal pre-filled from the transaction
(title "Convert to Payment Plan", save button "Replace With Plan"). On save, the plan is created and
**the source transaction is deleted** — the plan's generated installment rows replace it. The modal
carries a caption saying so before the user saves.

## The one design decision, and why

**Convert REPLACES the source row.** `generatePaymentPlanTransactions` projects an installment row
per payment into the same ledger stream, so a converted transaction left behind double-counts the
purchase across Dashboard, Forecast and Debt Payoff at once. Decided without a card (cheap, visible
in the UI before save, and a silent double count in a finance app is the worse customer outcome).
Ordering is real: `addPlan.mutateAsync` → only on success `remove.mutateAsync(sourceId)`; a failed
insert leaves the transaction untouched (modal stays open); a failed delete toasts a warning telling
the user both rows exist and to delete one.

## Rules live in one place

`src/lib/payment-plan-from-transaction.ts` — pure intent function `planDraftFromTransaction`
(mirrors `planLedgerImport`'s shape). Refusals: reconciliation rows, generated occurrences,
synthetic ids (`:`-bearing — `gen:`/`debt:`/`plan:`/`car:`/`recon:`), non-expense, non-finite/zero
amount. Draft: abs(amount) → total_amount, txn date → start_date, category carried over (falls back
to 'Shopping' if not in `CATEGORIES`, which would blank the select), payment_source carried verbatim
(same `account:<uuid>`/`cash` value space; page normalizes via its existing `normalizeSource`),
`plan_type 'upfront'`, `frequency 'monthly'`, **`total_payments` deliberately blank** — nothing on a
transaction says how many installments, and an invented count is worse than making the user state it.
The button's visibility and the handler both call the same function, so they cannot disagree.
Same premium gate as the Payment Plans section (`isPremium || isDemo`).

## Proof

- `npx tsc --noEmit` 0 (run by both executor and manager).
- New `src/lib/__tests__/payment-plan-from-transaction.test.ts`: **19 tests, all green**, and they
  BITE — dropping `Math.abs` fails 1; dropping the synthetic-id guard fails 5 (executor showed both,
  then restored and re-ran).
- Full suite: **877 passed / 5 failed of 882**. ⚠️ **The 5 failures are pre-existing and committed**:
  `pay-schedule.recurringCoverage.test.ts` (3) and `payment-plan-generator.monthEndClamp.test.ts` (2),
  both titled `(KNOWN GAP)`, landed by `7cf95b92` (PR #86, the audit that documents the
  future-months coverage gap). They are red on this branch's base too — any CI gate running the full
  suite is red independently of this work. Baseline correction: handoff sessions said 834; actual
  HEAD baseline here is 863 (858 pass / 5 known-gap fail); 863 + 19 = 882.
- `npx eslint` clean on the three files; `npm run build` green.
- Backup of the pre-edit page at `backups/2026-08-11_n7-convert/src/pages/Transactions.tsx`.

## NOT verified — say it plainly

- **No browser pass.** This relay session has no browser tooling. The button, caption, and a real
  convert round-trip (insert → delete against Supabase) are unproven on screen. Demo mode will show
  the button but the save toasts 'Demo mode' by the existing hook convention.
- No page-level test of the convert flow — Transactions.tsx has no test harness in this repo (house
  style is pure-lib tests, which exist and bite).
- Known cosmetic: a successful convert fires three toasts (hook "added", hook "deleted", plus the
  explanatory one). Suppressing the hook toasts means editing `useSupabaseData.ts` — out of slice,
  flagged for a follow-up.

## Next session should pick up

1. Live-verify N7 on `/transactions` in a signed-in browser: convert a small real expense, confirm
   the plan appears, the source row is gone, installment rows render, then delete the plan to
   restore state.
2. The still-owed browser pass for the maintenance log on `/builds` (session 11's script).
3. Finding 4 — still blocked on card `20648b6f` (`conductor answers` was empty this session).
4. Remaining N-items: N1/N2/N5/N6 need audits or Tre's answer first; N3 = 4B spec; N12 conditional.
