# Handoff — 2026-08-08 — session 105 — 97.3 CLOSED (live-verified); goal chart fix SHIPPED

> Both of Tre's asks this session are done and committed. Nothing pushed.
> **The 97.3 sign-in blocker that stalled sessions 103-104 is gone** — the Claude-controlled
> Chrome is signed in on `http://localhost:8080` and the tab is parked. Do not sign it out.

## ✅ 97.3 — CLOSED, live-verified end to end

Carried item 1 is done. Four independent surfaces agree on the SAME month, which is the whole
point of the feature:

| surface | evidence |
|---|---|
| DB — `savings_goals` | `auto_end_contributions=true`, `auto_end_stamped_rules={"73a5c998…":"2030-09-30"}` |
| DB — `recurring_rules` | HYS rule `end_date = 2030-09-30` (a real write, not a computed exclusion) |
| `/budget` → Transfers | `HYS · Monthly · Day 28 · Starts 2027-08-21 · **Ends 2030-09-30**` |
| `/goals` card | `Auto-ends contributions Sep 2030` + `Est. completion: Sep 2030` |
| `/forecast` | milestone `Sep 2030: Savings Complete! 🎯` |

Do not re-verify this. Carried item 2 (widen re-stamping beyond GOAL save) is still open and
still needs Tre's call.

## ✅ Shipped — goal chart keeps earning after contributions stop — `9592611b`

Tre's ask: "although i set contributions to stop once goal is met, account should gain their
interest. the saving goal chart should update. forecast should update."

**Root cause:** the Savings Growth Projection chart was the LAST read path still contributing
forever after a goal hit target. Forecast, Dashboard and the Debt engine all stopped at the
completion month via `goal-linkage.ts` (handoff 4b); `buildSavingsGrowthData` never got the
cutoff. So the chart drew a straight $500/mo climb to $25,000 in a month the rest of the app
had already flagged complete. The Forecast was already correct on both counts — it cuts the
contribution (`forecast-engine.ts:928-929`) and applies savings interest unconditionally
(`:1355`) — so only the chart needed fixing.

- `src/lib/savings-growth.ts` — `GrowthGoalInput` gains optional `targetAmount`; when set,
  `buildSavingsGrowthData` stops the monthly contribution at the cutoff. Omitted = today's
  behavior byte for byte, so no other caller moves. New `projectGoalBalanceAt` replaces the
  lump-sum modal's own closed-form annuity.
- The `+1 / 0` cutoff rule now lives in ONE place: `contributionCutoffIdx` in savings-growth,
  called by `goal-linkage.ts`'s `computeGoalCutoffIdx`. That is the drift guard.
- `src/pages/SavingsGoals.tsx` — `toGrowthGoal` passes `targetAmount`; chart subtitle says so.

**Decision, pinned by a test so it stays a decision:** planned lump sums STILL land after
completion. `forecast-engine.ts`'s `lumpTransferByMonth` is not gated on completion either, and
a dated one-off transfer is explicit user intent. Do not "fix" this without Tre.

**Live-verified against real data** (not just unit tests): the Savings line hits $20,000 at
Sep 2030 and is **$20,548** ten months later, not the $25,000 the old projection drew. Slope
drops ~90% at exactly the completion month and stays positive and compounding.

534/534 tests (6 new), tsc clean **against a captured 0-error baseline**, eslint clean.

## Still open (carried, renumbered)

1. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen to rule
   save/edit and balance-sync landing. (`goal-auto-end.ts`'s header lists the intended sites.)
2. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
3. §2.9 car-fund earmark.
4. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop; §1 is settled.
5. Native Plaid Hosted Link device verification (needs a physical device).
6. Stage A's pending→posted retirement path still **not exercised against real data**.

## Closed previously (do not reopen)

§1A Stage C (all parts, session 103), 97.1 `/debt` TOTAL LIMIT tile ($25,400), `types.ts` regen
(session 104), remote access (Tailscale+RDP, session 104 — lives OUTSIDE this repo in
`C:\Users\tvonh\Desktop\remote-access\`; **this repo is PUBLIC**), and now **97.3**.

**Re-check each session:** only Discover has a `sync_cursor` (143 rows). The car-loan funding
account `933cbc10…` is Chase TOTAL CHECKING with 0 synced transactions. The moment a
checking-account cursor appears, §1A Stage C stops being a no-op and the gates go live for real.

## Live drift worth knowing (not a bug, do not chase)

Live shows **CC Debt Free Oct 2028**; the fixture golden pins **Jul 2027**. The fixture is from
2026-07-20 and live balances have moved. The golden asserts against the fixture, not live.
Do not "fix" the golden to match live.

## Push status

`main` is **35 commits ahead** of `origin/main` including this handoff. Standing rule is never
auto-push. **Nothing pushed.** Verify with `git rev-list --count origin/main..main`.

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Savings goal's linked rule (97.3's stamped one) = `73a5c998-d99d-4418-9578-c9d8d9f5dc10` (HYS).
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2`; Discover account =
  `34c9574b-3557-4729-a812-f0b1b508b882` (still the ONLY account with synced transactions).
- Car loan payment account = `933cbc10-bceb-4c20-8227-4a02e6db728a` (**Chase TOTAL CHECKING**).
- `sync_cursor` lives on **`financial_connections`**, NOT on `accounts`.
- `financial_connections` uses **`last_synced_at`** and **`connection_status`**.
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`.

## Environment gotchas (carried)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. The Claude-controlled Chrome is a **separate profile** and is **currently SIGNED IN** on
   `http://localhost:8080`. Probe `localStorage` for an `sb-*` key before assuming either way.
3. Dev server `localhost:8080`, `strictPort`. Start with `node scripts/dev-session.mjs up`.
4. `/budget` rules split across tabs; `cost_type` overrides category ("Dog food" is **Variable**).
5. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
6. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
7. Vitest suppresses `console.log` — write to a scratch file.
8. `.env.local` (not `.env`) holds the VITE_ keys — all publishable/client-side.
9. `npx supabase` CLI has **no config READ path**; never use it to fix a redirect URL.
10. `config.toml` is the source of truth for `verify_jwt`.
11. **No `deno` binary locally** — edge function type errors only surface at deploy.
12. `tre-forged-conductor/` is untracked and belongs to a PARALLEL session. Never `git add -A`.
13. Supabase MCP `generate_typescript_types` returns a JSON envelope too large to paste; read the
    persisted tool-result file and extract `.types` with node.

## Browser-verification recipe (session 105, reusable)

Radix tabs do **not** switch on `element.click()`. Dispatch the full pointer sequence:

```js
for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
  el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(
    t, {bubbles:true, cancelable:true, button:0, pointerId:1}));
```

And to check a recharts line's SHAPE without a working tooltip, parse the `d` of
`.recharts-line-curve` and diff consecutive y's. A ~90% slope drop at one index that stays
positive afterwards is exactly "contributions stopped, interest continues" — but the y values
are SVG units, so anchor them to two known dollar figures before quoting any dollar amount.
`computer{action:'hover'}` did not populate the recharts tooltip; do not burn calls on it.

## Lessons (session 105)

**When one surface disagrees with three others, fix the outlier by making it CALL them.** The
chart had its own accrual loop and no cutoff. The fix was not to re-implement the cutoff in the
chart but to move the `+1 / 0` rule into a single exported function both sides call — the same
class of drift `getGoalEffectiveApyPercent` was created to kill in §2.5.

**Prove the fix in the units the user sees.** "The slope drops" is a shape claim; "$20,548 not
$25,000" is the claim Tre can check. Anchor pixel geometry to two known dollar values before
reporting a number, or don't report a number.

Prior sessions' lessons (1-104) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
