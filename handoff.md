# Handoff — 2026-08-07 — session 97 — 97.3 SHIPPED. §1 deploy window AUTHORIZED, pre-flight done, NOT RUN.

> **Next agent: your first job is the §1 window.** Tre authorized it explicitly this session
> ("after the backup go ahead"). It was deferred ONLY because this session hit the context gate
> mid-procedure — not because anything went wrong. Read
> `docs/financial-connections-deploy-runbook.md` IN FULL, then execute it.

## ▶ START HERE — run the §1 migration + edge-function deploy

**Everything you need is in `docs/financial-connections-deploy-runbook.md`** (committed
`9558f71b`, extended this session). It contains the pre-flight numbers already captured, the
exact verification SQL, the deploy set, the `verify_jwt` table, and the rollback rule.

Do not re-derive it. Three things that session 97 established and you should not re-litigate:

1. **The deploy set is 7 LIVE functions + 2 never-deployed ones.** The three easy-to-miss ones
   (`delete-account`, `revenuecat-webhook`, `stripe-webhook`) touch the schema only through
   `_shared/revoke-connections.ts`; a stale copy breaks account deletion and subscription
   revocation. `akoya-*` are deliberately NOT deployed (shelved provider).
2. **`financial-sync` and `plaid-hosted-link-result` have NEVER been deployed** (verified against
   the live function list). That is almost certainly why native Plaid Hosted Link is still
   unverified — `bc16b4fc` shipped the code and nothing ever deployed the function.
3. **MCP `deploy_edge_function` defaults `verify_jwt: true` and ignores `config.toml`.** Four of
   the seven live functions run with it FALSE. Deploying them without passing `false` explicitly
   would start rejecting Stripe/RevenueCat webhooks and the pg_cron sync call. The table is in
   the runbook; re-read the live list at deploy time and match it.

**Before step 1: confirm with Tre that his backup / PITR checkpoint exists.** He said he was
taking one. The table rename is the only hard-to-reverse step in the plan.

After the window closes, §1A (Plaid transaction sync + rule matching) becomes unblocked — that
is the real fix for 97.4. See "§97.4" below.

## What SHIPPED this session (all committed, none pushed yet)

- `be101646` **97.3 pure layer.** `src/lib/goal-auto-end.ts` — `projectedAutoEndDate` +
  `planAutoEndWrites`, making the 12 tests in `src/lib/__tests__/goal-auto-end.test.ts` green.
  (The previous handoff said 13 tests; the file actually holds 12. Suite total is 457, not 458.)
  `goal-linkage.ts` now EXPORTS `computeGoalCompletionIdx` / `resolveLinkedRuleIds` / its shapes,
  and `computeGoalCutoffIdx` is a thin wrapper — so 4b and 97.3 share one projection and cannot
  drift. 4b's read-path behavior is unchanged.
- `8c835fba` **97.3 migration + wiring + UI.** Migration
  `supabase/migrations/20260807_savings_goals_auto_end_contributions.sql`, **APPLIED** to
  `mdtosrbfkextcaezuclh` and verified (all 4 of Tre's goals default to off/empty):
  `savings_goals.auto_end_contributions boolean not null default false` and
  `auto_end_stamped_rules jsonb not null default '{}'`.
  - The stamp map as a jsonb side-column was the previous handoff's recommended option (a),
    taken unilaterally and flagged in the commit message as instructed. It is what makes "never
    clobber a manual end_date" decidable at all.
  - Types hand-added to `src/integrations/supabase/types.ts` (existing pattern).
  - Writes are issued ONLY from `SavingsGoals.handleSave`, never a render path. Planned against
    the payload AS SAVED, so a rule unlinked in the same save still gets its stale stamp cleared.
    Skipped in demo mode. Conflicts surface as a toast.
  - UI: checkbox under the Transfer Rules picker (shown only once rules are selected), and an
    "Auto-ends contributions <Mon YYYY>" line on the goal card. `openEdit` round-trips both
    fields; `handleDuplicate` deliberately resets them.
- `9558f71b` **§1 runbook** (see above).
- `python -m graphify update .` RUN — the carried debt since session 90 is cleared.
  (`graphify-out/` is gitignored; nothing to commit.)

**457/457 green, `tsc --noEmit` clean, eslint clean** at every commit.

## Known gaps on 97.3 (deliberate, not bugs)

1. **Not live-verified in the browser.** Unit-tested + tsc only. Worth a DOM check: `/goals` →
   edit a goal with a linked rule → the new checkbox appears → save → the rule shows an end date
   in `/budget`, and the goal card shows the "Auto-ends contributions" line.
2. **Re-stamping happens on GOAL save only.** A rule edit or a balance sync that moves the
   completion month does not re-stamp until the next goal save. The previous handoff listed
   those as additional hook points; they were skipped to keep the write surface small and
   auditable. Real but minor — decide with Tre whether it is worth widening.
3. **97.1's `/debt` TOTAL LIMIT tile still has not been DOM-verified** (carried from last
   session). It should read **$25,400**, matching Dashboard.

## §97.4 — pending-transaction gap (unchanged diagnosis, now unblocked-by-§1)

Session 97 closed the open question on this: **the interim workaround is NOT cheaper than §1.**
`supabase/functions/_shared/providers/plaid.ts:115` stores `balances.current`, and `available`
is never read or persisted anywhere — so "prefer `available`" is an EDGE FUNCTION change gated
by the same deploy window. There is no client-side version. That is why Tre chose to schedule
§1 rather than patch around it.

The rest of the original diagnosis stands and should NOT be re-derived: `SETTLEMENT_LAG_DAYS = 3`
in `src/lib/sync-cutoff.ts` is outflows-only by design; lagging the income side was tried and
re-admitted a $1,463 deposit already in the balance, inflating month-0 END CASH $2,346 → $4,346.
**Do not tune it.** Once transaction sync exists (§1A), the correct rule is "captured iff a
settled transaction matches it" and the heuristic should be **retired, not tuned**.

## Push status

`main` is **4 commits ahead of origin** (`be101646`, `8c835fba`, `9558f71b`, + this handoff).
Tre's standing rule is never auto-push. He authorized a push earlier this session for 97.1/97.2
only, and that one already happened.

## Older backlog (carried)

1. **Decide (needs Tre): are the deferred debt-engine sites worth it?**
   `credit-card-engine.ts:2087-2100` and `debt-transaction-generator.ts:12-34` still count a
   completed goal's transfer as a cash outflow inside the convergence engine. For Tre that is
   Oct 2030 onward, ~$500/mo. **Recommendation: skip.**
2. §2.9 car-fund earmark.

## Supabase — his real IDs (unchanged, carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Column names that bite: `accounts.account_type` (not `type`), `recurring_rules.rule_type`.
- Savings goals: 401K Roth (unlinked), Brokerage (Robinhood Contributions), Savings (HYS),
  Roth IRA (Roth IRA rule). All four now carry `auto_end_contributions = false`.

## Environment gotchas (unchanged, carried)

1. Tre is SIGNED IN on the real account. Never sign him in or out.
2. Dev server `localhost:8080`. Routes: Budget Control is `/budget`, Debt Payoff is `/debt`.
3. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
4. Don't put a PowerShell here-string in a compound `;`-chained command — use Bash heredoc.
5. Vitest suppresses `console.log` — write to a scratch file instead.

## Lessons worth keeping (session 97 addition)

**Check what is actually DEPLOYED before assuming code is live.** `plaid-hosted-link-result`
was written, committed, and reasoned about across multiple sessions as though it were running —
it had never been deployed. One `list_edge_functions` call surfaced it. The same call surfaced
the `verify_jwt` mismatch that would have broken the webhooks mid-window. When a feature is
"shipped but unverified", check the deployment before re-reading the code.

All prior sessions' lessons (1-96) are in git history under `docs: handoff` commits — search
`git log --all --oneline | grep handoff`.
