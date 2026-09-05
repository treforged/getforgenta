// Three sites parsed a UTC instant or a DATE column as if it were already the LOCAL calendar
// date. At negative UTC offsets (America/New_York) that reads a day, or a month, early.
//
// Would-fail checks: revert `net-worth-trend.ts` to `new Date(s.snapshot_date)` (no local-noon
// anchor) and the label test below fails in TZ=America/New_York, reading "Sep 4" for a snapshot
// recorded on the 5th. Revert `net-worth-snapshot.ts` similarly and the recorder fires a few
// hours before the real local 7-day mark has elapsed. Run under `npm run test:tz` — the point is
// exactly that these must hold in all three zones, not just the one the suite happens to run in.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNetWorthTrend } from '../net-worth-trend';
import { shouldRecordSnapshot, SNAPSHOT_INTERVAL_DAYS } from '../net-worth-snapshot';
import { toLocalDateStr } from '../scheduling';

afterEach(() => {
  vi.useRealTimers();
});

describe('buildNetWorthTrend — snapshot_date label (src/lib/net-worth-trend.ts:51)', () => {
  it('labels a DATE-column snapshot with its own calendar day, never the day before', () => {
    // '2026-09-05' is a plain DATE column value. `new Date('2026-09-05')` parses as UTC
    // midnight; at America/New_York (UTC-4/-5) that instant falls on the PREVIOUS local day,
    // so `toLocaleString` renders "Sep 4" instead of "Sep 5" — a defect independent of which
    // zone the assertion below runs in, since Sep 5 is the only correct label anywhere.
    const trend = buildNetWorthTrend(
      [{ snapshot_date: '2026-09-05', net_worth: 100 }],
      100,
    );
    expect(trend[0].month).toBe('Sep 5');
  });
});

describe('shouldRecordSnapshot — DATE column vs a live "now" instant (src/lib/net-worth-snapshot.ts:46)', () => {
  it('measures the real number of elapsed LOCAL calendar days, not a UTC-midnight-shifted count', () => {
    // Fixed UTC instant, chosen so the three zones test:tz runs under land on different local
    // calendar days for "now": 2026-09-02 in UTC and Asia/Tokyo, but still 2026-09-01 in
    // America/New_York (UTC-4 in September).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T02:00:00.000Z'));
    const now = new Date();

    // Independent oracle: true elapsed LOCAL calendar days between the snapshot's date and
    // "now"'s local date, counted as whole days via a UTC-anchored day arithmetic on the (y, m,
    // d) triples alone — no time-of-day, no snapshot-date parsing, so it cannot share the bug
    // being tested for.
    const [sy, sm, sd] = '2026-08-26'.split('-').map(Number);
    const localCalendarDaysElapsed = Math.round(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(sy, sm - 1, sd))
        / 86_400_000,
    );

    const due = shouldRecordSnapshot([{ snapshot_date: '2026-08-26' }], now);

    expect(due).toBe(localCalendarDaysElapsed >= SNAPSHOT_INTERVAL_DAYS);
  });
});

describe('Transactions.tsx current-month filter (src/pages/Transactions.tsx:99, compared at :315)', () => {
  it('pins the source to the local helper, not a UTC-based toISOString slice', () => {
    // A full render of Transactions.tsx needs its whole hook/context tree (card projection,
    // subscription, demo, bank review queue, ...), so this pins the actual source line as a
    // cheap sanity check — the same technique net-worth-snapshot-writer.test.ts uses to pin a
    // call site. The real proof is the row-count test below, which reproduces the failure a
    // user would actually see.
    const source = readFileSync(
      join(process.cwd(), 'src', 'pages', 'Transactions.tsx'),
      'utf8',
    );
    const line = source.split('\n').find(l => l.includes('currentMonthStr ='));
    expect(line).toContain('toLocalDateStr(new Date()).slice(0, 7)');
    expect(line).not.toContain('toISOString');
  });

  it('does not hide today\'s transaction behind a phantom next month at 9pm on the last day, at a negative UTC offset', () => {
    // `currentMonthStr` seeds `filterMonth`, which is compared against `t.date.slice(0, 7)` at
    // Transactions.tsx:315. `toISOString()` is timezone-independent (always UTC), so the old
    // buggy key is the SAME '2026-10' no matter which zone this suite runs under — it is
    // `toLocalDateStr`'s reading that must track the zone. 2026-10-01T01:00:00Z is 2026-09-30
    // 21:00 in America/New_York (EDT, UTC-4): a real user still on the 30th, whose default
    // "this month" view would silently render ZERO ROWS under the old code.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T01:00:00.000Z'));
    const now = new Date();

    const transactions = [{ date: '2026-09-30' }];
    const keepInMonth = (monthKey: string) =>
      transactions.filter(t => t.date.slice(0, 7) === monthKey).length;

    // Independent oracle for "what month is it really, locally, right now" — built from Date's
    // own local getters directly rather than by calling toLocalDateStr, so it cannot share
    // toLocalDateStr's bug (it has none, but this keeps the check honest).
    const localMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const expectedRows = keepInMonth(localMonthKey);

    const buggyMonthKey = now.toISOString().slice(0, 7);
    const fixedMonthKey = toLocalDateStr(now).slice(0, 7);

    // Holds in all three zones test:tz runs under.
    expect(keepInMonth(fixedMonthKey)).toBe(expectedRows);

    // The concrete regression only manifests at a negative offset: toISOString() always reads
    // '2026-10' for this instant regardless of the runtime zone, so only in America/New_York
    // does that diverge from the true local month and turn 1 real row into 0 rendered ones.
    if (process.env.TZ === 'America/New_York') {
      expect(buggyMonthKey).toBe('2026-10');
      expect(fixedMonthKey).toBe('2026-09');
      expect(keepInMonth(buggyMonthKey)).toBe(0);
      expect(keepInMonth(fixedMonthKey)).toBe(1);
    }
  });
});
