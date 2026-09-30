import { describe, it, expect } from 'vitest';
import { buildAchievementCard, cardLeaksMoney } from '../share-card';

// A badge card names the badge and the month - never its description, never a figure.
describe('buildAchievementCard', () => {
  it('builds a card with the badge name and the month earned', () => {
    const spec = buildAchievementCard({ name: 'Connected', known: true }, '2026-09-14T12:00:00Z');
    expect(spec).toMatchObject({ kind: 'badge', headline: 'Connected', subline: 'Earned September 2026' });
    expect(spec && cardLeaksMoney(spec)).toBe(false);
  });

  it('refuses a badge with no definition, whose name is a raw id', () => {
    expect(buildAchievementCard({ name: 'milestone:xyz', known: false }, '2026-09-14T12:00:00Z')).toBeNull();
  });

  it('refuses a name the money guard would flag, rather than leaking it', () => {
    expect(buildAchievementCard({ name: 'Paid $5,000', known: true }, '2026-09-14T12:00:00Z')).toBeNull();
    expect(buildAchievementCard({ name: 'Lowest APR', known: true }, '2026-09-14T12:00:00Z')).toBeNull();
  });

  it('refuses an unreadable date and a blank name', () => {
    expect(buildAchievementCard({ name: 'Connected', known: true }, 'not-a-date')).toBeNull();
    expect(buildAchievementCard({ name: '   ', known: true }, '2026-09-14T12:00:00Z')).toBeNull();
  });
});
