// The guide registry's two promises: it always answers, and it answers about the PANEL.
//
// The second one is the whole point of the file. Before it, `/debt` had one guide covering
// five panels and `/dashboard` rendered two guide buttons at once, so these assert that
// each panel resolves to its own entry rather than to a page-shaped one.
import { describe, it, expect } from 'vitest';
import { PAGE_GUIDES, resolveGuide, type GuideSurface } from '../page-guides';

const SURFACES: GuideSurface[] = ['dashboard', 'accounts', 'transactions', 'debt', 'forecast', 'garage'];

describe('resolveGuide', () => {
  it('gives each panel its own guide, not the page it lives on', () => {
    // The five debt panels used to share one Credit Card Payoff guide.
    const titles = ['cards', 'auto', 'mortgage', 'student', 'other'].map(p => resolveGuide('debt', p).title);
    expect(new Set(titles).size).toBe(5);
    expect(resolveGuide('debt', 'auto').title).toBe('Auto Loan Guide');

    // The two surfaces that rendered TWO buttons at once now each resolve to one.
    expect(resolveGuide('dashboard', 'overview').title).toBe('Dashboard Guide');
    expect(resolveGuide('dashboard', 'accounts').title).toBe('Accounts Guide');
    expect(resolveGuide('transactions', 'budget').title).toBe('Budget Control Guide');
    expect(resolveGuide('transactions', 'bank').title).toBe('Bank Activity Guide');
  });

  it('never returns nothing — an unknown panel falls back to the surface default', () => {
    for (const surface of SURFACES) {
      const guide = resolveGuide(surface, 'a-panel-that-does-not-exist');
      expect(guide).toBeDefined();
      expect(guide.sections.length).toBeGreaterThan(0);
    }
    expect(resolveGuide('debt', 'nonsense').title).toBe('Credit Card Payoff Guide');
  });

  it('has no blank entry anywhere — a Guide button that opens an empty sheet is worse than none', () => {
    for (const [key, guide] of Object.entries(PAGE_GUIDES)) {
      expect(guide.title, key).toBeTruthy();
      expect(guide.sections.length, key).toBeGreaterThan(0);
      for (const section of guide.sections) {
        expect(section.title, key).toBeTruthy();
        expect(section.body.length, `${key} — ${section.title}`).toBeGreaterThan(20);
      }
    }
  });

  it('covers every surface that owns a panel row', () => {
    for (const surface of SURFACES) {
      const keys = Object.keys(PAGE_GUIDES).filter(k => k.startsWith(`${surface}:`));
      expect(keys.length, surface).toBeGreaterThan(1);
    }
  });
});
