import { describe, it, expect } from 'vitest';
import { garageTabFromSearch, isGarageTab, GARAGE_TABS } from '@/lib/garage-tab';

describe('garageTabFromSearch', () => {
  it('reads the tab a deep link asks for', () => {
    expect(garageTabFromSearch('?tab=builds')).toBe('builds');
    expect(garageTabFromSearch('?tab=loan')).toBe('loan');
    expect(garageTabFromSearch('?tab=saving')).toBe('saving');
  });

  it('returns null when the link asks for nothing — the remembered tab must survive a plain visit', () => {
    expect(garageTabFromSearch('')).toBeNull();
    expect(garageTabFromSearch('?other=1')).toBeNull();
  });

  it('returns null for a tab it does not know, rather than falling back to a default', () => {
    expect(garageTabFromSearch('?tab=maintenance')).toBeNull();
    expect(garageTabFromSearch('?tab=')).toBeNull();
  });

  it('accepts URLSearchParams as well as a raw string', () => {
    expect(garageTabFromSearch(new URLSearchParams({ tab: 'builds' }))).toBe('builds');
  });

  it('knows exactly the three panels the page renders', () => {
    expect([...GARAGE_TABS]).toEqual(['saving', 'loan', 'builds']);
    expect(isGarageTab('builds')).toBe(true);
    expect(isGarageTab('nope')).toBe(false);
    expect(isGarageTab(null)).toBe(false);
  });
});
