import { describe, it, expect } from 'vitest';
import { debtTabFromSearch, isDebtTab, DEBT_TABS } from '@/lib/debt-tab';

describe('debtTabFromSearch', () => {
  it('reads the tab a deep link asks for', () => {
    // The Garage's car list points at `/debt?tab=auto` now that the vehicle money lives there.
    expect(debtTabFromSearch('?tab=auto')).toBe('auto');
    expect(debtTabFromSearch('?tab=cards')).toBe('cards');
    expect(debtTabFromSearch(new URLSearchParams({ tab: 'mortgage' }))).toBe('mortgage');
  });

  it('returns null when the link asks for nothing — a plain visit keeps the remembered tab', () => {
    expect(debtTabFromSearch('')).toBeNull();
    expect(debtTabFromSearch('?new=1&type=auto_loan')).toBeNull();
  });

  it('returns null for a tab it does not know rather than falling back to a default', () => {
    expect(debtTabFromSearch('?tab=vehicles')).toBeNull();
    expect(debtTabFromSearch('?tab=')).toBeNull();
  });

  it('knows exactly the five panels the page renders', () => {
    expect([...DEBT_TABS]).toEqual(['cards', 'auto', 'mortgage', 'student', 'other']);
    expect(isDebtTab('other')).toBe(true);
    expect(isDebtTab('nope')).toBe(false);
    expect(isDebtTab(null)).toBe(false);
  });
});
