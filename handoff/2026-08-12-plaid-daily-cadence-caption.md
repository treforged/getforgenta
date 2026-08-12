# Plaid daily sync — verified live, and the last place still claiming the old cadence

2026-08-12, branch `autopilot/getforgenta-0811-173709`.

## The ask

"Set the Plaid balance/transaction refresh back to running every day. Find where the
schedule lives, confirm what cadence it is ACTUALLY on right now rather than what the
code claims, and put it back to daily. Report the before and after, and how you
verified it fired."

## Where the schedule lives

**pg_cron, in the Supabase database** — `cron.job`, job name `plaid-daily-sync`, which
posts to the `plaid-sync-all` edge function. Not n8n, not a Vercel cron, not a
scheduled Supabase function. The repo's `supabase/migrations/*plaid*cron*.sql` files
are the record of it; `cron.job` is the truth.

## Before and after

| | schedule | evidence |
|---|---|---|
| **Before** (until 2026-08-11) | `0 13 * * 1,3,5,6` — Mon/Wed/Fri/Sat | jobid **16**, 42 runs, last `2026-08-10 13:00:00 UTC`. Its run rows are 08-03 (Mon), 08-05 (Wed), 08-07 (Fri), 08-08 (Sat), 08-10 (Mon) — never a Tue/Thu/Sun. |
| **After** (now) | `0 13 * * *` — every day | jobid **22**, `plaid-daily-sync`, `active = true`, live in `cron.job` this session. |

The schedule change itself was made on 2026-08-11 (`812c8379`, migration
`20260811_plaid_restore_daily_cron.sql`). **This session re-confirmed it against the
live database and found the piece that was still wrong.**

Command re-asserted by predicate rather than by eyeballing: jobid 22's `command`
contains `plaid-sync-all`, sends `x-cron-secret`, and reads the secret dynamically
from the vault (not a literal). Byte length 386.

## How the firing was verified

**Honestly: the daily-only run has NOT fired yet, and this is why.**

- `now()` at the time of checking was **2026-08-12 05:17 UTC**. Job 22 next fires at
  **13:00 UTC today** — about eight hours out. `cron.job_run_details` for jobid 22 is
  therefore empty, and that is correct, not a fault.
- 2026-08-12 is a **Wednesday**, which the OLD schedule also covered. So even today's
  run does not distinguish daily from Mon/Wed/Fri/Sat. **The distinguishing run is
  Thursday 2026-08-13 13:00 UTC** (or Sunday 08-16). That row remains owed.

What *was* verified, so the claim is not resting on the schedule string alone:

1. **The scheduler is demonstrably alive right now.** jobid 19 (reddit retry, `*/5`)
   last ran `2026-08-12 05:15:00 UTC`; jobid 21 ran at 04:00. pg_cron is firing jobs
   on this database minutes before this check.
2. **This particular command does real work when it fires.** After the last real run
   (`2026-08-10 13:00 UTC`), `financial_connections.last_synced_at` reads
   13:00:03 → 13:00:28 UTC across **7 of 8** connections. The 8th (USAA,
   `2026-08-09 16:50 UTC`) is not broken — it was hand-synced inside the 23.5h
   cooldown in `_shared/sync-handler.ts`.
3. **2026-08-11 13:00 UTC had no run at all**, and that is expected in both directions:
   08-11 was a Tuesday, which the old schedule skipped, and job 22 was created after
   that hour had passed. No sync was lost by the change.

⚠️ **A manual trigger was deliberately NOT used to force a proof.** `SYNC_COOLDOWN_MS`
is 23.5h, so hand-firing now would skip today's 13:00 run — destroying the very
evidence that is owed and making the cadence look broken. A fabricated proof that
sabotages the real one is worth less than an honest "not yet".

## 🔬 What this session actually fixed — the cadence was still a lie on screen

The 08-11 work fixed the cron and fixed the staleness maths (`PLAID_SYNC_HOUR_UTC`,
the `missedSync` window). It left `src/pages/Accounts.tsx:912-913` telling every
premium customer:

> `Syncs Mon, Wed, Fri & Sat at 9 AM ET`

That is the schedule the app had just stopped using. Two things wrong with it, and the
second predates 08-11:

- **The days.** Flatly false since 08-11.
- **The hour.** "9 AM ET" is only right in EDT. 13:00 UTC is **8 AM EST** every winter,
  so the sentence was already wrong for a third of the year — and wrong for any
  customer outside Eastern time all year round.

Fixed by deriving the sentence from the same constant the staleness maths uses, and
rendering it in the **viewer's own timezone**:

```ts
function formatDailySyncTime(): string {
  const d = new Date();
  d.setUTCHours(PLAID_SYNC_HOUR_UTC, 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', timeZoneName: 'short' });
}
```

Caption now reads `… · Syncs daily at 9 AM EDT` (and `8 AM EST` in winter, and the
right local hour for a customer in Denver, without anyone editing it again).

## The test that would have caught it

`src/lib/__tests__/plaid-sync-cadence.parity.test.ts` — 4 tests, following the
`synced-transaction-review.migrationParity` idiom of **reading the shipped artifact**
rather than a copy of it, because no compiler spans SQL and JSX:

1. the newest migration that schedules `plaid-daily-sync` exists;
2. its cron expression has `*` in the day-of-week field — the field the 05-13 drift
   lived entirely inside;
3. `PLAID_SYNC_HOUR_UTC` in `Accounts.tsx` equals the migration's hour field;
4. **the user-facing caption names no weekday and does say "daily"** — the exact bug
   above.

**Verified it bites:** restoring the old caption fails test 4 with
`caption still names weekdays: Syncs Mon, Wed, Fri & Sat at 9 AM ET`. Restored after.

## Gates

`npx tsc --noEmit` **0** · eslint clean on both changed files · full suite
**926/926 across 118 files** (922 + 4 new) · `npm run build` green in 1.28s.

## ⬜ Owed

- **The Thursday 2026-08-13 13:00 UTC row for jobid 22.** One query settles it:
  `select * from cron.job_run_details where jobid = 22 order by start_time desc;`
  Corroborate with `financial_connections.last_synced_at` stamped ~13:00:0x on 08-13.
- **The caption has not been looked at in a browser.** This session had no
  Claude-in-Chrome tooling, so localhost could not be driven despite Tre offering to
  sign in. It is behind `isPremium && plaidItems.length > 0` on `/accounts`, under
  "Linked Banks". String formatting on an unchanged code path, test-pinned — but not
  rendered and looked at, which is the house standard.
- **This branch cannot be pushed from here** (pre-push hook, by design). Tre asked for
  a push this session; the board's Push button is the path.
