import { describe, it, expect } from 'vitest';
import { garageTabFromSearch, isGarageTab, normalizeGarageTab, GARAGE_TABS } from '@/lib/garage-tab';

describe('garageTabFromSearch', () => {
  it('reads the tab a deep link asks for', () => {
    expect(garageTabFromSearch('?tab=builds')).toBe('builds');
    expect(garageTabFromSearch('?tab=vehicles')).toBe('vehicles');
  });

  it('returns null when the link asks for nothing — the remembered tab must survive a plain visit', () => {
    expect(garageTabFromSearch('')).toBeNull();
    expect(garageTabFromSearch('?other=1')).toBeNull();
  });

  it('returns null for a tab it does not know, rather than falling back to a default', () => {
    expect(garageTabFromSearch('?tab=maintenance')).toBeNull();
    expect(garageTabFromSearch('?tab=')).toBeNull();
  });

  it('lands a link to a RETIRED panel on the car list rather than nowhere', () => {
    // `/vehicles?tab=loan` and `?tab=saving` are still in the wild; those two panels moved to
    // /debt's Auto Loans tab on 2026-08-27.
    expect(garageTabFromSearch('?tab=loan')).toBe('vehicles');
    expect(garageTabFromSearch('?tab=saving')).toBe('vehicles');
  });

  it('accepts URLSearchParams as well as a raw string', () => {
    expect(garageTabFromSearch(new URLSearchParams({ tab: 'builds' }))).toBe('builds');
  });

  it('knows exactly the two panels the page renders', () => {
    expect([...GARAGE_TABS]).toEqual(['vehicles', 'builds']);
    expect(isGarageTab('builds')).toBe(true);
    expect(isGarageTab('saving')).toBe(false);
    expect(isGarageTab('nope')).toBe(false);
    expect(isGarageTab(null)).toBe(false);
  });
});

describe('normalizeGarageTab', () => {
  it('passes a live tab straight through', () => {
    expect(normalizeGarageTab('builds')).toBe('builds');
    expect(normalizeGarageTab('vehicles')).toBe('vehicles');
  });

  it('maps the two retired panels onto the car list', () => {
    // Every user last on Saving or Active Loans still has that value in
    // `tre:vehicles:activeTab`. Without this they would land on a panel that renders nothing.
    expect(normalizeGarageTab('saving')).toBe('vehicles');
    expect(normalizeGarageTab('loan')).toBe('vehicles');
  });

  it('falls back rather than rendering nothing for an unknown or missing value', () => {
    expect(normalizeGarageTab(null)).toBe('vehicles');
    expect(normalizeGarageTab('nope')).toBe('vehicles');
    expect(normalizeGarageTab('nope', 'builds')).toBe('builds');
  });
});
