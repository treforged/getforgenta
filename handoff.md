# Handoff — 2026-08-07 — session 104 — keep-signed-in helper SHIPPED; types.ts regen DONE

> Tre's ask (the keep-signed-in helper) is built, tested, and committed. The overdue `types.ts`
> regen is also done and green. Nothing pushed. **97.3 is blocked on ONE manual sign-in by Tre.**

## REMOTE ACCESS — ✅ CLOSED 2026-08-08 (end-to-end verified from the phone)

Secure phone → PC access works. Tailscale VPN + Windows RDP, firewall scoped to `100.64.0.0/10`,
NLA required, no broad RDP rules. Tre confirmed a successful desktop connection from the phone.
Tailscale key expiry disabled and IdP 2FA enabled (Google), both done by Tre.

Everything lives in **`C:\Users\tvonh\Desktop\remote-access\`**, deliberately OUTSIDE this repo —
**this repo is PUBLIC.** Do not move machine-access detail into it. Scripts: `setup-remote-access.ps1`
(idempotent, `-Revert`), `check-remote-access.ps1` (read-only), `fix-rdp-listener.ps1`,
`diag-rdp-auth.ps1`. Both 2026-08-08 failure modes are written up in that folder's `README.md`.

Two blockers were cleared; the shape of each is worth carrying forward:

1. **No listener on 3389** despite every config item green. RDP had been enabled by registry edit
   *after* the last boot, so TermService came up in "RDP denied" mode and never re-read it.
   `Restart-Service TermService -Force` failed twice, and the WMI `SetAllowTSConnections` 0→1
   toggle returned success while still producing no listener. **A reboot was the fix.**
2. **"Credentials did not work."** The Security log gave the answer in one read: SubStatus
   `0xC000006A` = bad password, not `0xC0000064` = unknown user — so the username format was never
   the problem. The account is a **Microsoft account**; Windows caches its password hash and only
   refreshes on an actual typed password, so a Hello-PIN user's cache was 20 months stale. One
   lock-screen password sign-in re-synced it.

**Lessons:** `fDenyTSConnections=0` is a *claim*; a bound socket is *evidence* — the checker
originally reported all-green while nothing was listening, and it now tests the socket. And when a
credential is rejected, read the SubStatus before theorising: it separates "wrong username format"
from "wrong password", which have nothing to do with each other. Do not disable NLA or widen
firewall rules to make a symptom go away.

## ▶ START HERE — 97.3 (carried, unchanged)

**Still blocked on Tre — but the cause is now diagnosed, so do not just re-ask blindly.**

Tre reported signing in at ~16:45. The probe still returns `SIGNED OUT: no supabase auth key`.
Ruled out at 20:15 by direct check, not assumption:

- `list_connected_browsers` returns **exactly one** browser (`71343ae8…`, "Browser 1"). So the
  profile Claude drives is not the one he used — he signed into **his own Chrome**.
- `127.0.0.1:8080` is *also* signed out (`allKeys` had no `sb-*` entry), so it is not a
  sibling-origin mixup either.

The automated tab is parked on `http://localhost:8080/auth` and was screenshotted for him, so he
can match the window on screen. **He must sign in inside that window.** Nothing else is blocking;
97.3 verification is otherwise ready to run end to end.

Once the probe reports SIGNED IN, go straight to carried item 1.

## Shipped this session

### 1. Keep-signed-in helper — `644cc4b6`

The real root cause was **not** an expiring token. Supabase stores the session in `localStorage`,
which is scoped **per origin**, so a dev server falling back to 8081 serves a *signed-out* app even
when the profile is signed in on 8080. That is what sank session 103's live before/after plan.

- `vite.config.ts` — `strictPort: true`. Vite now fails loudly instead of drifting to a different,
  signed-out origin. **Live-verified:** spawning a second vite errored `Port 8080 is already in
  use` rather than silently taking 8081.
- `scripts/dev-session.mjs` — `check` / `up` against the canonical origin only. Credential-free.
- `.claude/skills/dev-signin/SKILL.md` — the procedure later sessions auto-engage after the first
  manual sign-in: probe `localStorage`, park the tab, never script credentials.
  (`.claude/skills/` is gitignored — it needed `git add -f`.)

**Trap found by testing, worth remembering:** `spawn('npm.cmd', …)` fails with **EINVAL** on modern
Node/Windows (the CVE-2024-27980 mitigation) unless `shell: true`. The script launches
`node node_modules/vite/bin/vite.js` directly instead. Had I not tested the spawn path in
isolation, `up` would have been shipped broken — `check` passing proves nothing about `up`.

### 2. `types.ts` full regen — `9c64c8b4` (carried item 9, now CLOSED)

Regenerated from the live schema via Supabase MCP. The substantive correction: after the §1 rename,
**`plaid_items` is a compatibility VIEW over `financial_connections`, not a table.** The
hand-written file still typed it as a table, which would have let a write against a non-updatable
view type-check. It now sits under `Views` with nullable columns and no `Insert`/`Update`.

Verified by **diffing tsc error sets, not just reading the final one**: `tsc --noEmit` was 0 errors
before AND after, so no code still writes to it, and none of the 574 inserted lines broke anything.
528/528 tests pass. Baseline-then-compare is the way to type-check here — a parallel session can
leave the tree red, and then a red `tsc` after your change tells you nothing.

## Still open (carried)

1. **97.3 not live-verified** — `/goals` → edit a goal with a linked rule → checkbox → save → rule
   shows end date in `/budget` + card shows "Auto-ends contributions". **Needs the sign-in above.**
2. 97.3 re-stamping happens on GOAL save only; decide with Tre whether to widen.
3. Deferred debt-engine sites — `credit-card-engine.ts:2087-2100`,
   `debt-transaction-generator.ts:12-34`. **Recommendation: skip.**
4. §2.9 car-fund earmark.
5. `backup.plaid_items_20260807` / `backup.accounts_20260807` — safe to drop; §1 is settled.
6. Native Plaid Hosted Link device verification (needs a physical device).
7. Stage A's pending→posted retirement path still **not exercised against real data**.

## Closed previously (do not reopen)

§1A Stage C (all parts, live-verified number-neutral, session 103), 97.1 `/debt` TOTAL LIMIT tile
($25,400), and now carried item 9 (`types.ts`).

**Re-check each session:** only Discover has a `sync_cursor` (143 rows). The car-loan funding
account `933cbc10…` is Chase TOTAL CHECKING with 0 synced transactions. The moment a
checking-account cursor appears, §1A Stage C stops being a no-op and the gates go live for real.

## Live drift worth knowing (not a bug, do not chase)

Live shows **CC Debt Free Sep 2028**; the fixture golden pins **Jul 2027**. The fixture is from
2026-07-20 and live balances have moved (Discover $9,726, Prime $7,527). The golden asserts against
the fixture, not live. Do not "fix" the golden to match live.

## Push status

`main` is **27 commits ahead** of `origin/main` before this handoff commit. Standing rule is never
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
2. The Claude-controlled Chrome is a **separate profile**; check, don't assume. It is currently
   **signed out** — use the `dev-signin` skill.
3. Dev server `localhost:8080`, now `strictPort`. `/budget`, `/debt`, `/forecast`, `/dashboard`.
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

## Worktree recipe (reusable — how to prove "nothing changed" against real data)

```
git worktree add --detach <scratch>/wt-before <commit>^
# junction node_modules (Windows): cmd /c mklink /J <wt>\node_modules <repo>\node_modules
# copy the gitignored fixture in, drop a temp vitest file that JSON-dumps the whole result
# ALWAYS remove the junction with `cmd /c rmdir <link>` BEFORE `git worktree remove`,
# or the recursive delete can follow the junction into the REAL node_modules.
```

## Lessons (session 104)

**Test the path you did not take.** `check` passed on the first try and looked like proof the script
worked; the `up` path would have crashed with EINVAL. A helper's happy path is the one that only
runs when something is already broken, which is the worst time to discover it is broken too. Exercise
the risky call in isolation when you cannot trigger it for real.

**Baseline before you change, so the verdict is attributable.** A shared tree with a parallel session
means a red `tsc` may not be yours. Capturing the error set before and comparing after turns an
ambiguous signal into a clean one, and it is nearly free.

**"Signed out" is usually the wrong origin, not an expired token.** Check the origin first.

Prior sessions' lessons (1-103) are in git history under `docs: handoff` commits —
`git log --all --oneline | grep handoff`.
