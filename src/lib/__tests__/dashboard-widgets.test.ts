import { describe, it, expect } from 'vitest';
import {
  mergeSavedLayout,
  DEFAULT_LAYOUT,
  WIDGET_META,
  widgetLabel,
  type WidgetConfig,
  type WidgetId,
} from '../dashboard-widgets';

const cfg = (id: WidgetId, visible = true): WidgetConfig => ({ id, visible });
const ids = (layout: readonly WidgetConfig[]) => layout.map(w => w.id);

describe('the widget registry', () => {
  it('gives every id in DEFAULT_LAYOUT a meta entry, so nothing renders as "This section"', () => {
    DEFAULT_LAYOUT.forEach(w => {
      expect(WIDGET_META.some(m => m.id === w.id)).toBe(true);
      expect(widgetLabel(w.id)).not.toBe('This section');
    });
  });

  it('carries the Net Worth Trend card, above the Car Goal it was placed in front of', () => {
    const order = ids(DEFAULT_LAYOUT);
    expect(order).toContain('net_worth_trend');
    expect(order.indexOf('net_worth_trend')).toBeLessThan(order.indexOf('car_goal'));
  });
});

describe('mergeSavedLayout', () => {
  it('returns the defaults when the profile has never saved a layout', () => {
    expect(ids(mergeSavedLayout(null))).toEqual(ids(DEFAULT_LAYOUT));
    expect(ids(mergeSavedLayout(undefined))).toEqual(ids(DEFAULT_LAYOUT));
    expect(ids(mergeSavedLayout('not a layout'))).toEqual(ids(DEFAULT_LAYOUT));
  });

  it('does not hand back the DEFAULT_LAYOUT objects themselves', () => {
    const merged = mergeSavedLayout(null);
    merged[0].visible = false;
    expect(DEFAULT_LAYOUT[0].visible).toBe(true);
  });

  it('keeps the saved order and the saved visibility', () => {
    const saved = [cfg('goal_progress', false), cfg('monthly_snapshot', true)];
    const merged = mergeSavedLayout(saved);
    expect(ids(merged).indexOf('goal_progress')).toBeLessThan(ids(merged).indexOf('monthly_snapshot'));
    expect(merged.find(w => w.id === 'goal_progress')?.visible).toBe(false);
  });

  it('drops entries that are not widgets any more, rather than leaving a hole in the stack', () => {
    const merged = mergeSavedLayout([
      { id: 'retired_widget', visible: true },
      null,
      'monthly_snapshot',
      cfg('goal_progress'),
    ]);
    expect(ids(merged)).not.toContain('retired_widget' as WidgetId);
    expect(new Set(ids(merged)).size).toBe(ids(merged).length);
  });

  it('adds every missing widget exactly once', () => {
    const merged = mergeSavedLayout([cfg('goal_progress')]);
    expect(new Set(ids(merged))).toEqual(new Set(ids(DEFAULT_LAYOUT)));
    expect(merged).toHaveLength(DEFAULT_LAYOUT.length);
  });

  // The regression this function was rewritten for: an appended new widget landed dead last on
  // every existing account, so the person who asked for the card saw a different page from a
  // brand new user.
  it('inserts a new widget at its default position, NOT at the end', () => {
    const savedWithoutTrend = DEFAULT_LAYOUT
      .filter(w => w.id !== 'net_worth_trend')
      .map(w => cfg(w.id, w.visible));

    const merged = ids(mergeSavedLayout(savedWithoutTrend));

    expect(merged[merged.length - 1]).not.toBe('net_worth_trend');
    expect(merged).toEqual(ids(DEFAULT_LAYOUT));
  });

  it('follows the user reorder — the new card lands behind its neighbour wherever that was moved', () => {
    // 'wealth_overview' is the default neighbour directly above 'net_worth_trend'. Here the user
    // has dragged it to the bottom, so the new card belongs at the bottom too, not high up.
    const saved = [
      cfg('goal_progress'),
      cfg('monthly_snapshot'),
      cfg('schedule_cards'),
      cfg('financial_health'),
      cfg('wealth_overview'),
    ];
    const merged = ids(mergeSavedLayout(saved));
    expect(merged[merged.indexOf('wealth_overview') + 1]).toBe('net_worth_trend');
  });

  it('puts a new widget at the front when it has no earlier neighbour in the saved layout', () => {
    const merged = ids(mergeSavedLayout([cfg('debt_recommendations')]));
    expect(merged[0]).toBe('monthly_snapshot');
    expect(merged[merged.length - 1]).toBe('debt_recommendations');
  });
});
