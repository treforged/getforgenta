import { describe, it, expect } from 'vitest';
import { pickNewBadge, readAnnounced, markAnnounced, announcedKey, type EarnedBadgeCandidate } from '../new-badge';

const NOW = new Date('2026-09-30T12:00:00Z');
const row = (id: string, earnedAt: string | null, over: Partial<EarnedBadgeCandidate> = {}): EarnedBadgeCandidate =>
  ({ id, name: id, earned: earnedAt !== null, earnedAt, known: true, ...over });

describe('pickNewBadge', () => {
  it('announces the most recent badge earned inside the window', () => {
    const got = pickNewBadge([row('a', '2026-09-28T00:00:00Z'), row('b', '2026-09-30T09:00:00Z')], new Set(), NOW);
    expect(got?.id).toBe('b');
  });
  it('never announces a badge earned before the window, so old holders get no backlog', () => {
    expect(pickNewBadge([row('old', '2026-09-01T00:00:00Z')], new Set(), NOW)).toBeNull();
  });
  it('skips what this device already announced, then offers the next', () => {
    const rows = [row('a', '2026-09-29T00:00:00Z'), row('b', '2026-09-30T09:00:00Z')];
    expect(pickNewBadge(rows, new Set(['b']), NOW)?.id).toBe('a');
    expect(pickNewBadge(rows, new Set(['a', 'b']), NOW)).toBeNull();
  });
  it('skips unearned, undefined and unreadable rows', () => {
    expect(pickNewBadge([
      row('u', null),
      row('x', '2026-09-30T09:00:00Z', { known: false }),
      row('bad', 'not-a-date'),
    ], new Set(), NOW)).toBeNull();
  });
  it('ignores a timestamp from the future beyond clock skew', () => {
    expect(pickNewBadge([row('f', '2026-10-05T00:00:00Z')], new Set(), NOW)).toBeNull();
  });
});

describe('announced store', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it('round-trips per user', () => {
    const s = mem();
    markAnnounced('u1', 'goal', s);
    expect(readAnnounced('u1', s).has('goal')).toBe(true);
    expect(readAnnounced('u2', s).size).toBe(0);
  });
  it('treats corrupt storage as empty rather than throwing', () => {
    const s = mem(); s.setItem(announcedKey('u1'), '{not json');
    expect(readAnnounced('u1', s).size).toBe(0);
    s.setItem(announcedKey('u1'), JSON.stringify(['ok', 5, null]));
    expect([...readAnnounced('u1', s)]).toEqual(['ok']);
  });
});
