import { describe, it, expect } from 'vitest';
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_GROUPS, CATEGORIES_GROUPED_FLAT } from '../types';

/**
 * The grouped picker ordering is DERIVED against CATEGORIES, never named by hand
 * in each picker. These assertions are the only thing stopping a category being
 * added to CATEGORIES and silently disappearing from every picker in the app -
 * a select that renders 25 of 26 options throws nothing and looks correct.
 */
describe('CATEGORY_GROUPS covers CATEGORIES exactly', () => {
  it('has a positive control: the flattened list is non-empty', () => {
    // Without this, every assertion below is satisfiable by two empty lists.
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(CATEGORIES_GROUPED_FLAT.length).toBeGreaterThan(0);
  });

  it('contains every category exactly once', () => {
    const seen = new Map<string, number>();
    for (const c of CATEGORIES_GROUPED_FLAT) seen.set(c, (seen.get(c) ?? 0) + 1);

    const missing = CATEGORIES.filter(c => !seen.has(c));
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
    const unknown = [...seen.keys()].filter(c => !(CATEGORIES as readonly string[]).includes(c));

    expect({ missing, duplicated, unknown }).toEqual({ missing: [], duplicated: [], unknown: [] });
    expect(CATEGORIES_GROUPED_FLAT.length).toBe(CATEGORIES.length);
  });

  it('gives every category an emoji', () => {
    // `Business Contributions` had none until 2026-09-14, so every picker
    // rendering CATEGORY_EMOJI[c] showed a blank where its icon belonged.
    const withoutEmoji = CATEGORIES.filter(c => !CATEGORY_EMOJI[c]);
    expect(withoutEmoji).toEqual([]);
  });

  it('labels every group and leaves none empty', () => {
    for (const g of CATEGORY_GROUPS) {
      expect(g.label.trim()).not.toBe('');
      expect(g.categories.length).toBeGreaterThan(0);
    }
  });
});
