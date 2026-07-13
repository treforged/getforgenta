# Handoff — 2026-07-13 — Debt-engine Q&A: (1) override rebalancing feature, (2) floor-breach diagnosis

## GOALS (this session, from user)
Two questions about the Debt Payoff / credit-card engine, plus follow-up work the user approved:
1. **Q1 — Override a card's current payment.** Can the user adjust one card's payment, and does
   overriding auto-rebalance the OTHER cards? (Caused by making purchases outside the payment plans.)
   → **User APPROVED building a feature: make overrides rebalance the other cards.** NOT STARTED.
2. **Q2 — Multiple months drop below the cash floor.** Why aren't debt payments reduced enough for
   cards with revolving debt? → **User APPROVED verifying on real data.** DIAGNOSIS DONE (below).

Also delivered this session (already complete, pushed): the prior handoff's (a)/(b)/(c) —
verified tests green, committed backup rotation, and **pushed 9 commits to origin/main**
(`cc6d7cbc..dd37628b`). origin/main is in sync. That task is CLOSED.

## Q1 — ANSWER (already given to user; feature not yet built)
- Per-month override exists: `handleOverrideMonth` (src/components/debt/CreditCardEngine.tsx:1022)
  sets `overrides[cardId][monthIdx]`. Applied ONLY to that one card's forward balance walk in the
  `projections` useMemo (CreditCardEngine.tsx:871-915 → `projectCardVariable` per card).
- **Overriding does NOT rebalance other cards.** Other cards' payments come from the `perCardPayments`
  prop (the sim), which does not depend on `overrides`. Freed/consumed cash is NOT redistributed.
  The toast "future months recalculated" = future months of the SAME card only.
- "Reset & Recalculate" (`handleAutoAdjust`, :1059) just CLEARS all overrides back to the recommended
  allocation — it does not rebalance around an override.
- Interest-saving balance = statement balance; edit via `handleSaveStatementBal` (:1005, writes
  `statement_balance`). Engine already handles past-due: `pastDue` flag (:835) relabels the card
  "Saving for <next month> <day>".

### Q1 FEATURE TODO (approved, NOT STARTED)
Make a per-card override re-route the freed/consumed cash across the other cards (respect strategy
avalanche/snowball, minimums, and the floor). Scope/design still open — decide whether it re-runs the
allocation (`buildCurrentMonthRecommendationSummary` in credit-card-engine.ts ~:1636-1726) with the
overridden card pinned, or does a lighter local redistribution in CreditCardEngine.tsx. Plan first
(CLAUDE.md: non-trivial → /multi-plan). Back up before editing.

## Q2 — DIAGNOSIS (verified on live data 2026-07-13)
**Verdict: NOT a bug. Floor-protection is working; it's structurally bounded.**

### Real card data (Supabase, user_id a72f416e-433a-4055-9ab0-9feae4e60edf, project mdtosrbfkextcaezuclh)
- **Discover it Card**: bal $8,448.92, APR 19.49%, min $222, due day 1, pref **full**, min auto-synced.
- **Prime Visa**: bal $6,004.12, APR 27.49%, **min $0 (min_payment_is_manual=true)**, due day 7,
  pref **statement** (user switched full→statement mid-session 13:14 UTC — "that's what it's supposed
  to be"). statement_balance = null (user said its interest-saving balance shown was wrong; setting
  statement pref is the intended fix, but statement_balance itself is still null — may want to set it).
- Apple Card / Venture X: $0 balance, future card_start_date (2028-02 / 2026-12) — inactive now.

### Structural findings (from code, high confidence)
- A card with balance > 0 is REVOLVING regardless of pref: `autopayFullBalance = simBalance<=0`
  (credit-card-engine.ts:241); `revolvingCards = filter(!autopayFullBalance && balance>0)` (:1577).
  So Discover + Prime Visa are reducible revolving debt, NOT untouchable cycling. (isCycling only
  flips when simRevBal===0, :402-403.)
- Floor-protection cap IS enforced: forecast-engine.ts:946
  `debtPayments = baseData.map((b,i)=> Math.min(b.rawDebtPayment, maxDebtPaymentByMonth[i]))`.
- The cap NEVER goes below the sum of card minimums: `cap = Math.max(mCcMin, availableForDebt)`
  (floor-protection.ts:181). Here ccMin = Discover $222 + Prime Visa $0 = **$222**.
- Algorithm = reserve-based backward/forward pass (floor-protection.ts:76-199). Only lever is capping
  the REVOLVING pool. Statement/cycling payments are mandatory (folded into expenseByMonth), uncapped.

### Live proof (window.__simDebug, Debt Payoff tab, 30-month dump)
- Jul 2026–Jun 2027: `cap=inf`, no save-up — payments flow normally ($735–$3216/mo).
- **Jul 2027 onward: `saveUp=Y`, cap collapses to $222** (the minimums). Floor-protection IS engaging.
- But `total_payment` stays $670–$808 in those capped months → ~$450+/mo is **Prime Visa
  statement/cycling payment that the cap does NOT govern**. That uncapped portion is the only thing
  that could still drive a breach; the revolving pool is already floored at the minimums.

### What's still UNCONFIRMED (next step for Q2)
Did not capture the actual per-month FLOOR and ENDING CASH, so haven't pinned WHICH months the UI
flags "below safe minimum" or whether any residual breach is (b) unavoidable vs driven by the uncapped
statement payment. `__simDebug` lacks floor/endingCash. To finish: read the Forecast page breach
milestones, or extend the dump. NOTE the user just switched Prime Visa full→statement, so the whole
projection changed — re-verify breaches under the CORRECTED settings before concluding.

## ENVIRONMENT / HOW TO RESUME
- Dev server IS running: http://localhost:8080 (200).
- Browser automation tab **1527577765 is LOGGED IN** (user logged in mid-session). `window.__simDebug`
  is live on /debt. Pull data with:
  `window.__simDebug.rows(30)` / `.csv(36)` / `.table()`  (simDebug.ts). Columns: Month, saveUp,
  debtCap, per-card _bal/_pay/_owed, total_payment. Does NOT include floor/income/endingCash.
- Supabase MCP works; ALWAYS filter by user_id a72f416e-433a-4055-9ab0-9feae4e60edf.
- Stale fixture at src/lib/__tests__/fixtures/forecast-inputs.real.json is from 2026-07-03 (gitignored)
  — predates recent purchases AND the statement switch; do not trust it for current breaches.

## NEXT STEPS (in order)
1. Re-pull `__simDebug` under corrected Prime Visa=statement; read Forecast page "below safe minimum"
   months to confirm whether any breach remains and classify (b) unavoidable vs uncapped-statement.
2. Report Q2 conclusion to user (likely: working-as-designed, bounded by minimums; the uncapped
   statement payment is the residual lever — possible product decision to also throttle statement
   cards, which user previously flagged as a bigger-scope option they did NOT pick).
3. Build the Q1 override-rebalance feature (approved). Plan → backup → implement → test → review.

## GUARDRAILS
- Repo is PUBLIC. Scratchpad + any captured `__simDebug`/fixture data hold real financial data — never commit.
- Never push unless asked (already pushed the prior task's 9 commits WITH explicit user approval).
- Back up files to ./backups/YYYY-MM-DD_HHMMSS/ before editing.
