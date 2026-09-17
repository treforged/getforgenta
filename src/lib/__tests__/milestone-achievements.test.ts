import { describe, it, expect } from 'vitest';
import { resolveAchievement, resolveAchievements } from '@/lib/achievements';
import { MILESTONES, MILESTONE_PREFIX, lookupMilestone } from '@/lib/milestone-achievements';

/**
 * The CLIENT half of the milestone badges. The RULE — has this been earned — lives in
 * `public.claim_milestone_achievements()` and is deliberately not restated here, so there is
 * nothing in this file that could drift away from the server's answer.
 *
 * ⚠️ WHAT THIS FILE CANNOT PROVE, stated so nobody reads a green run as more than it is: it does
 * not prove the SQL counts correctly, does not prove the grant is idempotent, and does not prove
 * the RPC refuses an anonymous caller. Those were measured live against the database on
 * 2026-09-17 (unauthenticated -> `42501 authentication required`; a real account with 7 linked
 * connections, 4 goals and 670 reviews -> 4 earned / 7 unearned with matching progress, run
 * inside a transaction that was rolled back and the table confirmed unchanged at 5 rows).
 */

describe('milestone catalogue', () => {
  // POSITIVE CONTROL. Every assertion below about "unknown ids" is an absence, and an absence is
  // satisfied perfectly by a catalogue that is empty or a prefix that matches nothing. This is the
  // one assertion that proves the lookup can find something at all.
  it('finds a definition for a known milestone id', () => {
    const found = lookupMilestone('milestone:followers_1');
    expect(found).toBeDefined();
    expect(found?.name).toBe('First follower');
  });

  it('every catalogued id carries the prefix the resolver dispatches on', () => {
    const ids = Object.keys(MILESTONES);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith(MILESTONE_PREFIX)).toBe(true);
  });

  it('no definition is blank, in either field', () => {
    for (const [id, def] of Object.entries(MILESTONES)) {
      expect(def.name.trim(), `name for ${id}`).not.toBe('');
      expect(def.description.trim(), `description for ${id}`).not.toBe('');
    }
  });
});

describe('resolveAchievement — milestones', () => {
  it('names a known milestone and marks it known', () => {
    const r = resolveAchievement({ achievement_id: 'milestone:reviewed_25', earned_at: '2026-09-17T04:00:00Z' });
    expect(r.kind).toBe('milestone');
    expect(r.known).toBe(true);
    expect(r.name).toBe('25 reviewed');
  });

  it('SHOWS an unrecognised milestone rather than hiding or renaming it', () => {
    // The same rule the resolver already applies to any unknown id: a badge somebody earned
    // belongs to them even when this build's catalogue is out of date.
    const r = resolveAchievement({ achievement_id: 'milestone:not_a_real_one', earned_at: '2026-09-17T04:00:00Z' });
    expect(r.kind).toBe('milestone');
    expect(r.known).toBe(false);
    expect(r.name).toBe('not_a_real_one');
  });

  it('does not swallow the other families', () => {
    // A prefix check placed in the wrong order could capture ids it has no business naming, and
    // every one of these has live holders.
    expect(resolveAchievement({ achievement_id: 'og_founder', earned_at: 'x' }).kind).toBe('founder');
    expect(resolveAchievement({ achievement_id: 'lesson:what-a-cash-floor-is', earned_at: 'x' }).kind).toBe('lesson');
    expect(resolveAchievement({ achievement_id: 'follow_instagram', earned_at: 'x' }).kind).toBe('social');
  });

  it('sorts a mixed trophy case newest first', () => {
    const rows = [
      { achievement_id: 'milestone:goal_set', earned_at: '2026-09-01T00:00:00Z' },
      { achievement_id: 'og_founder', earned_at: '2026-09-03T00:00:00Z' },
      { achievement_id: 'milestone:bank_linked', earned_at: '2026-09-02T00:00:00Z' },
    ];
    expect(resolveAchievements(rows).map(a => a.id)).toEqual([
      'og_founder',
      'milestone:bank_linked',
      'milestone:goal_set',
    ]);
  });
});
