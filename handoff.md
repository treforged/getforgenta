# Handoff — 2026-08-08 — session 111 — item 6 checked (not yet fired); work queue EXHAUSTED

> Session 111 wrote **no code**. It ran item 6's watch (the predicted first Stage C number move):
> the $422.89 car payment is **still pending, unchanged** — no flip yet, re-check next session.
> It also corrected a real error in the session-110 connection table (see below).
> Tree clean, **583/583 green**. **`main` is now 0 ahead of `origin/main`** — the 8 commits session
> 110 listed as unpushed have since been pushed (parallel session or Tre; not this session).
>
> ⚠️ **All non-blocked handoff items are now closed.** Items 4 and 6 are waits, not tasks. There is
> no §2.11 and no queued plan item — picking the next workstream is Tre's call. See "Next" below.

## Item 6 — first live Stage C flip: checked 2026-08-08 ~16:35 UTC, HAS NOT FIRED

Nothing to do; the bank has not settled the charge. Re-run the two queries next session.

- The $422.89 row on `933cbc10…` is **still `pending: true`**, dated 2026-08-07, `created_at`
  2026-08-08 13:00 UTC — i.e. unchanged since session 110 saw it.
- The account still holds **138 rows / 4 pending**, latest **settled** still **2026-08-05**.
- Sync is **fresh, not stale**: all of Tre's connections synced 2026-08-08 13:00 UTC (~3.5h before
  the check). Discover last synced 08-07 15:50. So this is bank settlement lag, not a sync failure.

Both Stage C conditions therefore still evaluate exactly as traced in session 110 (`matched: false`
via the pending skip, `hasTxnCoverage: false` since 08-05 < 08-12). **Still number-neutral, still
for the verified reason.** The prediction in the section below stands unchanged.

## ⚠️ Correction to session 110's connection table — one row was NOT Tre's

The session-110 table listed **7 connections as if all were Tre's**. Filtering
`financial_connections` by `user_id = a72f416e…` returns **6**. The second Chase connection,
**`eaddb4e3-4d07-4554-b207-d2cacbdda106` (128 rows, 5 pending)**, belongs to a **different user**
(`25e2e6bf-4c62-4313-8a26-99c44d8dfce6`) — another account on the app, not Tre's.

Not a bug, and it changes no Stage C conclusion (the car fund's account `933cbc10…` is on Tre's
`de492512…` Chase connection). But **any live tracing must filter by Tre's `user_id`**, or it will
silently read a stranger's rows. `synced_transactions` totals in the old table were cross-user.

## ✅ Item 5 CLOSED — pending→posted retirement verified against real data

`synced_transactions` is now **699 rows across 6 connections** (was 143, Discover only). That is
enough real traffic to test the retirement path directly, and it is clean:

- **270** posted rows carry a `pending_transaction_id`, and **0** of those pointers resolve to a
  still-live row. Every superseded pending row was retired. (Self-join on
  `connection_id + provider_transaction_id`.)
- **0** pointer-less duplicates — no (same account, same amount, one pending + one posted, within
  6 days) pair exists anywhere, so the path is not missing charges where Plaid omits the pointer.
- The **10** surviving pending rows are all **1-2 days old** (dated 08-06/08-07). Legitimately
  in-flight, not stranded.

The double-count `SETTLEMENT_LAG_DAYS` exists to prevent is not occurring in live data.

## ⚠️ The standing re-check FIRED — Stage C is no longer a structural no-op

Previous handoffs said "only Discover has a `sync_cursor`… the moment a checking-account cursor
appears, §1A Stage C stops being a no-op." **That moment has arrived.** All 7 connections now have
cursors; 6 synced 2026-08-08 13:00 UTC:

| Institution | conn | rows | pending |
|---|---|---|---|
| Chase | `de492512…` | 376 | 4 |
| Discover | `881f3807…` | 143 | 0 |
| Chase | `eaddb4e3…` | 128 | 5 |
| American Express | `6e1f30db…` | 34 | 1 |
| Alliant | `12dd917f…` | 18 | 0 |
| Robinhood / Empower | — | 0 | 0 |

The car-loan funding account `933cbc10…` (**Chase TOTAL CHECKING**) went **0 → 138 rows**, settled
range **2026-01-17 → 2026-08-05**, `account_id` resolved on every row (0 untracked).

### Stage C is still number-neutral today — and now for a VERIFIED reason

Traced by hand for the live car fund (`0f75dec9…`, 2004 Chevorlet C5, `loan_payment_account` =
`933cbc10…`, `actual_monthly_payment` **$422.89**, `payment_start_date` **2026-08-07**):

- **The real payment is sitting PENDING** — matching amount and date, on the loan payment account.
  There is **no settled** row near that amount on that account. (Descriptor deliberately not quoted:
  this repo is PUBLIC. Re-read it from `synced_transactions` if a future session needs it.)
- `matchCharge` skips pending rows → `matched: false`.
- `hasCoverage` needs latest **settled** ≥ dueDate+5 = **2026-08-12**; latest settled is
  **2026-08-05** → `hasTxnCoverage: false`.
- Both false → `isCapturedInBalance` falls through to the date heuristic, byte-identical to
  pre-Stage-C. **No projected number moves.**

This is the design working, not a gap: pending is not settled evidence, and the gate declines to
conclude anything rather than guess.

### 🔜 Predicted FIRST real Stage C number move — worth watching

`matched` is honoured **without** coverage (`sync-cutoff.ts:102-105`), so the moment that $422.89
settles, the August car payment flips to **captured** and drops out of month 0. Under the heuristic
alone that drop would not occur until `balanceAsOf ≥ 2026-08-11` (dueDate 08-07 `<` basis−3). So
Stage C should retire the charge **~2 days earlier than the old rule**, which is the entire point
of §1A. If the payment settles and the August car payment does **not** drop, that is a real bug —
check that the settled row kept a date within ±5 days of 08-07.

## ✅ §2.10 SHIPPED — `80f72c2d` — percent-of-linked-account saved source

**The audit corrected the spec, and this is the part worth carrying forward.** Car funds ALREADY
derive from the linked account at nine read sites — but only when that account is *separate* from
the funding account. That guard is load-bearing (`forecast-engine.ts:406-408`): when the linked
account IS the funding account, its balance is already offered as available cash, so calling it
"saved" too double-counts. Therefore the originally specced **`account_balance` mode was dropped** —
it already exists where it is valid and would be actively wrong in the exact case §2.9's drift lives
in. **Do not re-propose it.**

`getCarFundSaved(cf, fundingAccountId, linkedAccountBalance)` in `vehicle-loan-engine.ts` is now THE
single source; both rules (percent, and separate-account-derives-live) live in it, and all ten call
sites route through it including `getCarFundEarmark`. Under `'fixed'` it returns exactly what each
site computed inline before — pinned across all six link/funding/balance shapes, so §2.10 **moves no
existing cash figure**.

DB (migration `car_funds_saved_source`, applied live): `saved_source` (`'fixed'|'account_percent'`,
default `'fixed'`) + `saved_percent`, with three CHECKs (enum, 0-100, percent requires a linked
account). **All existing rows are `'fixed'`** — verified, zero behavior change.

Gate: **578/578 tests (18 new), tsc 0**, eslint unchanged (the 1 `useCardProjection` exhaustive-deps
warning is PRE-EXISTING — verified by stashing).

Deliberate calls, do not re-litigate:
- **Demo stays on `'fixed'`.** The only percent reproducing §2.9's live-verified $1,200 against d1's
  $2,800 is 42.857…%, which puts float noise into an on-screen money figure. Percent mode is
  covered by unit tests instead.
- **Two divergences preserved, not unified**: the fallback purchase-date estimator
  (`forecast-engine.ts`) and the lump-sum path (`useCardProjection.ts`) have always derived from ANY
  linked account, funding one included. They pass a **null funding id** so percent mode is added
  without changing which account they read. Unifying them is a separate, behavior-changing decision.

Files: `vehicle-loan-engine.ts`, `types.ts`, `forecast-engine.ts`, `useCardProjection.ts`,
`Dashboard.tsx`, `Vehicles.tsx`, `demo-data.ts`, `integrations/supabase/types.ts` + 7 test files.
Backups: `backups/2026-08-08_105248/`.

### ✅ §2.10 UI — LIVE-VERIFIED (session 109, demo mode + DB round-trip). Do not re-verify.

On screen in demo, Vehicles → Saving for Down Payment → edit the Civic:
- Form labels include **"Amount Saved"**; **"Current Saved" is correctly absent** (d1 is linked).
- Its select carries exactly `['fixed','account_percent']`, defaulting to `fixed`.
- Switching to `account_percent` reveals **"Percent of Balance Saved for This Vehicle"** and swaps the
  hint to *"Tracks the balance, so it can never claim more than the account holds."*
- The Civic card reads **$2,800 / $5,600 (50%)** — the linked-balance derivation, unchanged by §2.10
  (stored `current_saved` is $1,200; the card correctly shows d1's live $2,800).

DB round-trip verified against the real project: a throwaway `account_percent` row inserted and
**deleted** (only Tre's `2004 Chevorlet C5` remains, untouched — confirmed by SELECT), and the
`car_funds_saved_percent_requires_account_check` constraint correctly **rejected** percent mode with
a null linked account.

⚠️ **CTE gotcha, cost a cleanup call:** `WITH ins AS (INSERT…), del AS (DELETE … WHERE id IN (SELECT
id FROM ins))` reports `rows_deleted: 0` and **leaves the row behind** — the DELETE reads the same
snapshot and cannot see the just-inserted row. Insert-then-verify-then-delete needs SEPARATE
statements. Always re-SELECT to confirm cleanup actually happened.

Not exercised: clicking Save in demo (demo mode does not write to the DB). The payload construction
is plain code and the DB constraints are verified; this is not worth a real-account write.

## Still open (carried, renumbered)

1. ~~Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`~~ — **CLOSED session 110 as SKIP, now measured rather than
   assumed.** The item is 4b's goal auto-stop: both sites count a transfer/investment rule as a cash
   outflow after its savings goal is fully funded, because `goals` are not in scope on either call
   chain, so the debt engine slightly UNDER-recommends payments in that window.

   **Live effect is $0, and structurally so.** Two things close it: (a) both sites already honour
   `recurring_rules.end_date`, and 97.3's auto-end toggle WRITES that date on a goal's linked rules,
   so every toggle-on goal is correct by construction; (b) the gap only bites if a goal completes
   inside `PROJECTION_MONTHS` (60). Measured 2026-08-08 — **none of the four goals does**:
   Brokerage ~month 335, Roth IRA ~month 280, 401K Roth has no linked rule at all, and Savings
   (the nearest) lands ~**month 62**, just past the horizon — and its HYS rule already carries a
   user-set `end_date` of 2031-06-30 (~month 58) that both sites honour anyway.

   Fixing it means threading a completion cutoff into the 60-month convergence loop — the engine
   with ~12 rounds of hard-won fixes — for zero dollars. Not a trade worth making. Both sites now
   carry the analysis in place so it is not re-derived a fourth time.

   **REOPEN WHEN:** a goal's linked contributions complete it inside 60 months while its rule
   carries no `end_date`. **This is now AUTOMATED** (`347d051f`, Tre's call — "you should just test
   for that"): `src/lib/__tests__/goal-contribution-overrun.test.ts` fails the moment that becomes
   true, so nobody has to remember to re-measure it. The real-data half reads the gitignored
   fixture and skips where it is absent (CI); the synthetic half always runs.

   ⚠️ **`computeGoalCompletionIdx` is NOT bounded by `PROJECTION_MONTHS`.** It returns indices
   9-14 years out on Tre's real goals. The first version of this guard treated "returns a date" as
   "completes in-horizon" and flagged all three linked goals; it must bound the index against
   `PROJECTION_MONTHS` explicitly. It also has its OWN much-longer internal cap (a $100k goal at
   $25/mo returns null), so a test case meant to sit "past 60" needs to land in the gap — ~100
   months works. Both traps are now pinned by tests.
2. ~~§2.10 UI live-verification~~ — **DONE session 109**, see above. §2.10 fully closed.
3. ~~`backup.plaid_items_20260807` / `backup.accounts_20260807`~~ — **CLOSED AS KEEP. Tre decided
   2026-08-08: "don't drop them — close the item as keep." Do NOT re-propose dropping these.**
   They are the 2026-08-07 §1 snapshot (7 + 31 rows), kept because the org is on the **free plan —
   no PITR, no automated backup**, so this is the only copy of pre-§1 state. Live counts match
   exactly (31/31, 7/7) and the `backup` schema has **no grants to anon/authenticated/public**, so
   it is not an exposure. 38 rows is not worth an irreversible drop.
4. Native Plaid Hosted Link device verification (needs a physical device).
5. ~~Stage A's pending→posted retirement path not exercised against real data~~ — **CLOSED session
   110**, verified clean at 699 rows / 270 pointers. See above. Do not re-verify.
6. **Watch the first live Stage C flip** (see prediction above). Not a task; a check to run each
   session: has the $422.89 settled, and did the August car payment drop from month 0?
   **Checked session 111 — still pending, has not fired.** See the item 6 section at the top.

## Next — nothing is queued; needs Tre's pick

Items 4 and 6 are **waits** (physical device / bank settlement), not work. Everything else on this
handoff is closed. There is no §2.11 — the §2.x series ended at §2.10 — and `docs/` holds no
unstarted plan item. Forecast-engine **Stages 4-5 remain deliberately on hold**, and Stage 6 (wire
Goals + AI Advisor to the engine) has never been scoped.

Candidates, if a future session needs a starting point: forecast-engine Stage 6, or the roadmap's
FB.6-13 UX items. **Do not start either without Tre choosing** — both change scope.

## Closed previously (do not reopen)

§2.10 (session 109, code+DB+UI, fully live-verified), §1A Stage C (all parts, session 103), 97.1 `/debt` TOTAL LIMIT tile ($25,400), `types.ts` regen
(session 104), remote access (Tailscale+RDP, sessions 104/107 — lives OUTSIDE this repo in
`C:\Users\tvonh\Desktop\remote-access\`; **this repo is PUBLIC**), **97.3** (all parts, incl. the
goal chart earning interest after contributions stop, live-verified session 107), **§2.9**, and now **§2.10**.

**~~Re-check each session~~ — RESOLVED session 110.** This said "only Discover has a `sync_cursor`
(143 rows); the car-loan funding account `933cbc10…` has 0 synced transactions." **All of that is
now stale** — every connection has a cursor, TOTAL CHECKING has 138 rows, and Stage C's evidence
path is live. See the Stage C section above. Do not carry the old wording forward.

## Live drift worth knowing (not a bug, do not chase)

Live shows **CC Debt Free Oct 2028**; the fixture golden pins **Jul 2027**. The fixture is from
2026-07-20 and live balances have moved. The golden asserts against the fixture, not live.
Do not "fix" the golden to match live.

## Push status

**`main` is 0 ahead of `origin/main` as of session 111** — the 8 commits session 110 recorded as
unpushed (through `875ea2a7`) are now on the remote. **Session 111 did not push them**; a parallel
session or Tre did. Standing rule is unchanged: **never auto-push** — session 107's push was a
one-off explicit authorization and does NOT carry forward. Always re-verify with
`git rev-list --count origin/main..main` rather than trusting this line; it went stale within one
session last time.

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
2. ⚠️ **CHANGED 2026-08-08:** the Claude-controlled Chrome is now **SIGNED OUT** — session 107's
   parked signed-in tab is gone. `localStorage` had **no `sb-*` key**. Probe before assuming.
3. **Demo mode is in-memory React state, NOT a URL or a flag.** There is no `/demo` route and no
   localStorage toggle. Go to `/auth` and dispatch the full pointer sequence on the **"Try Demo"**
   button; it navigates to `/dashboard`. `useSupabaseData` then serves `demoAccounts`
   (`useSupabaseData.ts:19-29`, Chase Checking `d1` = **$2,800**) + `demo-data.ts`.
4. ⚠️ **`javascript_tool` returns `[BLOCKED: Cookie/query string data]`** when the result is a large
   array of page strings. It is not a page error. Fix: return a **small structured object of just
   the values you need** (label → amount map), not a dump of every text leaf. Cost me 2 calls.
5. Dev server `localhost:8080`, `strictPort`. Start with `node scripts/dev-session.mjs up`.
6. `/budget` rules split across tabs; `cost_type` overrides category ("Dog food" is **Variable**).
7. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
8. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
9. Vitest suppresses `console.log` — write to a scratch file.
10. `.env.local` (not `.env`) holds the VITE_ keys — all publishable/client-side.
11. `npx supabase` CLI has **no config READ path**; never use it to fix a redirect URL.
12. `config.toml` is the source of truth for `verify_jwt`.
13. **No `deno` binary locally** — edge function type errors only surface at deploy.
14. `tre-forged-conductor/` belongs to a PARALLEL session. Never `git add -A`; list files explicitly.
15. Supabase MCP `generate_typescript_types` returns a JSON envelope too large to paste; read the
    persisted tool-result file and extract `.types` with node.
16. ⚠️ **`handoff.md` is committed to a PUBLIC repo.** It is a working note, but it ships to GitHub.
    Amounts, account UUIDs and `user_id` are the established (accepted) level of detail. Do NOT add
    raw bank transaction descriptors, merchant/counterparty names, or anything pulled verbatim out
    of `synced_transactions` — cite the amount and date and let the next session re-query the row.
    Session 110 pasted one descriptor and had to scrub it after pushing.

## Browser-verification recipes (reusable)

Radix tabs do **not** switch on `element.click()`. Dispatch the full pointer sequence — this is also
how you enter demo mode (gotcha #3):

```js
for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
  el.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(
    t, {bubbles:true, cancelable:true, button:0, pointerId:1}));
```

**Verifying a snapshot/chain equation on screen** (session 108, better than parsing SVG): pair each
known row label with the next money-shaped text leaf, then fold it yourself and compare to the
rendered total. Proves the column adds up in the units Tre sees:

```js
const leaves=[...document.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>e.textContent.trim());
const i=leaves.indexOf('Balance on hand');
const amt=leaves.slice(i+1,i+4).find(t=>/^[−+-]?\$[\d,]/.test(t));
```

For a recharts line, read exact rows off the **React fiber** (walk up from `.recharts-surface` via
`__reactFiber$` until `memoizedProps.data` has `month`) rather than parsing `d` geometry.
`computer{action:'hover'}` does not populate the recharts tooltip; do not burn calls on it.

## Lessons

**Session 111 — a multi-tenant table does not owe you a single tenant.** Session 110 grouped
`synced_transactions` by `connection_id` with no `user_id` filter, got 7 connections, and wrote them
up as Tre's. One of them is another user's. Every count in that table was cross-user. The app has
real users now, so **the unfiltered query is the wrong query by default** — the standing "always
filter by Tre's `user_id`" rule exists for reads, not just writes, and grouping by a foreign key is
exactly where it gets forgotten.

**Session 111 — a stale push-status line is worse than none.** The handoff asserted "8 ahead" as
fact; it was 0 by the time it was read, because another session pushed. Anything about mutable
external state should be written as a command to run, not a value to trust.

**Session 110 — if a deferral rests on a property of the DATA, encode it as a test, not a note.**
Tre's call, and the right one: item 1's skip was justified by "no goal completes inside 60 months",
which can stop being true with no code change and no one noticing. A note asks a future session to
re-measure; a test just fails. Writing it also caught a real error in my own reasoning
(`computeGoalCompletionIdx` is not horizon-bounded), which the prose version would have preserved
indefinitely — **a claim you can execute gets checked; a claim you can only read does not.**

**Session 110 — price a deferral before re-carrying it.** Item 1 rode four handoffs as
"Recommendation: skip" with the reasoning compressed out of it. Reading the original entry showed it
was 4b's goal auto-stop, and four SQL queries showed the effect is $0 because no goal completes
inside the projection horizon and 97.3's `end_date` writes already cover the toggle-on case. A
deferral with its reasoning stripped is indistinguishable from an unexamined one — either restate
the cost or close it.

**Session 110 — a "blocked on real data" item can unblock itself while you aren't looking.** Item 5
sat carried for sessions as un-exercisable because only Discover had synced rows. One `count(*)`
showed the table had grown 143 → 699 and the checking accounts had backfilled; the item was
verifiable in three queries and closed the same session. **Re-measure a blocking condition before
re-carrying it** — the handoff records what was true when it was written, not what is true now.

**Session 110 — "number-neutral" from an untested path and from a traced one are different facts.**
Stage C shipped number-neutral because no checking account had transactions; it is *still*
number-neutral, but now because the real payment is pending, `matched` is false, and coverage ends
2026-08-05. Same observable, completely different confidence. When the precondition for a
no-op changes, re-derive the no-op instead of assuming it held.

**Session 109 — audit the premise before building the spec.** The handoff said car funds "never got"
the derive-from-account treatment savings goals have. One grep showed they had it at nine sites, and
that the guard those sites share made one of the three proposed modes actively wrong. Three modes
became one, and the feature got smaller and more correct. A spec inherited from a previous session
is a hypothesis, not a requirement — cheapest possible check, run it first.

**Session 109 — a guard repeated at every call site is a rule with no home.** `!== fundingAccountId`
appeared at nine sites and was missing from the tenth, which is exactly where §2.9's bug was. Same
shape as session 108's clamp: when you see the same condition copied everywhere, the one place it
was forgotten is where the bug lives.

**Session 108 — a clamp is not a model.** `Math.max(0, …)` at two call sites looked like defensive
arithmetic; it was actually the app deciding, silently, that a data inconsistency didn't exist. When
you find the same clamp duplicated at every caller, the thing being clamped away is usually
information someone needs. Move the clamp into one helper and **return what it discarded**.

**Session 108 — prove a refactor moves nothing.** The risky part of §2.9 was re-expressing a cash
figure the entire debt engine is built on. A test asserting the old and new expressions agree across
the sign boundaries turns "should be equivalent" into a pinned fact, and it costs six lines.

**Session 105 — when one surface disagrees with three others, fix the outlier by making it CALL
them.** Not by re-implementing the rule in the outlier.

**Session 105 — prove the fix in the units the user sees.** "The slope drops" is a shape claim;
"$20,548 not $25,000" is the claim Tre can check.

Prior sessions' lessons (1-107) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
