# Handoff — 2026-08-08 — session 108 — §2.9 SHIPPED + live-verified. Next task is decided but NOT started.

> Session 108 closed carried item 2 (§2.9 car-fund earmark), commit **`cab6efda`**, live-verified in
> demo mode. **NOT pushed** (standing rule). `main` is 2 ahead of `origin/main`.
>
> **The next task is already chosen and specced** — see "§2.10 NEXT UP" below. Tre asked for it
> mid-session; it has a recommendation but no code. Start there.

## ✅ §2.9 SHIPPED — `cab6efda` — earmark shortfall is surfaced, not clamped away

**Root cause:** `getCarFundEarmark` subtracted a user-typed `current_saved` from the funding
account's balance with no check the saved cash was actually IN that account, and BOTH callers
absorbed the difference with their own `Math.max(0, balance - earmark)`. Demo rendered
`Balance on hand $0` against a $2,800 checking balance with no explanation.

Tre's two decisions (2026-08-08), both implemented — **do not re-litigate**:

1. **Earmark is its own chain row.** `chain.fundingBalance` is now **GROSS**; new
   `chain.carSavedEarmark` carries the deduction. `cashPreDebt` unchanged to the cent.
2. **Shortfall is named, not absorbed.** New `chain.carSavedShortfall` is **deliberately NOT in the
   cashPreDebt identity** — it is a data-consistency signal, not money leaving the account, and
   folding it would double-count against a balance that never held it. It rides as copy: on the
   earmark row when some applied, on the **balance row** when none could (that user is exactly the
   one who needs the explanation and there is no row to hang it on).

`resolveCarFundEarmark(carFunds, fundingAccountId, accountBalance) -> {requested, applied, shortfall}`
in `vehicle-loan-engine.ts` now **owns the clamp**, so `forecast-engine.ts` and `useCardProjection.ts`
cannot drift on how an over-claim is absorbed. A test pins
`max(0, balance) - applied === max(0, balance - requested)` across the sign boundaries
(-500, -0.01, 0, 0.01, … 99999), so the refactor **provably moves no cash figure**.

Files: `vehicle-loan-engine.ts`, `debt-model-types.ts`, `useCardProjection.ts`, `forecast-engine.ts`,
`month0-budget-snapshot.ts`, `Dashboard.tsx`, `demo-data.ts` + 3 test files.

**Demo fixture** (Tre's call): Civic `current_saved` **3200 → 1200** against d1's $2,800. Coherent,
and it still **exercises** the earmark path instead of showing a clamped zero. Keep it below d1's
balance if that balance ever changes.

**Live-verified in demo, on screen:** `Balance on hand $2,800.00`, `Already saved toward a car
−$1,200.00`, and the rendered column folds to **$4,103.69 = the engine's Projected remaining**.
**Do not re-verify this.** Final gate: **560/560 tests (14 new), tsc 0, eslint 0.**

Backups: `backups/2026-08-08_102744/`.

## 🔜 §2.10 NEXT UP — how "amount saved" is marked against a linked account (Tre asked, 2026-08-08)

Tre's question, verbatim: *"whats the best way to mark the amount saved for a linked account? could
the user also be allowed to set it as a percentage of their linked account or set a value?"*

**Answered with a recommendation but NO code written and NO decision confirmed.** This is the open
item — get Tre's yes/no on the shape below, then build it.

**Why it matters:** §2.9 treated the symptom. The root cause is that `car_funds.current_saved` is a
number the user TYPES while the account balance is a number the BANK reports, with nothing keeping
them consistent. §2.9 makes the drift visible; this makes it structurally impossible.

**The precedent already in this repo:** savings goals ALREADY derive from the account when linked —
see `demo-data.ts:183` *"Emergency Fund linked to Marcus HYS (d3) so balance auto-pulls from the
account."* Car funds never got that treatment. Same class of drift as
`getGoalEffectiveApyPercent` (§2.5) and `contributionCutoffIdx` (§97.3).

**Recommendation: a `saved_source` mode with three options, defaulting to derived.**

| mode | meaning | §2.9 shortfall possible? |
|---|---|---|
| `account_balance` (**default when an account is linked**) | saved = the linked account's whole balance | **No** — structurally impossible |
| `account_percent` | saved = N% of the linked account's balance | **No** — self-limiting |
| `fixed` (today's behavior) | saved = typed `current_saved` | Yes — §2.9's warning is the guard |

- **Percentage earns its place**: it is the honest model for a commingled HYS holding both the
  emergency fund and car money, and it can never exceed the balance.
- **`fixed` must stay**: every existing car fund uses it, and it is the only sane model when the
  money is commingled in checking and the user wants an exact figure.
- Shape: `saved_source text` + `saved_percent numeric` columns; keep `current_saved` as the `fixed`
  value. Route ALL reads through ONE helper `getCarFundSaved(cf, accountBalance)` — same
  single-source pattern as above. `resolveCarFundEarmark` then consumes that helper.

**Two caveats to raise with Tre before building:**
1. Derived modes make the saved figure **move with the balance** — a payday makes "car savings" jump
   and the projected purchase date shift. Surprising for something users read as a goal. Needs the
   progress bar understood as "current", not "committed".
2. A percentage against an account that ALSO backs a savings goal can **double-count** (100% car +
   the emergency fund's own claim on the same HYS). Worth validating that claims against one account
   sum to ≤ 100%.

## Still open (carried, renumbered)

1. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
2. **§2.10 above** (was: §2.9 car-fund earmark, now shipped).
3. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop; §1 is settled.
   **Needs Tre's go-ahead** (irreversible), which is why session 108 did not do it.
4. Native Plaid Hosted Link device verification (needs a physical device).
5. Stage A's pending→posted retirement path still **not exercised against real data**.

## Closed previously (do not reopen)

§1A Stage C (all parts, session 103), 97.1 `/debt` TOTAL LIMIT tile ($25,400), `types.ts` regen
(session 104), remote access (Tailscale+RDP, sessions 104/107 — lives OUTSIDE this repo in
`C:\Users\tvonh\Desktop\remote-access\`; **this repo is PUBLIC**), **97.3** (all parts, incl. the
goal chart earning interest after contributions stop, live-verified session 107), and now **§2.9**.

**Re-check each session:** only Discover has a `sync_cursor` (143 rows). The car-loan funding
account `933cbc10…` is Chase TOTAL CHECKING with 0 synced transactions. The moment a
checking-account cursor appears, §1A Stage C stops being a no-op and the gates go live for real.

## Live drift worth knowing (not a bug, do not chase)

Live shows **CC Debt Free Oct 2028**; the fixture golden pins **Jul 2027**. The fixture is from
2026-07-20 and live balances have moved. The golden asserts against the fixture, not live.
Do not "fix" the golden to match live.

## Push status

**`main` is 2 ahead of `origin/main`** (`35a02172` session-107 handoff + `cab6efda` §2.9).
`origin/main` = `09622e53`. Standing rule: **never auto-push** — session 107's push was a one-off
explicit authorization and does NOT carry forward. Verify with
`git rev-list --count origin/main..main`.

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
