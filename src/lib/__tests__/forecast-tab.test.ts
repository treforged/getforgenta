// The Forecast panel a link asks for, and the panel a remembered value resolves to. Fifth spelling
// of the contract in `activity-tab.ts`/`dashboard-tab.ts`/`accounts-tab.ts`/`garage-tab.ts`; these
// tests exist so the fifth cannot quietly default differently from the other four.

import { describe, it, expect } from 'vitest';
import {
  FORECAST_TABS,
  FORECAST_TAB_FALLBACK,
  FORECAST_TAB_STORAGE_KEY,
  forecastTabFromSearch,
  effectiveForecastTab,
  isForecastTab,
} from '@/lib/forecast-tab';

describe('forecast-tab', () => {
  it('names exactly the two panels the page renders, in the order the row shows them', () => {
    expect([...FORECAST_TABS]).toEqual(['forecast', 'goals']);
  });

  it('falls back to the forecast itself, not to the panel that was added to it', () => {
    expect(FORECAST_TAB_FALLBACK).toBe('forecast');
  });

  it('keeps one spelling of the storage key', () => {
    expect(FORECAST_TAB_STORAGE_KEY).toBe('tre:forecast:tab');
  });

  it('reads the panel a link names, from a string or from URLSearchParams', () => {
    expect(forecastTabFromSearch('?tab=goals')).toBe('goals');
    expect(forecastTabFromSearch('?tab=forecast')).toBe('forecast');
    expect(forecastTabFromSearch(new URLSearchParams('tab=goals'))).toBe('goals');
  });

  // The load-bearing half: a link that says nothing, and a link that says something we do not
  // recognise, must BOTH leave the user's own remembered panel alone. Returning the fallback here
  // would silently drag every such visitor off the panel they left the page on.
  it('returns null — never a default — when the link names no panel it knows', () => {
    expect(forecastTabFromSearch('')).toBeNull();
    expect(forecastTabFromSearch('?tab=')).toBeNull();
    expect(forecastTabFromSearch('?tab=savings')).toBeNull();
    expect(forecastTabFromSearch('?other=goals')).toBeNull();
  });

  it('recognises only the panels it renders', () => {
    expect(isForecastTab('forecast')).toBe(true);
    expect(isForecastTab('goals')).toBe(true);
    expect(isForecastTab('savings')).toBe(false);
    expect(isForecastTab(null)).toBe(false);
    expect(isForecastTab(undefined)).toBe(false);
  });

  // The heal. A stored value the page no longer recognises has to resolve to a panel, or the
  // surface renders empty with no error for a user who cannot see why.
  it('heals a remembered value it no longer recognises instead of rendering nothing', () => {
    expect(effectiveForecastTab('goals')).toBe('goals');
    expect(effectiveForecastTab('savings')).toBe(FORECAST_TAB_FALLBACK);
    expect(effectiveForecastTab('')).toBe(FORECAST_TAB_FALLBACK);
    expect(effectiveForecastTab(null)).toBe(FORECAST_TAB_FALLBACK);
    expect(effectiveForecastTab(undefined)).toBe(FORECAST_TAB_FALLBACK);
  });
});
