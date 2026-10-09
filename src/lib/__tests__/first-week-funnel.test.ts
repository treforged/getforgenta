// @vitest-environment jsdom
// First-week funnel (proposal G). The Supabase client is MOCKED here, and test-setup.ts refuses any
// *.supabase.co request on top of that (the 424e555b fix: tests once wrote funnel rows to
// production on every run). Would-fail checks: count "came back" on the signup day and "not on the
// signup day" fails; drop the marker and "once per account per device" fails; attach the user id
// to the row and "no account id leaves" fails; count by milliseconds and the DST case fails.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { insertMock, fromMock, optOut, loadConsentMock } = vi.hoisted(() => {
  const insertMock = vi.fn();
  return { insertMock, fromMock: vi.fn(() => ({ insert: insertMock })), optOut: vi.fn(), loadConsentMock: vi.fn() };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: fromMock } }));
vi.mock('@/lib/analytics', () => ({ hasTrackingOptOutSignal: optOut }));
vi.mock('@/lib/consent-prefs', () => ({ loadConsent: loadConsentMock }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

import { firstWeekDay, recordFirstWeekStep } from '../first-week-funnel';
import { __resetFunnelForTests } from '../signup-funnel';
import { blockedSupabaseRequests } from '@/test-setup';

const USER = { id: '11111111-2222-4333-8444-555555555555', created_at: '' };
// Local times, so the expectations hold in every zone test:tz runs.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

beforeEach(() => {
  localStorage.clear();
  fromMock.mockClear();
  insertMock.mockReset().mockResolvedValue({ error: null });
  optOut.mockReturnValue(false);
  loadConsentMock.mockReturnValue(null);
  __resetFunnelForTests();
  USER.created_at = at(2026, 10, 5, 9).toISOString();
});

describe('firstWeekDay', () => {
  it('counts local calendar days, 0 to 6, and null outside', () => {
    const c = at(2026, 10, 5, 23).toISOString();
    expect(firstWeekDay(c, at(2026, 10, 5, 23, ))).toBe(0);
    expect(firstWeekDay(c, at(2026, 10, 6, 0))).toBe(1);
    expect(firstWeekDay(c, at(2026, 10, 11, 20))).toBe(6);
    expect(firstWeekDay(c, at(2026, 10, 12, 1))).toBeNull();
    expect(firstWeekDay(c, at(2026, 10, 4, 12))).toBeNull();
    expect(firstWeekDay(undefined, at(2026, 10, 5))).toBeNull();
    expect(firstWeekDay('garbage', at(2026, 10, 5))).toBeNull();
  });

  it('is not thrown by a DST change (a 23- or 25-hour day)', () => {
    expect(firstWeekDay(at(2026, 10, 31, 23).toISOString(), at(2026, 11, 2, 0))).toBe(2);
    expect(firstWeekDay(at(2026, 3, 7, 23).toISOString(), at(2026, 3, 9, 0))).toBe(2);
  });
});

describe('recordFirstWeekStep', () => {
  it('sends the step with the day, and no account id leaves', () => {
    expect(recordFirstWeekStep('onboarding_finished', USER, { now: at(2026, 10, 5, 10) })).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('signup_funnel_events');
    const row = insertMock.mock.calls[0][0];
    expect(row).toMatchObject({ step: 'onboarding_finished', detail: 'd0' });
    expect(JSON.stringify(row)).not.toContain(USER.id);
  });

  it('first_transaction names its source', () => {
    recordFirstWeekStep('first_transaction', USER, { source: 'manual', now: at(2026, 10, 6) });
    expect(insertMock.mock.calls[0][0]).toMatchObject({ step: 'first_transaction', detail: 'manual_d1' });
  });

  it('once per account per device, even across page loads', () => {
    recordFirstWeekStep('first_transaction', USER, { source: 'manual', now: at(2026, 10, 6) });
    __resetFunnelForTests(); // a new page load clears the in-memory dedupe, not the marker
    expect(recordFirstWeekStep('first_transaction', USER, { source: 'bank', now: at(2026, 10, 7) })).toBe(false);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('returned_day2: not on the signup day, yes on a later day', () => {
    expect(recordFirstWeekStep('returned_day2', USER, { now: at(2026, 10, 5, 22) })).toBe(false);
    expect(recordFirstWeekStep('returned_day2', USER, { now: at(2026, 10, 6, 8) })).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ step: 'returned_day2', detail: 'd1' });
  });

  it('nothing after the first week, and nothing without a user', () => {
    expect(recordFirstWeekStep('returned_day2', USER, { now: at(2026, 10, 20) })).toBe(false);
    expect(recordFirstWeekStep('returned_day2', null, { now: at(2026, 10, 6) })).toBe(false);
    expect(recordFirstWeekStep('returned_day2', { id: 'x' }, { now: at(2026, 10, 6) })).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('respects an analytics rejection (inherited from recordFunnelStep)', () => {
    loadConsentMock.mockReturnValue({ analytics: false });
    recordFirstWeekStep('onboarding_finished', USER, { now: at(2026, 10, 5, 10) });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('never reached the network', () => {
    recordFirstWeekStep('onboarding_finished', USER, { now: at(2026, 10, 5, 10) });
    expect(blockedSupabaseRequests).toEqual([]);
  });
});
