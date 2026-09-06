// A BADGE SOMEBODY EARNED MUST APPEAR, INCLUDING ONE THIS CODE DOES NOT RECOGNISE.
//
// ⚠️ WHY THIS EXISTS. Tre asked "where is the achievements section?" having earned
// `lesson:what-a-cash-floor-is` that evening and held `follow_instagram` since 2026-09-03. There
// was no page, no route and no list — the app knew about both and showed him neither.
//
// ⚠️ AND THE THIRD FAMILY WAS NOT IN EITHER SOURCE FILE. The catalogue was built by asking the
// DATABASE what ids exist — `select achievement_id, count(*) from achievements group by 1` —
// which returned `og_founder` (3 holders) alongside the two. **`og_founder` is granted
// server-side only and is deliberately absent from the client INSERT policy**, so nothing in
// `src/` mints it and a catalogue derived from the minting code would have silently omitted a
// badge three people hold. Reading the code would have produced a confidently incomplete list.

import { describe, it, expect } from 'vitest';
import { resolveAchievement, resolveAchievements, TOTAL_LESSON_BADGES } from '@/lib/achievements';

const at = (iso: string) => iso;

describe('resolveAchievement', () => {
  it('⚠️ names the lesson badge Tre actually earned', () => {
    const r = resolveAchievement({
      achievement_id: 'lesson:what-a-cash-floor-is', earned_at: at('2026-09-05T18:27:00Z'),
    });
    expect(r.name).toBe('Floor Set');
    expect(r.kind).toBe('lesson');
    expect(r.known).toBe(true);
    expect(r.description).toMatch(/cash floor/i);
  });

  it('⚠️ names the social badge he has held since 09-03', () => {
    const r = resolveAchievement({
      achievement_id: 'follow_instagram', earned_at: at('2026-09-03T07:56:12Z'),
    });
    expect(r.name).toBe('Instagram');
    expect(r.kind).toBe('social');
    expect(r.known).toBe(true);
    // ⚠️ The label describes the TAP, never the follow — the app cannot know whether anybody
    // actually followed, and a badge claiming they did would be something it made up.
    expect(r.description).toMatch(/tapped through/i);
  });

  it('⚠️ names `og_founder`, the family neither source file mints', () => {
    const r = resolveAchievement({ achievement_id: 'og_founder', earned_at: at('2026-09-02T00:00:00Z') });
    expect(r.kind).toBe('founder');
    expect(r.known).toBe(true);
    expect(r.name).toBe('Founder');
  });

  it('⚠️ SHOWS an unrecognised badge rather than dropping or renaming it', () => {
    // Dropping it makes somebody's trophy case quietly wrong; inventing a name presents a label
    // nobody chose as though somebody had.
    const r = resolveAchievement({ achievement_id: 'mystery_badge', earned_at: at('2026-01-01T00:00:00Z') });
    expect(r.name).toBe('mystery_badge');
    expect(r.known).toBe(false);
    expect(r.kind).toBe('unknown');
  });

  it('keeps a badge from a lesson that has left the library', () => {
    const r = resolveAchievement({ achievement_id: 'lesson:retired-one', earned_at: at('2026-01-01T00:00:00Z') });
    expect(r.kind).toBe('lesson');
    expect(r.known).toBe(false);
    expect(r.name).toBe('retired-one');
  });
});

describe('resolveAchievements', () => {
  it('⚠️ returns BOTH of the rows Tre actually holds, newest first', () => {
    const rows = [
      { achievement_id: 'follow_instagram', earned_at: at('2026-09-03T07:56:12Z') },
      { achievement_id: 'lesson:what-a-cash-floor-is', earned_at: at('2026-09-05T18:27:00Z') },
    ];
    const out = resolveAchievements(rows);
    expect(out.map(a => a.name)).toEqual(['Floor Set', 'Instagram']);
  });

  it('loses nothing, whatever the mix', () => {
    const rows = [
      { achievement_id: 'og_founder', earned_at: at('2026-09-02T00:00:00Z') },
      { achievement_id: 'mystery_badge', earned_at: at('2026-09-04T00:00:00Z') },
      { achievement_id: 'lesson:what-a-cash-floor-is', earned_at: at('2026-09-05T18:27:00Z') },
    ];
    expect(resolveAchievements(rows)).toHaveLength(3);
  });

  it('counts only LESSONS as the denominator, because the others have none', () => {
    // Social badges are a fixed pair and `og_founder` is a cohort nobody can decide to join, so a
    // progress figure over them would invent a denominator.
    expect(TOTAL_LESSON_BADGES).toBeGreaterThan(1);
  });

  it('handles an empty history without inventing one', () => {
    expect(resolveAchievements([])).toEqual([]);
  });
});
