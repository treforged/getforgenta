import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT } from '../dashboard-widgets';

/**
 * Ask 403dd5d8 part 4: the dashboard is "a quick snappy what needs to be paid next". The two
 * "what is due" cards sit together near the top, and Tre's own placements stay where he put them.
 */
describe('default dashboard order', () => {
  const ids = DEFAULT_LAYOUT.map(w => w.id);

  it('keeps his hero first and his budget row directly behind it (90b39aba)', () => {
    expect(ids.slice(0, 2)).toEqual(['monthly_snapshot', 'budget_totals']);
  });

  it('puts Debt Recommendations directly behind Upcoming This Week', () => {
    expect(ids.indexOf('debt_recommendations')).toBe(ids.indexOf('upcoming_week') + 1);
  });

  it('puts both due cards above every long-horizon card', () => {
    const lastDue = Math.max(ids.indexOf('upcoming_week'), ids.indexOf('debt_recommendations'));
    for (const later of ['net_worth_trend', 'car_goal', 'goal_progress'] as const) {
      expect(ids.indexOf(later)).toBeGreaterThan(lastDue);
    }
  });
});
