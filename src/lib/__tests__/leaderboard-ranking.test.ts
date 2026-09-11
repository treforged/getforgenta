import { describe, it, expect } from 'vitest';
import {
  buildLeaderboardRows,
  hasComparableField,
  isEmptyRoom,
  type LeaderboardFriendInput,
  type LeaderboardSnapshotInput,
} from '../leaderboard-ranking';

const WEEK = '2026-09-07';
const LAST_WEEK = '2026-08-31';

function friends(...ids: string[]): LeaderboardFriendInput[] {
  return ids.map((id) => ({ userId: id, label: id.toUpperCase() }));
}

function snap(
  userId: string,
  bucketValue: number,
  week: string = WEEK,
): LeaderboardSnapshotInput {
  return { userId, metric: 'goal_progress', bucketValue, week };
}

describe('buildLeaderboardRows - a rank must be a reading, not a tie-break', () => {
  it('gives tied friends the SAME rank and skips the next, rather than ordering them silently', () => {
    const rows = buildLeaderboardRows(friends('a', 'b', 'c'), [snap('a', 60), snap('b', 60), snap('c', 40)], 'goal_progress', WEEK);
    expect(rows.map((r) => [r.userId, r.rank, r.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
    ]);
  });

  it('marks EVERY member of a tie, not just the later ones', () => {
    const rows = buildLeaderboardRows(friends('a', 'b', 'c'), [snap('a', 50), snap('b', 50), snap('c', 50)], 'goal_progress', WEEK);
    expect(rows.every((r) => r.tied)).toBe(true);
    expect(rows.every((r) => r.rank === 1)).toBe(true);
  });

  it('does not mark a lone value as tied', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 60), snap('b', 40)], 'goal_progress', WEEK);
    expect(rows.map((r) => r.tied)).toEqual([false, false]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  /**
   * The reason this file exists. Buckets are 5% wide, so there are only 21 possible values and
   * ties are ordinary. If ranking ever silently breaks them, this is the case that catches it.
   */
  it('never assigns distinct ranks to equal values, across a crowded board', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const rows = buildLeaderboardRows(
      friends(...ids),
      [snap('a', 80), snap('b', 80), snap('c', 80), snap('d', 20), snap('e', 20), snap('f', 0)],
      'goal_progress',
      WEEK,
    );
    const byValue = new Map<number, Set<number | null>>();
    for (const r of rows) {
      if (r.value === null) continue;
      if (!byValue.has(r.value)) byValue.set(r.value, new Set());
      byValue.get(r.value)?.add(r.rank);
    }
    for (const [value, ranksForValue] of byValue) {
      expect(ranksForValue.size, `value ${value} got ${ranksForValue.size} different ranks`).toBe(1);
    }
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1, 4, 4, 6]);
  });

  it('sorts highest first and keeps the caller order within a tie', () => {
    const rows = buildLeaderboardRows(friends('a', 'b', 'c'), [snap('a', 10), snap('b', 90), snap('c', 90)], 'goal_progress', WEEK);
    expect(rows.map((r) => r.userId)).toEqual(['b', 'c', 'a']);
  });
});

describe('buildLeaderboardRows - absent, private and stale are three different things', () => {
  it('shows a friend with no snapshot as private, not as 0', () => {
    const [row] = buildLeaderboardRows(friends('a'), [], 'goal_progress', WEEK);
    expect(row.state).toBe('private');
    expect(row.value).toBeNull();
    expect(row.rank).toBeNull();
  });

  it('keeps a private friend as a ROW, so a shorter list cannot leak that they opted out', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 50)], 'goal_progress', WEEK);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.state)).toEqual(['value', 'private']);
  });

  it('marks a snapshot from the previous week stale and refuses to rank it as current', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 50), snap('b', 95, LAST_WEEK)], 'goal_progress', WEEK);
    const stale = rows.find((r) => r.userId === 'b');
    expect(stale?.state).toBe('stale');
    expect(stale?.value).toBe(95);
    expect(stale?.rank).toBeNull();
    // The stale 95 must NOT beat the current 50.
    expect(rows[0].userId).toBe('a');
    expect(rows[0].rank).toBe(1);
  });

  it('treats a real 0 as a value, which is not the same as private', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 0)], 'goal_progress', WEEK);
    expect(rows[0]).toMatchObject({ userId: 'a', state: 'value', value: 0, rank: 1 });
    expect(rows[1]).toMatchObject({ userId: 'b', state: 'private', value: null, rank: null });
  });

  it('uses the most recent snapshot when several weeks are present', () => {
    const rows = buildLeaderboardRows(friends('a'), [snap('a', 20, LAST_WEEK), snap('a', 70, WEEK)], 'goal_progress', WEEK);
    expect(rows[0]).toMatchObject({ state: 'value', value: 70 });
  });

  it('ignores snapshots for a different metric entirely', () => {
    const rows = buildLeaderboardRows(
      friends('a'),
      [{ userId: 'a', metric: 'debt_payoff', bucketValue: 90, week: WEEK }],
      'goal_progress',
      WEEK,
    );
    expect(rows[0].state).toBe('private');
  });

  it('ignores a snapshot for somebody who is not a friend', () => {
    const rows = buildLeaderboardRows(friends('a'), [snap('stranger', 100)], 'goal_progress', WEEK);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('a');
    expect(rows[0].state).toBe('private');
  });

  it('returns nothing at all for no friends', () => {
    expect(buildLeaderboardRows([], [snap('a', 50)], 'goal_progress', WEEK)).toEqual([]);
  });
});

describe('hasComparableField', () => {
  it('is false for a single participant - one person is not a ranking', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 50)], 'goal_progress', WEEK);
    expect(hasComparableField(rows)).toBe(false);
  });

  it('is true once two people have published this week', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 50), snap('b', 20)], 'goal_progress', WEEK);
    expect(hasComparableField(rows)).toBe(true);
  });

  it('does not count stale or private rows toward a comparison', () => {
    const rows = buildLeaderboardRows(friends('a', 'b', 'c'), [snap('a', 50), snap('b', 90, LAST_WEEK)], 'goal_progress', WEEK);
    expect(hasComparableField(rows)).toBe(false);
  });
});

describe('isEmptyRoom', () => {
  it('is true when there are friends but nobody is sharing', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [], 'goal_progress', WEEK);
    expect(isEmptyRoom(rows)).toBe(true);
  });

  it('is FALSE when there are no friends at all - a different message entirely', () => {
    expect(isEmptyRoom(buildLeaderboardRows([], [], 'goal_progress', WEEK))).toBe(false);
  });

  it('is false as soon as one friend has published', () => {
    const rows = buildLeaderboardRows(friends('a', 'b'), [snap('a', 5)], 'goal_progress', WEEK);
    expect(isEmptyRoom(rows)).toBe(false);
  });

  it('counts a stale-only board as empty, because nothing current is being compared', () => {
    const rows = buildLeaderboardRows(friends('a'), [snap('a', 60, LAST_WEEK)], 'goal_progress', WEEK);
    expect(isEmptyRoom(rows)).toBe(true);
  });
});
