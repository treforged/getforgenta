# Handoff — Forgenta

> **This file is a SNAPSHOT, not a log.** It was 1,075,335 bytes on 2026-09-01,
> read into context at every SessionStart in this folder, and it had swallowed
> every previous session end to end. The history is in `handoff-archive.md`;
> search that when you need something this file no longer carries. Keep this one
> under ~15 KB: rewrite the state, do not append to it. Everything below the
> AUTO-SNAPSHOT marker is machine-written and is replaced on every run — write
> above it.

---

## Resume queue

1. [ ] Nothing is mid-flight. Clean tree, `origin/main` 0/0, suite green with no
   expected-fail. The Asks Ledger was read 2026-09-01 02:07 and carries nothing
   new for this desk. Next concrete step: pick from 3-4.
2. [x] The forecast engine is OFF the first-paint path — `0a74fc5d`. The one
   static edge holding it there was `DashboardLayout`, imported eagerly in
   `App.tsx` while every page inside it was already lazy; it mounts
   `CardProjectionProvider`. Lazy behind its own Suspense boundary now. MEASURED
   by BFS of the entry chunk's static-import closure: **23 chunks / 1081.9 kB ->
   13 chunks / 811.2 kB raw, -270.7 kB (-25%)**. `CardProjectionContext` (98.3),
   `useSupabaseData` (58.2), `essential-monthly-expenses` (49.5),
   `vehicle-loan-engine`, `payment-plan-generator`, `ordinal`, `card-start-date`
   all left the closure. PROVEN in a browser, not inferred: on the PRODUCTION
   build served at :4179 a signed-out `/auth` fetches 18 JS chunks and ZERO
   engine chunks, and still renders; signed in at :8080 `/dashboard` renders
   through the new boundary (Command Center, sidebar, `scroll-main`) and `/debt`
   still runs the engine (PAYOFF ETA Jul 2028 / 22 mo), no console errors.

3. [x] Density is DONE, and the last two screens needed no change. Dashboard
   overview, Transactions, Debt Payoff and Forecast were measured previously.
   Garage and Settings were the unmeasured half and were measured 2026-09-01
   against a laptop fold (768px window minus chrome = 678px of content):
   **Garage's entire page is 865px** — it all but fits, 187px of scroll — and
   **Settings puts its first real panel at y=168**, with only a 36px title and a
   42px tab bar above it. Neither is a density problem, so neither was touched.
   Next concrete step: none. Revisit only if Tre names a screen.
4. [ ] `monthEndCash.invariant` still cannot exercise its post-cutoff scenario:
   the live capture was taken on the last evening of August, so the cutoff IS
   the last day of month 0. It still asserts month-0 equality and warns loudly.
   DELIBERATELY NOT DONE on 2026-09-01 — a recapture at 02:20 on the 1st sets
   the cutoff to day 1, which swaps one unrepresentative extreme (month 0 all
   actual) for the other (month 0 almost all projected), and it re-invalidates
   the ~10 real-data pins that `f031e96b` had just re-pinned hours earlier. The
   fixture is gitignored and CI never sees it, so nothing is failing in the
   meantime. Next concrete step: recapture on a genuinely mid-month day (the
   10th-20th), `RECAPTURE=1`, runbook `docs/forecast-fixture-recapture.md`, and
   budget the same session for re-pinning the ~10 assertions with judgement.
5. [~] Plaid on iOS TestFlight. The `query_logs` blocker is CLEARED — Tre
   approved it 2026-09-01 02:30 and `mcp__claude_ai_Supabase__query_logs` is now
   in `.claude/settings.local.json`; verified by running it, not by reading the
   file. **But the evidence it was wanted for has expired.** `function_edge_logs`
   on `mdtosrbfkextcaezuclh` retains exactly 24 hours (measured: oldest row
   2026-08-31T06:20Z, newest 2026-09-01T06:15Z, 87 rows), and the failing taps
   were 2026-08-29T17:41Z — three days gone and unrecoverable. Everything else
   the previous session established still stands: both edge functions ARE
   deployed with the hosted branch (create-link-token v45, hosted-link-result
   v2), TestFlight is current, render gates pass, DeepLinkHandler ignores
   plaid-complete, `oauth_states` has zero rows ever, and `rate_limits` shows 3
   taps in 16s on 08-29 with no exchange after — so no native tap has got past
   `/link/token/create`. Next concrete step, and it is the ONLY one left: Tre
   taps Connect Bank once on the phone, then read the function logs WITHIN 24
   HOURS with `query_logs`. The owning session (`getforgenta-5e`) is no longer
   in the peer roster, so this desk owns it again.
6. [x] 15 red tests — `f031e96b`. Golden tests pin engine self-consistency now.
7. [x] The payoff wobble — `aadf3ae2`. Not a defect; see below.
8. [x] Google OAuth popup hang — `7108311a`. `INITIAL_SESSION` was the missing event.
9. [x] Blank localhost — `2315285c` + `48025907`. An ad blocker matching `cookie-consent`.
10. [x] Convergence budget 24 to 32 — `c5107228`, measured.
11. [x] Robinhood duplicate — a manual $2,000 row, set inactive in the database.
12. [x] Density, Accounts panel — `4dcd60fe` + `ab5c60aa`.
13. [x] handoff.md trimmed from 1,075,335 bytes — `0bc51eef`.

## Where things stand — 2026-09-01

**3160 tests pass, 1 skipped, no expected-fail. tsc 0. Build clean.** Clean
tree, `origin/main` 0/0, everything verified on origin by contents.

| commit | what |
| --- | --- |
| `a3233a45` | `initMonitoring()` off the pre-render path onto `requestIdleCallback`; it was eagerly fetching ~225 kB gzip of observability before the React root existed. |
| `f031e96b` | The 15 red tests: 4 the calendar, 11 the fixture recapture. |
| `5bc7aba3` | Whole-page scroll, modals closing on drag-select, unboxed modal closers, logo vanishing on sidebar collapse. |
| `c5107228` | Convergence budget 24 to 32. |
| `7108311a` | The Google OAuth popup closes itself again. |
| `2315285c` `48025907` | An ad blocker was blanking the whole app in dev. |
| `4dcd60fe` `ab5c60aa` | Density: 61px back above the fold, rows 135px to 97px. |
| `aadf3ae2` | The payoff wobble closed as not-a-defect, with the invariant that matters. |

### The four things most likely to bite the next session

1. **Do not put `cookie` in a module path.** Content blockers match
   `cookie-consent` / `CookieBanner` in a REQUEST path, every Vite dev module is
   its own request, and `hmr: { overlay: false }` makes the failure completely
   silent: blank page, empty console. Cost an hour. The files are now
   `consent-prefs.ts`, `ConsentBanner.tsx`, `useConsentPrefs.ts`. Production
   inlines them into hashed bundles and was never affected.
2. **A golden test may pin the engine's self-consistency, never a fact about one
   capture.** The recapture moved eleven assertions that described the July
   snapshot. A test needing a scenario must CONSTRUCT it, not hope for it.
3. **Measure the CAUSE, not the symptom.** The payoff wobble was reported wrong
   twice by inferring from a number that moved; one per-card run settled it. A
   stale pin and a real regression read identically from a failure message.
4. **Month 0 is a partial month.** Its debt payment legitimately shrinks as the
   month passes, because less income remains before the due date, and balances
   and cash both rise by exactly what was not paid. A payoff date that moves
   with the day of the month is arithmetic, not instability.

### Data changes made outside git

- **The manual `Robinhood` account is inactive** (`de100006-…-006`, $2,000,
  created 2026-04-25, no Plaid link, 0 transactions, 0 linked goals). It was the
  duplicate Tre kept reporting, and it was never a Plaid artifact. Net worth is
  ~$2,000 lower; one flag reverses it.
- `conductor_crew` lives in the CONDUCTOR project (`zyvqoefbgsgkbdoydopt`), not
  this one.

### Session mechanics

- `node scripts/dev-session.mjs up`, then `http://localhost:8080`. Never a bare
  `npm run dev` — Supabase session state is per-origin, so another port serves a
  signed-out app.
- `npm test`, never `vitest --reporter=basic`: that reporter exits 0 having run
  zero tests in this vitest.
- Tre runs concurrent sessions on this tree. Re-read before writing, never
  `git add -A`, stage explicit paths.

<!-- AUTO-SNAPSHOT:BEGIN - machine-written, replaced each compaction -->
## Auto-snapshot

_Written 2026-09-01 02:05 by handoff_hook. Everything below this heading is
machine-generated and replaced each time; put durable notes above it._

- **Branch:** `main`
- **vs upstream:** 0 ahead, 0 behind

- **Working tree:** clean

- **Recent commits:**

```
7ced75fc docs(handoff): refresh the machine snapshot so it stops contradicting the tree
268e1e66 docs(handoff): clear-ready — nothing mid-flight, queue reordered around what is left
6343df2f docs(handoff): the wobble is closed, and Plaid is another session's
aadf3ae2 test(convergence): the payoff wobble is not a defect, and here is the invariant that is
f6740275 docs(handoff): a Resume queue, ordered, so the next session picks up mid-thread
ab5c60aa style(accounts): the row actions move beside the meta line, not under it
0bc51eef docs(handoff): a snapshot again, not a 1 MB log
4dcd60fe style(density): 61px back above the fold, and the control rows finally agree
```

<!-- AUTO-SNAPSHOT:END -->
