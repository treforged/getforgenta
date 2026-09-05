// ONE DELIVERY PER PERSON PER PLATFORM, pinned.
//
// ⚠️ THE BUG THIS PREVENTS WAS MEASURED, NOT IMAGINED, AND IT RETIRED AN ASSUMPTION MADE THE
// SAME DAY. On 2026-09-05 `device_tokens` held SEVEN live android rows for one account — one
// device reinstalled while the build was tested, minting a fresh FCM id each time. Commit
// `af0e1552` predicted the first real send would retire the six stale ones by itself, because
// that is what the UNREGISTERED handling in `push-transport.ts` is for. A `validate_only` check
// against FCM accepted ALL SEVEN as valid: **the provider retires nothing for you.** Without the
// dedupe, that person is buzzed seven times for one event the moment dry run is turned off.
//
// It is tested HERE rather than by a live run because a live run cannot reach it: the only
// account holding several tokens produces no notification candidate, so the branch never
// executes however many times the sender is invoked. That is exactly the shape of code that
// ships untested and is discovered by a customer.
//
// The pure selection lives in `_shared/push-transport.ts` and is imported across the boundary
// the same way `account-claim.test.ts` imports its own, which is the house pattern for edge
// logic that has to be exercised without Deno.

import { describe, it, expect } from 'vitest';
import {
  newestTokenPerPlatform,
  type TokenRow,
} from '../../../supabase/functions/_shared/push-transport';

const row = (over: Partial<TokenRow> & { id: string }): TokenRow => ({
  platform: 'android',
  token: `tok-${over.id}`,
  environment: 'production',
  last_seen_at: null,
  created_at: null,
  ...over,
});

describe('newestTokenPerPlatform', () => {
  it('⚠️ collapses the seven live android tokens one account actually had to ONE', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      row({ id: `a${i}`, last_seen_at: `2026-09-05T08:5${i}:00Z` }));

    const kept = newestTokenPerPlatform(seven);

    expect(kept).toHaveLength(1);
    // The newest, not merely the first or the last the database happened to return.
    expect(kept[0].id).toBe('a6');
  });

  it('keeps a phone AND a tablet, because the key is the platform and not the account', () => {
    const kept = newestTokenPerPlatform([
      row({ id: 'android-old', platform: 'android', last_seen_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'android-new', platform: 'android', last_seen_at: '2026-09-05T00:00:00Z' }),
      row({ id: 'ios-only', platform: 'ios', last_seen_at: '2026-08-01T00:00:00Z' }),
    ]);

    expect(kept.map(k => k.id).sort()).toEqual(['android-new', 'ios-only']);
  });

  it('falls back to created_at when a row has never been seen again', () => {
    const kept = newestTokenPerPlatform([
      row({ id: 'older', created_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'newer', created_at: '2026-09-04T00:00:00Z' }),
    ]);
    expect(kept[0].id).toBe('newer');
  });

  it('prefers last_seen_at over created_at — a reinstalled device is newer than an older row that is still in use', () => {
    // The row created LATER has not been seen since; the older row is the live device.
    const kept = newestTokenPerPlatform([
      row({ id: 'live', created_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-05T12:00:00Z' }),
      row({ id: 'abandoned', created_at: '2026-09-03T00:00:00Z' }),
    ]);
    expect(kept[0].id).toBe('live');
  });

  it('keeps a row with no timestamps at all rather than dropping a real token', () => {
    // Undated sorts last, but it is still somebody's device and it wins when it is the only one.
    const kept = newestTokenPerPlatform([row({ id: 'undated' })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('undated');
  });

  it('returns nothing for nobody, without throwing', () => {
    expect(newestTokenPerPlatform([])).toEqual([]);
  });

  it('does not mutate the caller\'s array — the run still reports how many were suppressed', () => {
    const rows = [
      row({ id: 'a', last_seen_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'b', last_seen_at: '2026-09-05T00:00:00Z' }),
    ];
    const before = rows.map(r => r.id);
    newestTokenPerPlatform(rows);
    expect(rows.map(r => r.id)).toEqual(before);
  });
});
