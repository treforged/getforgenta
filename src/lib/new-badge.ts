/**
 * Which earned milestone badge, if any, to announce on the dashboard (Sam 2026-09-30: invite at
 * a moment of value). Pure, so the rule is asserted without a DOM.
 *
 * WHY THE DASHBOARD: since 2026-09-17 the grant call (`claim_milestone_achievements`) ran only when
 * the Trophy Case mounted inside Account > Achievements, so reaching a goal earned nothing a person
 * could see at the moment it happened.
 *
 * The rule: the most recently earned badge that has a definition, was earned within the window,
 * and has not already been announced on this device. Older badges are never announced, so an
 * account that already holds badges does not get a backlog of them.
 */
export interface EarnedBadgeCandidate {
  id: string;
  name: string;
  earned: boolean;
  earnedAt: string | null;
  known: boolean;
}

export const ANNOUNCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function pickNewBadge(
  rows: readonly EarnedBadgeCandidate[],
  seen: ReadonlySet<string>,
  now: Date,
  windowMs: number = ANNOUNCE_WINDOW_MS,
): EarnedBadgeCandidate | null {
  const fresh = rows
    .filter((r) => r.earned && r.known && r.earnedAt && !seen.has(r.id))
    .map((r) => ({ r, t: new Date(r.earnedAt as string).getTime() }))
    .filter(({ t }) => Number.isFinite(t) && t <= now.getTime() + 60_000 && now.getTime() - t <= windowMs)
    .sort((a, b) => b.t - a.t);
  return fresh.length ? fresh[0].r : null;
}

export function announcedKey(userId: string): string {
  return `forgenta:badges-announced:${userId}`;
}

/** Reads the announced set. Storage can be absent or hostile, so a bad read is an empty set. */
export function readAnnounced(userId: string, storage: Pick<Storage, 'getItem'> = localStorage): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(announcedKey(userId)) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markAnnounced(userId: string, id: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  try {
    const next = readAnnounced(userId, storage);
    next.add(id);
    storage.setItem(announcedKey(userId), JSON.stringify([...next].slice(-200)));
  } catch {
    // A full or blocked store only means the row may show again; it must never break the page.
  }
}
