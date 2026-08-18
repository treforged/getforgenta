// The Activity panel a link asks for, and the panel a remembered value resolves to. Same contract
// as `dashboard-tab.ts`/`accounts-tab.ts`/`garage-tab.ts` for the link half; the heal half is new,
// because this selector reuses a storage key that predates the third panel.

import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_TABS,
  ACTIVITY_TAB_FALLBACK,
  activityTabFromSearch,
  effectiveActivityTab,
  isActivityTab,
} from '@/lib/activity-tab';

describe('activity-tab', () => {
  it('names exactly the three panels the page renders, in the order the row shows them', () => {
    expect([...ACTIVITY_TABS]).toEqual(['budget', 'planning', 'bank']);
  });

  it('does not land a fresh user on whichever pill happens to be first', () => {
    // Would-fail: defining the fallback as ACTIVITY_TABS[0] makes reordering the row silently
    // change which panel opens for everyone with nothing stored. The two are separate on purpose.
    expect(ACTIVITY_TAB_FALLBACK).toBe('planning');
    expect(ACTIVITY_TAB_FALLBACK).not.toBe(ACTIVITY_TABS[0]);
  });

  it('reads a panel a link asks for, from a string or a URLSearchParams', () => {
    expect(activityTabFromSearch('?tab=budget')).toBe('budget');
    expect(activityTabFromSearch(new URLSearchParams('tab=bank'))).toBe('bank');
    expect(activityTabFromSearch('?tab=planning')).toBe('planning');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'planning' here would reset the user's remembered panel on every plain
    // visit to /transactions, which is exactly what the null exists to prevent.
    expect(activityTabFromSearch('')).toBeNull();
    expect(activityTabFromSearch('?tab=')).toBeNull();
    expect(activityTabFromSearch('?tab=overview')).toBeNull();
    expect(activityTabFromSearch('?other=budget')).toBeNull();
  });

  it('keeps the two values already in localStorage working untouched', () => {
    // Every user who has opened this page has 'planning' or 'bank' stored under
    // `tre:transactions:tab`. Adding a third panel must not invalidate either.
    expect(effectiveActivityTab('planning')).toBe('planning');
    expect(effectiveActivityTab('bank')).toBe('bank');
  });

  it('heals a value it does not recognise to the planning panel', () => {
    // Would-fail: returning the stored string unchanged renders NO panel — a blank surface with no
    // error, for a user with no way to see why.
    expect(effectiveActivityTab('networth')).toBe('planning');
    expect(effectiveActivityTab('')).toBe('planning');
    expect(effectiveActivityTab(null)).toBe('planning');
    expect(effectiveActivityTab(undefined)).toBe('planning');
  });

  it('keeps the other surfaces\u2019 vocabularies out of its own', () => {
    expect(isActivityTab('budget')).toBe(true);
    expect(isActivityTab('overview')).toBe(false);
    expect(isActivityTab('accounts')).toBe(false);
    expect(isActivityTab('balances')).toBe(false);
    expect(isActivityTab('builds')).toBe(false);
    expect(isActivityTab(null)).toBe(false);
  });
});
