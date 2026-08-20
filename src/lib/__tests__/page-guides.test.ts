// The guide registry's two promises: it always answers, and it answers about the PANEL.
//
// The second one is the whole point of the file. Before it, `/debt` had one guide covering
// five panels and `/dashboard` rendered two guide buttons at once, so these assert that
// each panel resolves to its own entry rather than to a page-shaped one.
import { describe, it, expect } from 'vitest';
import { PAGE_GUIDES, resolveGuide, resolveSurfaceGuide, type GuideSurface } from '../page-guides';

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
    // Goals is the Dashboard's third panel since 2026-08-20 — it must resolve to its OWN guide
    // here, not fall back to the Dashboard Guide the way an unrecognised panel does.
    expect(resolveGuide('dashboard', 'goals').title).toBe('Savings Goals Guide');
    expect(resolveGuide('forecast', 'goals').title).toBe('Forecast Guide');
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
    // ⚠️ `forecast` is deliberately absent. Goals moved to the Dashboard on 2026-08-20, which left
    // the Forecast with a single panel and therefore no panel row at all — its one guide entry is
    // the whole surface, so asserting more than one here would be asserting a row that is gone.
    const PANELLED = SURFACES.filter(s => s !== 'forecast');
    for (const surface of PANELLED) {
      const keys = Object.keys(PAGE_GUIDES).filter(k => k.startsWith(`${surface}:`));
      expect(keys.length, surface).toBeGreaterThan(1);
    }
    expect(Object.keys(PAGE_GUIDES).filter(k => k.startsWith('forecast:'))).toEqual(['forecast:forecast']);
  });
  it('combines a page into ONE guide carrying every panel under its own heading', () => {
    const debt = resolveSurfaceGuide('debt');
    expect(debt.title).toBe('Debt Guide');
    // All five panels, each block labelled with the panel it came from.
    expect(new Set(debt.sections.map(s => s.group))).toEqual(
      new Set(['Credit cards', 'Auto loans', 'Mortgage', 'Student loans', 'Other debt']),
    );
    // Composed, not forked: the combined copy IS the per-panel copy.
    expect(debt.sections.filter(s => s.group === 'Auto loans').map(s => s.title))
      .toEqual(PAGE_GUIDES['debt:auto'].sections.map(s => s.title));
  });

  it("carries the Accounts panel's own sub-panels into Home's guide", () => {
    // Accounts is HOSTED by the Dashboard, so its two sub-panels have to reach the reader
    // through Home's guide — otherwise they are only findable by switching panel first.
    const groups = resolveSurfaceGuide('dashboard').sections.map(s => s.group);
    expect(groups).toContain('Accounts · Balances');
    expect(groups).toContain('Accounts · Bank connections');
  });

  it('gives every surface a combined guide with sections in it', () => {
    for (const surface of SURFACES) {
      const guide = resolveSurfaceGuide(surface);
      expect(guide.title, surface).toBeTruthy();
      expect(guide.sections.length, surface).toBeGreaterThan(2);
      // Every section in a combined guide is attributed — an unlabelled block in a
      // multi-panel document leaves the reader guessing which panel it describes.
      for (const section of guide.sections) expect(section.group, `${surface}/${section.title}`).toBeTruthy();
    }
  });
});
