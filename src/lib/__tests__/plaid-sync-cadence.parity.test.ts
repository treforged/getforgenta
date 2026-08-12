// PLAID SYNC CADENCE — the cron, the staleness maths and the sentence the user reads
// are ONE RULE WRITTEN THREE TIMES.
//
// The failure this guards is not hypothetical, it already happened twice:
//
//   1. 2026-05-13 dropped the schedule to Mon/Wed/Fri while leaving the job NAMED
//      "plaid-daily-sync" and the edge function's docstring saying "daily". The drift
//      survived three months because every written claim still said daily.
//   2. 2026-08-11 restored daily and fixed `PLAID_SYNC_HOUR_UTC` + the staleness
//      window, but left the caption on the Accounts page telling customers
//      "Syncs Mon, Wed, Fri & Sat at 9 AM ET" — the schedule the app had just left.
//
// Both are quiet, both are customer-facing, and no compiler spans SQL and JSX. So this
// reads the shipped migration and the shipped page rather than a copy of either.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const ACCOUNTS_PAGE = join(process.cwd(), 'src/pages/Accounts.tsx');

/** The newest migration that reschedules `plaid-daily-sync` — i.e. the one in force. */
function latestPlaidCronMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes("cron.schedule(\n  'plaid-daily-sync'"))
    .sort();
  expect(files.length, 'at least one migration must schedule plaid-daily-sync').toBeGreaterThan(0);
  return join(MIGRATIONS_DIR, files[files.length - 1]);
}

/** The 5 fields of the cron expression passed to `cron.schedule('plaid-daily-sync', …)`. */
function scheduledCronFields(): string[] {
  const sql = readFileSync(latestPlaidCronMigration(), 'utf8');
  const match = sql.match(/cron\.schedule\(\s*'plaid-daily-sync'\s*,\s*'([^']+)'/);
  expect(match, "the schedule string for 'plaid-daily-sync' must be findable").not.toBeNull();
  return match![1].trim().split(/\s+/);
}

describe('plaid sync cadence parity', () => {
  it('ships the migration the app was written against', () => {
    expect(existsSync(latestPlaidCronMigration())).toBe(true);
    expect(existsSync(ACCOUNTS_PAGE)).toBe(true);
  });

  it('the cron in force runs EVERY day', () => {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = scheduledCronFields();

    // The 2026-05-13 drift lived entirely in this one field.
    expect(dayOfWeek, 'day-of-week must be * — a weekday list is the drift this test exists for').toBe('*');
    expect(dayOfMonth).toBe('*');
    expect(month).toBe('*');
    expect(minute).toBe('0');
    expect(Number(hour)).toBeGreaterThanOrEqual(0);
    expect(Number(hour)).toBeLessThan(24);
  });

  it("the page's staleness clock is set to the hour the cron actually fires", () => {
    const [, hour] = scheduledCronFields();
    const src = readFileSync(ACCOUNTS_PAGE, 'utf8');
    const match = src.match(/const\s+PLAID_SYNC_HOUR_UTC\s*=\s*(\d+)/);
    expect(match, 'Accounts.tsx must declare PLAID_SYNC_HOUR_UTC').not.toBeNull();

    // If these disagree the badge under-reports staleness rather than erroring —
    // it simply believes the last sync happened at a time it did not.
    expect(Number(match![1])).toBe(Number(hour));
  });

  it('tells the user daily, and names no weekdays', () => {
    const src = readFileSync(ACCOUNTS_PAGE, 'utf8');

    // Only the sync caption is at stake; ordinary date formatting elsewhere on the page
    // legitimately produces weekday names at runtime, so this looks at the literal copy.
    const captions = [...src.matchAll(/Syncs[^`'"]*/g)].map((m) => m[0]);
    expect(captions.length, 'the linked-banks freshness caption must be findable').toBeGreaterThan(0);

    for (const caption of captions) {
      expect(caption, `caption still names weekdays: ${caption}`).not.toMatch(
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/,
      );
      expect(caption).toMatch(/daily/i);
    }
  });
});
