# Handoff — 2026-08-07 — session 103 — §1A STAGE C PART 2 LIVE-VERIFIED (number-neutral)

> Stage C part 2 is **verified number-neutral against real data** and confirmed live on both
> surfaces. §1A Stage C is DONE. 97.1 also closed. Nothing pushed. No code changed this session —
> verification only, so the only commit is this handoff.

## ▶ START HERE

**Tre's request (2026-08-07, while away): a keep-signed-in helper for localhost dev sessions.**
He wants the local app to stay signed in so verification sessions don't stall on a login wall, and
asked for "a script we can trigger to keep me signed in" that later sessions can auto-engage after
the first manual sign-in.

What is already known, so the next session does not re-derive it:
- The Claude-controlled Chrome is a **separate profile** from Tre's browser. It had no session at
  the start of this session; Tre signed it in manually mid-session, which unblocked everything.
- Supabase's JS client **auto-refreshes** the access token while a tab has the app open, so the
  practical failure mode is a CLOSED tab / new origin, not an expiring token.
- **Session state is per-origin.** This is why a second dev server on port 8081 is NOT signed in
  even though 8080 is — it sank the live before/after plan below. Any helper must keep the SAME
  origin (`http://localhost:8080`).
- Do NOT script credential entry. Passwords are off-limits. The workable shape is: keep a tab
  parked on the app, and/or persist the refresh token in the Claude Chrome profile so the first
  manual sign-in carries forward.

Then the carried items below.

## What was verified this session, and how (so it is not redone or weakened)

The claim: with no synced transactions on the car-loan funding account, Stage C part 2 changes no
number. Verified three ways, on REAL data.

**Method — two throwaway git worktrees**, one at `5fe4891b^` (pre-Stage-C) and one at HEAD, each
with `node_modules` junctioned from the main tree and the gitignored
`forecast-inputs.real.json` copied in. A temp vitest file dumped the ENTIRE `calculateForecast`
result to JSON for byte comparison — not just END CASH, so nothing downstream can move unnoticed.
**Tre's working tree was never checked out to an old commit** (a parallel session is live in it).

| Run | Result |
|---|---|
| pre-Stage-C vs HEAD, fixture as-is (no `syncedTransactions`) | **byte-identical** |
| pre-Stage-C vs HEAD + rows on DISCOVER (today's production shape) | **byte-identical** |
| pre-Stage-C vs HEAD + rows on the CHASE funding account (positive control) | **differs** — month-0 insurance 173.23 → 0 |

The positive control is what makes the other two mean anything. Without it the harness could have
been silently unwired and every comparison would have "passed".

**Live, both surfaces, real data (Aug 2026 = month 0):**
- Forecast month-0 END CASH = **$2,700**
- Dashboard MONTH-END CASH = **$2,700** — the two surfaces agree
- Dashboard month-0 snapshot charges **Auto loan payment $422.89** and **Vehicle insurance
  $173.23**. Both present ⇒ the date heuristic is running and evidence is `undefined`, exactly as
  designed. Nothing was dropped.

**Live premise re-confirmed by SQL:** only Discover has a `sync_cursor` (143 rows). The car-loan
funding account `933cbc10…` is **Chase TOTAL CHECKING with 0 synced transactions**. Alliant, Amex,
Chase, Empower, Robinhood all `sync_cursor IS NULL`. Re-check this next session — the moment a
checking-account cursor appears, this stops being a no-op and the gates go live for real.

## ⚠ Two traps that cost time — do not repeat

1. **A "positive control" that injects a MATCHING amount proves nothing here.** `matchCharge`
   returning `matched:true` and the date heuristic can reach the SAME verdict, so the numbers do
   not move and the harness looks vacuous. The only input whose verdict differs from the heuristic
   is **coverage on the funding account with the charge due BEFORE the cutoff** — or, as used here,
   an unambiguous match on a charge the heuristic would otherwise have charged.
2. **`matchCharge` requires exactly ONE candidate.** The first harness wrote a matching row on
   every day of a 90-day span, so ~11 identical amounts landed inside `DATE_WINDOW_DAYS` and the
   matcher correctly refused to guess (`best.length === 1` fails ⇒ `null`). That read as "matching
   is broken" for a while. It is not broken; the harness was ambiguous. Inject **one** premium-sized
   row plus non-confusable coverage rows.

Also: the fixture's month-0 car-loan payment gate is **inherently** number-neutral —
`payment_start_date` is `2026-08-07`, so no July payment exists to drop either way. Insurance
(anchor `2026-06-25`, due `2026-07-25`) is the only observable car gate in that fixture.

## Closed this session

- **97.1 `/debt` TOTAL LIMIT tile** — reads **$25,400**. Verified live. CLOSED.
- **§1A Stage C part 2 live verification** — CLOSED (above).

## Still open (carried)

1. **Keep-signed-in helper** — see START HERE.
2. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save → rule
   shows end date in `/budget` + card shows "Auto-ends contributions". Sign-in works now.
3. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
4. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
5. §2.9 car-fund earmark.
6. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop; §1 is settled now.
7. Native Plaid Hosted Link device verification (needs a physical device).
8. Stage A's pending→posted retirement path still **not exercised against real data**.
9. `types.ts` still **overdue a full regen** (predates §1/§1A, hand-written `synced_transactions`
   block). Do it on its own commit; a regen rewrites the whole file.

## Live drift worth knowing (not a bug, do not chase)

The live app now shows **CC Debt Free Sep 2028**; the fixture golden pins **Jul 2027**. The fixture
is from 2026-07-20 and the live balances have moved since (Discover $9,726, Prime $7,527). The
golden test asserts against the fixture, not against live, so both are correct. Do not "fix" the
golden to match live.

## Push status

`main` is **24 commits ahead** of `origin/main` before this handoff commit. Standing rule is never
auto-push. **Nothing pushed.** Verify with `git rev-list --count origin/main..main`.

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2`; Discover account =
  `34c9574b-3557-4729-a812-f0b1b508b882` (still the ONLY account with synced transactions).
- Car loan payment account = `933cbc10-bceb-4c20-8227-4a02e6db728a` (**Chase TOTAL CHECKING**).
- `sync_cursor` lives on **`financial_connections`**, NOT on `accounts`.
- `financial_connections` uses **`last_synced_at`** and **`connection_status`**.
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`.

## Environment gotchas (carried)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. The Claude-controlled Chrome is a **separate profile**; check, don't assume.
3. Dev server `localhost:8080`. `/budget`, `/debt`, `/forecast`, `/dashboard`.
4. `/budget` rules split across tabs; `cost_type` overrides category ("Dog food" is **Variable**).
5. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
6. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
7. Vitest suppresses `console.log` — write to a scratch file.
8. `.env.local` (not `.env`) holds the VITE_ keys — all publishable/client-side.
9. `npx supabase` CLI has **no config READ path**; never use it to fix a redirect URL.
10. `config.toml` is the source of truth for `verify_jwt`.
11. **No `deno` binary locally** — edge function type errors only surface at deploy.
12. `tre-forged-conductor/` is untracked and belongs to a PARALLEL session. Never `git add -A`.

## Worktree recipe (reusable — this is how to prove "nothing changed" against real data)

```
git worktree add --detach <scratch>/wt-before <commit>^
# junction node_modules (Windows): cmd /c mklink /J <wt>\node_modules <repo>\node_modules
# copy the gitignored fixture in, drop a temp vitest file that JSON-dumps the whole result
# ALWAYS remove the junction with `cmd /c rmdir <link>` BEFORE `git worktree remove`,
# or the recursive delete can follow the junction into the REAL node_modules.
```

## Lessons (session 103)

**A neutrality proof is worthless without a positive control.** "The numbers did not change" is the
expected result of a correct change AND of a completely unwired one. Two of the three comparisons
here were byte-identical before the harness was even reaching the gate. Always include an input
that MUST move the number, and treat the whole verification as unproven until it does.

**Same-verdict inputs cannot serve as a control.** The first control fed a matching transaction —
but "matched" and the date heuristic agree in that case by design, so the numbers correctly did not
move. Pick the control from where the two rules DISAGREE, not from where the new code merely runs.

**Session state is per-origin, which quietly rules out the obvious live A/B.** Running the old
commit on port 8081 to compare live numbers cannot work: it is a different origin and therefore a
signed-out app. The offline replay of real inputs is the stronger evidence anyway — it compares
every number in the forecast, not one rendered tile.

Prior sessions' lessons (1-102) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
