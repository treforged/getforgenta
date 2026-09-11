import type { LeaderboardMetric } from './leaderboard-metrics';

/**
 * Turning a set of friends' buckets into rows a person can read.
 *
 * ⚠️ **THE WHOLE POINT OF THIS FILE IS THAT A RANK IS USUALLY A TIE-BREAK, NOT A READING.**
 * The buckets are 5% wide, so a metric has only **21 possible values**. Among a handful of
 * friends, exact ties are the common case rather than the edge case - and a list numbered
 * 1, 2, 3 presents whatever order the array happened to arrive in as if it were a measurement.
 * Two people on 60% are not first and second. They are tied, and the UI has to say so.
 *
 * So `rank` here is STANDARD COMPETITION RANKING: tied entries share a rank and the next rank
 * skips (1, 1, 3). `tied` is set on every row that shares its value with another, so the caller
 * never has to re-derive it and cannot forget to.
 *
 * The other half is that **absent, private and stale are three different things**, and none of
 * them is zero:
 *
 *   - `private` - this friend has not opted this metric in. They are a row, not a gap, because
 *     omitting them would leak that they are not sharing by making the list shorter.
 *   - `stale`   - they opted in but their most recent snapshot is from an earlier week. The
 *     number is real and old; showing it as current would be a confident wrong answer.
 *   - a value   - a bucket they published this week.
 *
 * A friend with no snapshot at all reads as `private`, which is the honest fail-closed reading:
 * from this side, "opted out" and "opted in but never published" are indistinguishable, and the
 * one that reveals less is the one to show.
 */

/** What a friend's standing in one metric can be. A value of 0 is a real reading, not an absence. */
export type LeaderboardEntryState = 'value' | 'private' | 'stale';

export interface LeaderboardSnapshotInput {
  userId: string;
  metric: LeaderboardMetric;
  bucketValue: number;
  /** Monday of the week the snapshot is for, as `YYYY-MM-DD`. */
  week: string;
}

export interface LeaderboardFriendInput {
  userId: string;
  label: string;
}

export interface LeaderboardRow {
  userId: string;
  label: string;
  state: LeaderboardEntryState;
  /** The published bucket. `null` for `private`. Present but out of date for `stale`. */
  value: number | null;
  /**
   * Standard competition rank among rows that have a value this week: ties share a rank and the
   * next rank skips. `null` for every row without a current value - a person who is not
   * participating has no position, and giving them one would invent a standing.
   */
  rank: number | null;
  /** True when at least one other row shares this row's value. Never true when `rank` is null. */
  tied: boolean;
}

/**
 * Build the rows for one metric.
 *
 * Deterministic and pure. Friends are returned in the order: highest value first, then every
 * non-participating row, each group holding the caller's original friend order so the list does
 * not reshuffle between renders for reasons the reader cannot see.
 *
 * `currentWeek` is passed in rather than read from the clock, so this is testable and so the
 * caller decides what "this week" means exactly once.
 */
export function buildLeaderboardRows(
  friends: ReadonlyArray<LeaderboardFriendInput>,
  snapshots: ReadonlyArray<LeaderboardSnapshotInput>,
  metric: LeaderboardMetric,
  currentWeek: string,
): LeaderboardRow[] {
  // Latest snapshot per friend for this metric. `week` is a YYYY-MM-DD string, so a lexicographic
  // comparison IS a chronological one - true for this format and not in general, which is why it
  // is said here rather than assumed by the next reader.
  const latest = new Map<string, LeaderboardSnapshotInput>();
  for (const s of snapshots) {
    if (s.metric !== metric) continue;
    const held = latest.get(s.userId);
    if (!held || s.week > held.week) {
      latest.set(s.userId, s);
    }
  }

  const rows: LeaderboardRow[] = friends.map((f) => {
    const snap = latest.get(f.userId);
    if (!snap) {
      return { userId: f.userId, label: f.label, state: 'private', value: null, rank: null, tied: false };
    }
    if (snap.week !== currentWeek) {
      return { userId: f.userId, label: f.label, state: 'stale', value: snap.bucketValue, rank: null, tied: false };
    }
    return { userId: f.userId, label: f.label, state: 'value', value: snap.bucketValue, rank: null, tied: false };
  });

  const ranked = rows.filter((r) => r.state === 'value');
  const rest = rows.filter((r) => r.state !== 'value');

  // Descending by value, stable within equal values so the caller's order survives. Array.prototype
  // .sort is specified as stable, so equal entries keep their relative order rather than being
  // reordered by an engine detail nobody can see.
  ranked.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  let previousValue: number | null = null;
  let previousRank = 0;
  ranked.forEach((row, index) => {
    if (previousValue !== null && row.value === previousValue) {
      row.rank = previousRank; // a tie SHARES the rank rather than taking the next one
    } else {
      row.rank = index + 1; // and the next distinct value skips, so 1, 1, 3
      previousRank = row.rank;
      previousValue = row.value;
    }
  });

  const counts = new Map<number, number>();
  for (const row of ranked) {
    if (row.value === null) continue;
    counts.set(row.value, (counts.get(row.value) ?? 0) + 1);
  }
  for (const row of ranked) {
    row.tied = row.value !== null && (counts.get(row.value) ?? 0) > 1;
  }

  return [...ranked, ...rest];
}

/**
 * Whether a leaderboard is worth showing a ranking for at all.
 *
 * With one participant there is no comparison being made, and a list of one headed "1st" tells
 * the reader they are winning something nobody else entered. The caller should show the value
 * without a position in that case.
 */
export function hasComparableField(rows: ReadonlyArray<LeaderboardRow>): boolean {
  return rows.filter((r) => r.state === 'value').length >= 2;
}

/**
 * Whether every friend is either private or stale - the "empty room" state.
 *
 * Separated from `rows.length === 0` on purpose: having friends who all share nothing is a
 * different message from having no friends, and collapsing them would tell someone with five
 * friends to go and invite somebody.
 */
export function isEmptyRoom(rows: ReadonlyArray<LeaderboardRow>): boolean {
  return rows.length > 0 && rows.every((r) => r.state !== 'value');
}
