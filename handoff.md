# Handoff — 2026-08-07 — session 100 — §1A STAGE B SHIPPED AND LIVE-VERIFIED

> Stage A closed last session. This session built Stage B end to end: the pure matcher, the
> `/budget` auto-matched badge, and a live DOM verification of both. **Google sign-in is fixed
> and proven.** Stage C is next. Nothing is pushed.

## ▶ START HERE

**Next work is §1A Stage C** — retire `SETTLEMENT_LAG_DAYS` from rule to fallback in
`src/lib/sync-cutoff.ts`. The design is in `docs/1A-transaction-sync-plan.md` under "Stage C".
It is the only stage that moves a projected number, so per the plan it ships **alone** and gets
live-verified against the $1,463 deposit case on its own.

The evidence source it needs now exists and is proven: `matchOccurrence` in
`src/lib/transaction-matching.ts`.

## Sign-in: FIXED and verified

Tre added `http://localhost:8080/**` to Supabase → Authentication → URL Configuration →
**Redirect URLs** this session. **Verified working**, no session touched:

```
# capture a real state from /authorize, then hit the callback with a bogus code
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "https://<ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A8080%2F")
STATE=$(echo "$LOC" | sed -n 's/.*[?&]state=\([^&]*\).*/\1/p')
curl -sD - -o /dev/null "https://<ref>.supabase.co/auth/v1/callback?code=bogus&state=$STATE"
```

`Location: http://localhost:8080/?error=...Unable+to+exchange+external+code` = **allow-list
accepted**. A rejected redirect bounces to the Site URL (`getforgenta.com`) instead.

**This is the probe that works.** Sessions 96-99 concluded the allow-list was unverifiable over
HTTP; that was half right. `/authorize` does echo any `redirect_to`, and the callback WITHOUT a
valid state fails at `bad_oauth_state` before redirect resolution. The redirect lives in the
state, so you must carry a real state through. Don't re-litigate this — the recipe above works.

## §1A Stage B — what shipped

Commits: `e421add4` (matcher), `7959d29d` (badge). Working tree clean, tsc clean, **489/489**.

### `src/lib/transaction-matching.ts` — `matchOccurrence(rule, monthKey, txns)`

Pure, no I/O. One definition of "matched", read at render time by BOTH the badge and (Stage C)
the forecast, so the two surfaces cannot disagree. Not persisted — no `matched_rule_id`.

**Design bias: silence over guesses.** Every ambiguity returns `null`, including "two candidates
are equally good". 32 tests pin this; they exist to make a hit-rate "improvement" fail loudly.

### Three plan-doc facts that were WRONG, corrected against live data

1. **`payment_source` is a BARE `accounts.id` uuid** on all 28 non-null rules — not
   `accounts.name` as the plan sketched. The account test is id equality against
   `synced_transactions.account_id`. The legacy `account:` prefix is still stripped for demo
   fixtures.
2. **Tre has 31 rules, not 431.** The 431 in the old handoff and plan doc is the all-users row
   count. Any capacity reasoning built on 431 is wrong.
3. **weekly/biweekly `due_day` is a day of WEEK** (`scheduling.ts:215`), not of month. Those
   frequencies are REFUSED, along with `semi_monthly` (one due_day cannot describe two
   occurrences). Monthly + yearly still covers 29 of 31 rules. Do not "add support" for the
   other two without solving the occurrence-date problem first.

### Tolerance calibration (a real decision, not a default)

Amount band is **proportional: 1%, with a $0.05 floor**. An absolute ~$1 floor was written
first, and a test caught that it let a $10 rule accept a $10.75 coffee. Cards are mostly small
discretionary charges, so an absolute floor is most dangerous exactly where the data is densest.

`DATE_WINDOW_DAYS = 5`. Note the knob points backwards from intuition: **widening it produces
FEWER matches**, because more candidates means more ambiguity and ambiguity resolves to null.

### The badge (`7959d29d`)

- `useSyncedTransactions(monthKey)` in `useSupabaseData.ts` — read-only, no add/update/remove,
  mirroring RLS. Sits directly above `useTransactions` with a comment on each: the failure mode
  that matters is someone mistaking the aggregator table for the user's hand-entered ledger.
  Fetches the month ±7 days, not the whole history.
- Chip on `/budget`, next to the existing `sub` / `from payoff` chips.
- **No negative counterpart chip, by design.** Absence renders as nothing. Most rules stay
  unbadged until every connection backfills, and a "not paid" state would turn that gap into an
  accusation.
- Says **"auto-matched", not "paid"** — evidence of a settled charge, not an accounting claim.
- Computed from real `recurring_rules` rows, so synthetic subscription/debt-sync entries can
  never pick up a badge.

### Live verification (real data, both layers)

**Matcher, via SQL replicating its logic** over the 143 real Discover rows × 6 months × all
monthly expense rules: **exactly one match, and it is correct** —
"Dog food" ($45, due 17th) → `CHEWY INC $44.87 @ 2026-07-16`. **Zero false positives.**
"Eating Out" ($75/mo, a spending budget, same card) matched in **no** month.

**Badge, in the DOM** — `/budget` → Variable tab, month temporarily pointed at `2026-07`:
chip renders on the "Dog food" row with its tooltip, and "Eating Out" on the same card has
**no** chip. The conservatism is visible in the UI. Temp override reverted; tree verified clean.

**Why the temp override was needed:** August has no match (Discover data ends Aug 5, the
matching rule is due the 17th), so the badge is invisible in the current month. Expect it to
look sparse until the other five connections sync. That is correct behavior.

## Facts worth carrying

- Only **Discover** has synced transactions so far (143 rows, one connection). The other five
  are still inside cooldown from Stage A. Badge coverage will jump when they first sync.
- `types.ts` gained a hand-written `synced_transactions` block. The file is **overdue a full
  regen** — it predates §1 (`financial_connections`) and §1A. Regenerate deliberately, on its
  own; a regen replaces the whole file and would drag unrelated drift into a feature diff.
- `BudgetRule.due_day` is optional/nullable in `BudgetControl.tsx`; the badge memo guards on
  `typeof r.due_day !== 'number'`.
- Stage A's pending→posted retirement path is still **not exercised against real data**
  (Discover had no pending rows). Watch for it when the other five sync.

## Still open (carried)

1. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save →
   rule shows end date in `/budget` + card shows "Auto-ends contributions". Sign-in is now
   fixed, and the Claude-controlled Chrome tab is signed in, so this is fully unblocked.
2. **97.1 `/debt` TOTAL LIMIT tile** — should read **$25,400**. Same, unblocked.
3. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
4. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
5. §2.9 car-fund earmark.
6. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop once §1 is settled.
7. Native Plaid Hosted Link device verification (needs a physical device).

## Push status

`main` is well ahead of `origin/main`. Standing rule is never auto-push. **Nothing pushed.**

Check the count with `git rev-list --count origin/main..main` rather than trusting a number
written here. Session 99 spent a commit correcting a hard-coded count, and this session spent
another one — the number counts the very commits that record it, so it is stale the moment it
is written. Don't pin it again.

## Supabase — real IDs (carried)

- Tre `user_id` = `a72f416e-433a-4055-9ab0-9feae4e60edf`. Always filter by it.
- Discover connection = `881f3807-2974-411b-a406-ac6007a6e7d2`; Discover account =
  `34c9574b-3557-4729-a812-f0b1b508b882` (the only account with synced transactions).
- `accounts.account_type` (not `type`); `recurring_rules.rule_type`; `accounts.plaid_account_id`
  is the provider account id.
- `plaid_items` is a VIEW over `financial_connections`; `plaid_item_id` → `provider_item_id`.

## Environment gotchas (carried + new)

1. Tre is signed in on his real account in HIS browser. Never sign him in or out.
2. **The Claude-controlled Chrome tab is a SEPARATE profile** and was signed in by Tre this
   session. Don't assume it shares his session; check, and ask him to sign in rather than
   typing a password.
3. Dev server `localhost:8080`. Budget Control is `/budget`, Debt Payoff is `/debt`.
4. `/budget` rules are split across tabs (Income/Fixed/Subs/Variable/Debt/Transfers). A rule
   "missing" from the DOM is usually on another tab — "Dog food" is **Variable**, not Fixed,
   despite category `Bills`, because `cost_type` overrides category.
5. `npx vitest run --reporter=basic` fails on vitest 4.1.10. Use `npx vitest run`.
6. No PowerShell here-string in a `;`-chained command — use a Bash heredoc.
7. Vitest suppresses `console.log` — write to a scratch file.
8. `npx supabase` CLI is authenticated and linked. **It has no config READ path** — only
   `config push`, which overwrites the entire remote auth config from local `config.toml`
   (which has no `[auth]` block). Never use it to fix a redirect URL.
9. `config.toml` is the source of truth for `verify_jwt` — the CLI flips any undeclared function
   to `true`. All ten are declared.
10. **No `deno` binary locally** — edge function type errors only surface at deploy.

## Lessons (session 100)

**A blocked probe is not a proven negative.** Four sessions concluded the redirect allow-list
could not be checked over HTTP. It could — the check just needed a real OAuth `state` carried
from `/authorize` to the callback, because that is where the redirect is stored. "I tried and it
didn't work" had hardened into "it cannot be done." When inheriting an impossibility, re-derive
WHY it failed before accepting it.

**Let a test kill your first constant.** The $1 amount floor looked obviously reasonable and was
wrong at the small end, where the data is densest. It surfaced because a test asserted a
behavior the implementation didn't have — and the right response was to fix the *constant*, not
the test. Check which one encodes the intent before making them agree.

**Verify the layer, not the file.** `tsc` clean + 489 green said nothing about whether the chip
rendered on the right row. It took a temporary month override and a real DOM read to learn that
"Dog food" lives on the Variable tab. Revert such overrides immediately — Tre runs parallel
sessions on this tree.

Prior sessions' lessons (1-99) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
