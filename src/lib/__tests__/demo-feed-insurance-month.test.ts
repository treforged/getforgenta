/**
 * The demo bank feed carries the semiannual car-insurance premium only in the month its rule
 * falls in (r4 March 12, r4b September 12). Until 2026-10-09 the row was pinned to the CURRENT
 * month, so /demo's Plan "Spent so far" showed a $1,014 premium in every month the plan never had.
 *
 * `demo-data.ts` reads the clock at import, so each case pins the date and re-imports the module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function feedOn(isoDate: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${isoDate}T12:00:00`));
  vi.resetModules();
  const { demoSyncedTransactions } = await import('@/lib/demo-data');
  return demoSyncedTransactions.filter(r => r.merchant_name === 'Halstead Mutual').map(r => r.date);
}

afterEach(() => { vi.useRealTimers(); });

describe('demo feed insurance premium', () => {
  it('lands on September 12 when viewed in October, not in October', async () => {
    expect(await feedOn('2026-10-20')).toEqual(['2026-09-12']);
  });

  it('is absent when no March or September falls in the four-month window', async () => {
    expect(await feedOn('2026-08-20')).toEqual([]);
  });

  it('is on September 12 itself once that day has come', async () => {
    expect(await feedOn('2026-09-12')).toEqual(['2026-09-12']);
  });

  it('is not reported before September 12 in September (settled rows are never in the future)', async () => {
    expect(await feedOn('2026-09-05')).toEqual([]);
  });

  it('carries March when the window spans it', async () => {
    expect(await feedOn('2027-05-01')).toEqual(['2027-03-12']);
  });
});
