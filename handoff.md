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
   expected-fail. Next concrete step: read the Asks Ledger
   (`claudecontext/asks.md`) for anything Tre has added, then pick from 2-4.
2. [ ] The forecast engine sits in the FIRST-PAINT path: 23 chunks / 1081 kB raw
   before anything renders, ~206 kB of it `CardProjectionContext` +
   `useSupabaseData` + `essential-monthly-expenses` — paid by signed-out
   visitors on the marketing page and `/auth`, who can never use it. Next
   concrete step: make `CardProjectionProvider` lazy behind the authed routes
   only, then re-measure by BFS from the built entry chunk.
3. [ ] Density beyond the Accounts panel. Dashboard overview, Transactions, Debt
   Payoff and Forecast were MEASURED after the systemic scale change and are
   already reasonable (first card 122-234px, 4-8 cards above the fold). Next
   concrete step: do NOT churn those — revisit only if Tre names a screen.
   Garage and Settings were never measured.
4. [ ] `monthEndCash.invariant` cannot exercise its own post-cutoff scenario on
   a capture taken on the last evening of a month, because the cutoff IS the
   last day of month 0. It still asserts month-0 equality and warns loudly. Next
   concrete step: recapture mid-month (`RECAPTURE=1`, runbook at
   `docs/forecast-fixture-recapture.md`) and the case returns.
5. [~] Plaid on iOS TestFlight — CLAIMED BY ANOTHER SESSION (`getforgenta-5e`),
   do not duplicate. They established: both edge functions ARE deployed with the
   hosted branch (create-link-token v45, hosted-link-result v2; the "undeployed"
   note was stale), TestFlight is current, render gates pass, DeepLinkHandler
   ignores plaid-complete. `oauth_states` has zero rows ever and `rate_limits`
   shows 3 taps in 16s on 08-29 with no exchange after, so no native tap has got
   past `/link/token/create`. Blocked on Tre: `query_logs` on the Supabase
   allowlist, to read the function's response text.
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

_Written 2026-09-01 02:03 by handoff_hook. Everything below this heading is
machine-generated and replaced each time; put durable notes above it._

- **Branch:** `main`
- **vs upstream:** 0 ahead, 0 behind

- **Working tree:** clean

- **Recent commits:**

```
268e1e66 docs(handoff): clear-ready â€” nothing mid-flight, queue reordered around what is left
6343df2f docs(handoff): the wobble is closed, and Plaid is another session's
aadf3ae2 test(convergence): the payoff wobble is not a defect, and here is the invariant that is
f6740275 docs(handoff): a Resume queue, ordered, so the next session picks up mid-thread
ab5c60aa style(accounts): the row actions move beside the meta line, not under it
0bc51eef docs(handoff): a snapshot again, not a 1 MB log
4dcd60fe style(density): 61px back above the fold, and the control rows finally agree
48025907 fix(dev): point every importer at the renamed consent modules
```

<!-- AUTO-SNAPSHOT:END -->
