# Handoff — Forgenta

> **This file is a SNAPSHOT, not a log.** It was 1,075,335 bytes on 2026-09-01,
> read into context at every SessionStart in this folder, and it had swallowed
> every previous session end-to-end. The history is in `handoff-archive.md`;
> search that when you need something this file no longer carries. Keep this one
> under ~15 KB: rewrite the state, do not append to it.

---

## Resume queue

1. [ ] Density pass, surfaces beyond Accounts. Dashboard overview, Transactions,
   Debt Payoff, Forecast and Garage were MEASURED and are already reasonable
   (first card 122-234px, 4-8 cards above the fold), so the systemic scale
   change covered them. Next concrete step: only revisit if Tre names a
   specific screen — do not churn surfaces that measure fine.
2. [ ] The within-month payoff wobble. Next concrete step: open the debt-cash
   walk and find why month 0's shrinking debt payment pushes CC Debt Free from
   Jun 2028 to Jul 2028 as due days pass. The `it.fails` tripwire in
   `src/lib/__tests__/forecast-convergence.manualISB.test.ts` goes RED when it
   is fixed; delete the block then.
3. [ ] Plaid on iOS TestFlight — Tre: "i couldnt access it." Next concrete
   step: read `supabase/functions/plaid-hosted-link-result` and the native link
   path in `src/pages/Accounts.tsx`, then check the hosted-link flow actually
   opens on the native build. Web and data are healthy; this is native-only.
4. [ ] The forecast engine sits in the first-paint path: 23 chunks / 1081 kB
   raw, ~206 kB of it `CardProjectionContext` + `useSupabaseData` +
   `essential-monthly-expenses`, paid by signed-out visitors. Next concrete
   step: make `CardProjectionProvider` lazy behind the authed routes only.
5. [x] The 15 red tests — fixed, `f031e96b`, golden tests now pin invariants.
6. [x] Google OAuth popup hang — fixed, `7108311a`, INITIAL_SESSION was the
   missing event.
7. [x] Blank localhost — an ad blocker matching `cookie-consent` in module
   request paths. Renamed, `2315285c` + follow-up.
8. [x] Robinhood duplicate — a manual $2,000 row, set inactive in the database.
9. [x] Convergence budget 24 -> 32, `c5107228`.
10. [x] handoff.md trimmed from 1,075,335 bytes, `0bc51eef`, pushed.

## Where things stand — 2026-09-01

`main` is green and everything below is pushed and verified against `origin` by
contents.

**3159 tests pass, 1 expected fail, 1 skipped. tsc 0. Build clean.**

### Shipped today

| commit | what |
| --- | --- |
| `a3233a45` | `initMonitoring()` moved off the pre-render path onto `requestIdleCallback`. It was eagerly fetching 786 kB raw / ~225 kB gzip of LaunchDarkly observability before the React root existed. |
| `f031e96b` | The 15 red tests. Four were the calendar, eleven were the fixture recapture. Golden tests now pin engine self-consistency and derive the rest. |
| `5bc7aba3` | Four desktop UI reports: whole-page scroll, modals closing on drag-select, no box on modal closers, logo vanishing on sidebar collapse. |
| `c5107228` | Convergence budget 24 → 32, and the clock tripwire re-measured. |
| `7108311a` | The Google OAuth popup closes itself again. |
| `2315285c` + follow-up | An ad blocker was blanking the whole app in dev. |
| `(density)` | 61px back above the fold on the Accounts panel; control rows aligned. |

### The three things most likely to bite the next session

1. **Do not put `cookie` in a module path.** Content blockers match
   `cookie-consent` / `CookieBanner` in a REQUEST path, every Vite dev module is
   its own request, and `hmr: { overlay: false }` makes the resulting failure
   completely silent — a blank page and an empty console. Cost an hour on
   2026-09-01. The three files are now `consent-prefs.ts`, `ConsentBanner.tsx`,
   `useConsentPrefs.ts`, and there is a note at the top of the first.
   Production inlines them into hashed bundles and was never affected.
2. **A golden test may pin the engine's self-consistency, never a fact about one
   capture.** The 2026-09-01 recapture moved eleven assertions that described
   the July snapshot: `'Jul 2027'`, `passes === 1`, `$400` of savings, zero
   breaches, a $5,000 shock that absorbs. A test that needs a scenario must
   CONSTRUCT it rather than hope the capture contains one.
3. **Measure before re-pinning.** A stale pin and a real regression read
   identically from the failure message. The $5,000 shock looked like a
   regression until a sweep showed $500–$3,000 all absorb and only $5,000 does
   not — the reserve chain is intact, the capture is simply tighter.

### Open, in the order I would take them

- **The within-month payoff wobble.** Inside one month, as due days pass and
  month 0's debt payment falls from $2,662 to $661, CC Debt Free moves from Jun
  2028 to Jul 2028. More of the month already paid must never make the payoff
  worse. Tripwired as `it.fails` in `forecast-convergence.manualISB.test.ts`; it
  goes RED when fixed, which is the signal to delete the block. Needs the
  debt-cash walk opened properly, with a clean context.
- **Plaid on iOS TestFlight** — Tre, 2026-09-01: "i couldnt access it." The link
  flow is unreachable on the native build. See the `project_plaid_hosted_link`
  memory: shipped native-only in `bc16b4fc` and never verified. The web and data
  side is healthy — 8 connections synced, the one duplicate item correctly
  `revoked`.
- **The forecast engine in the first-paint path.** Measured critical path is 23
  chunks and 1081 kB raw, of which ~206 kB is `CardProjectionContext` +
  `useSupabaseData` + `essential-monthly-expenses`. A signed-out visitor on the
  marketing page or `/auth` pays for all of it.
- **`monthEndCash.invariant` cannot exercise its own scenario** on a capture
  taken on the last evening of a month, because the cutoff IS the last day of
  month 0. It asserts month-0 equality anyway and warns loudly. Recapture
  mid-month to restore the case.

### Data changes made outside git

- **The manual `Robinhood` account is now inactive** (`de100006-…-006`, $2,000,
  created 2026-04-25, no Plaid link, 0 transactions, 0 linked goals). It was the
  duplicate Tre kept reporting — not a Plaid duplicate at all. Net worth drops
  ~$2,000 and one flag reverses it.
- `conductor_crew` table added to the CONDUCTOR project
  (`zyvqoefbgsgkbdoydopt`), not this one.

### Session mechanics that still apply

- `node scripts/dev-session.mjs up`, then `http://localhost:8080`. Never a bare
  `npm run dev`; Supabase session state is per-origin and another port serves a
  signed-out app.
- `npm test`, never `vitest --reporter=basic` — that reporter exits 0 having run
  zero tests in this vitest.
- Tre runs concurrent sessions on this tree. Re-read before writing, and never
  `git add -A`.
