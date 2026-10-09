// The onboarding finish screen's "Where things are" box, derived from the nav.
// It was hand-written and still said "five icons ... Garage for vehicles" on 2026-10-09,
// three days after Plan took Garage's slot (decision c5e29d9e). Growth pass 2026-10-09.
import { describe, it, expect } from 'vitest';
import { firstRunNavSummary, NAV_PURPOSE } from '@/lib/first-run-nav';
import { PRIMARY_NAV } from '@/lib/primary-nav';
import { quickAddIsOpen } from '@/lib/quick-add';

describe('first-run nav summary', () => {
  it('names every bottom-bar destination, in bar order, each with a purpose', () => {
    const items = firstRunNavSummary();
    // Control: the nav is not empty, so "every item has a purpose" is not vacuous.
    expect(PRIMARY_NAV.length).toBeGreaterThanOrEqual(4);
    expect(items.map((i) => i.label)).toEqual(PRIMARY_NAV.map((d) => d.label));
    for (const i of items) expect(i.purpose, i.label).not.toBe('');
  });

  it('carries no purpose for a route the bar does not have', () => {
    const live = new Set(PRIMARY_NAV.map((d) => d.to));
    for (const route of Object.keys(NAV_PURPOSE)) expect(live.has(route), route).toBe(true);
  });

  it('says Plan and still tells people where the Garage went', () => {
    const text = firstRunNavSummary().map((i) => `${i.label} ${i.purpose}`).join(' ');
    expect(text).toContain('Plan');
    expect(text).toContain('Garage');
  });
});

describe('quickAddIsOpen', () => {
  it('is free on web, gated for a free native account, open for premium and demo', () => {
    expect(quickAddIsOpen({ isPremium: false, isDemo: false, native: false })).toBe(true);
    expect(quickAddIsOpen({ isPremium: false, isDemo: false, native: true })).toBe(false);
    expect(quickAddIsOpen({ isPremium: true, isDemo: false, native: true })).toBe(true);
    expect(quickAddIsOpen({ isPremium: false, isDemo: true, native: true })).toBe(true);
  });
});
