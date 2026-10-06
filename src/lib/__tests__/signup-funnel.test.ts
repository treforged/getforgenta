// @vitest-environment jsdom
// Anonymous sign-in funnel counts (ask 6dbd80d8). The contract that matters: no identifier and no
// error MESSAGE ever leaves (a message can hold an email), and a counting failure never breaks sign-in.
import { describe, it, expect, beforeEach, vi, } from 'vitest';

// Mocks are declared at the top level: vi.mock inside a vi.hoisted callback is not hoisted.
const { insertMock, fromMock, optOut, loadConsentMock, getPlatform } = vi.hoisted(() => {
  const insertMock = vi.fn();
  return {
    insertMock,
    fromMock: vi.fn(() => ({ insert: insertMock })),
    optOut: vi.fn(),
    loadConsentMock: vi.fn(),
    getPlatform: vi.fn(),
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: fromMock } }));
vi.mock('@/lib/analytics', () => ({ hasTrackingOptOutSignal: optOut }));
vi.mock('@/lib/consent-prefs', () => ({ loadConsent: loadConsentMock }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform } }));

import { cancelDetail, recordFunnelStep, toErrorCode, funnelEnv, funnelInstallId, FUNNEL_INSTALL_ID_KEY, __resetFunnelForTests } from '../signup-funnel';

beforeEach(() => {
  fromMock.mockClear();
  insertMock.mockReset().mockResolvedValue({ error: null });
  optOut.mockReturnValue(false);
  loadConsentMock.mockReturnValue(null);
  getPlatform.mockReturnValue('ios');
  __resetFunnelForTests();
});

describe('recordFunnelStep', () => {
  it('tap_store records BOTH stores, once each (ask 4f473837)', () => {
    recordFunnelStep('tap_store', { detail: 'app_store' });
    recordFunnelStep('tap_store', { detail: 'app_store' });
    recordFunnelStep('tap_store', { detail: 'play_store' });
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls.map((c) => c[0].detail)).toEqual(['app_store', 'play_store']);
  });

  it('landing_viewed is counted once per page life', () => {
    recordFunnelStep('landing_viewed');
    recordFunnelStep('landing_viewed');
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0][0]).toMatchObject({ step: 'landing_viewed', detail: '' });
  });

  it('sends a welcome_shown event with defaults', () => {
    recordFunnelStep('welcome_shown');
    expect(fromMock).toHaveBeenCalledOnce();
    expect(fromMock).toHaveBeenCalledWith('signup_funnel_events');
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith({
      step: 'welcome_shown',
      method: '',
      detail: '',
      platform: 'ios',
      // jsdom runs on localhost, so this row is ours, not a visitor's.
      env: 'dev',
      // No analytics choice yet, so no install id.
      install_id: null,
    });
  });

  it('deduplicates identical step+method, but allows different methods', () => {
    recordFunnelStep('tap_email', { method: 'email' });
    recordFunnelStep('tap_email', { method: 'email' });
    recordFunnelStep('tap_email', { method: 'google' });

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      step: 'tap_email',
      method: 'email',
    });
    expect(insertMock.mock.calls[1][0]).toMatchObject({
      step: 'tap_email',
      method: 'google',
    });
  });

  it('limits auth_error to five recordings', () => {
    for (let i = 0; i < 7; i++) {
      recordFunnelStep('auth_error');
    }
    expect(insertMock).toHaveBeenCalledTimes(5);
  });

  it('respects tracking opt-out signal', () => {
    optOut.mockReturnValue(true);
    recordFunnelStep('welcome_shown');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('respects explicit analytics rejection', () => {
    loadConsentMock.mockReturnValue({ analytics: false });
    recordFunnelStep('welcome_shown');
    expect(fromMock).not.toHaveBeenCalled();

    loadConsentMock.mockReturnValue({ analytics: true });
    recordFunnelStep('welcome_shown');
    expect(fromMock).toHaveBeenCalled();
  });

  it('does not throw when insert rejects', async () => {
    insertMock.mockRejectedValue(new Error('network'));
    expect(() => recordFunnelStep('welcome_shown')).not.toThrow();
    expect(insertMock).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
  });

  it('maps unknown platform to empty string', () => {
    getPlatform.mockReturnValue('electron');
    recordFunnelStep('welcome_shown');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: '' })
    );
  });
});

describe('toErrorCode', () => {
  it('extracts code property, sanitises and lowercases', () => {
    expect(toErrorCode({ code: 'Invalid_Credentials' })).toBe('invalid_credentials');
  });

  it('uses Error.name when no code property', () => {
    expect(toErrorCode(new Error('bob@x.com is taken'))).toBe('error');
  });

  it('falls back to unknown for non-object values', () => {
    expect(toErrorCode('x')).toBe('unknown');
  });

  it('replaces illegal characters with underscores', () => {
    expect(toErrorCode({ code: 'a b-c' })).toBe('a_b_c');
  });
});

// 2026-10-01: our own walks wrote 84 sign-ups into the production table in two days while no real
// user signed up. Only the production host may count as a visitor.
describe('funnelEnv', () => {
  it('counts only the production host as a real visitor', () => {
    expect(funnelEnv('getforgenta.com')).toBe('prod');
    expect(funnelEnv('www.getforgenta.com')).toBe('prod');
    expect(funnelEnv('GetForgenta.com')).toBe('prod');
  });

  it('marks localhost, a LAN address and a preview deploy as dev', () => {
    expect(funnelEnv('localhost')).toBe('dev');
    expect(funnelEnv('127.0.0.1')).toBe('dev');
    expect(funnelEnv('192.168.1.20')).toBe('dev');
    expect(funnelEnv('getforgenta-git-main-treforged.vercel.app')).toBe('dev');
    expect(funnelEnv('getforgenta.com.evil.example')).toBe('dev');
  });
});

// Sam approved 2026-10-01: a random per-install id, ONLY under an explicit analytics accept.
describe('funnelInstallId', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  beforeEach(() => localStorage.removeItem(FUNNEL_INSTALL_ID_KEY));

  it('is null and stores nothing before the person has chosen', () => {
    loadConsentMock.mockReturnValue(null);
    expect(funnelInstallId()).toBeNull();
    expect(localStorage.getItem(FUNNEL_INSTALL_ID_KEY)).toBeNull();
  });

  it('after an accept: one random v4 UUID, the same on every row of this install', () => {
    loadConsentMock.mockReturnValue({ analytics: true });
    const a = funnelInstallId();
    expect(a).toMatch(UUID);
    expect(funnelInstallId()).toBe(a);
    recordFunnelStep('welcome_shown');
    expect(insertMock.mock.calls[0][0]).toMatchObject({ install_id: a });
  });

  it('a rejection, or a GPC/DNT signal, deletes a stored id', () => {
    loadConsentMock.mockReturnValue({ analytics: true });
    expect(funnelInstallId()).not.toBeNull();
    loadConsentMock.mockReturnValue({ analytics: false });
    expect(funnelInstallId()).toBeNull();
    expect(localStorage.getItem(FUNNEL_INSTALL_ID_KEY)).toBeNull();
    loadConsentMock.mockReturnValue({ analytics: true });
    funnelInstallId();
    optOut.mockReturnValue(true);
    expect(funnelInstallId()).toBeNull();
    expect(localStorage.getItem(FUNNEL_INSTALL_ID_KEY)).toBeNull();
  });

  it('replaces a tampered stored value instead of sending it', () => {
    loadConsentMock.mockReturnValue({ analytics: true });
    localStorage.setItem(FUNNEL_INSTALL_ID_KEY, 'tre@example.com');
    const id = funnelInstallId();
    expect(id).toMatch(UUID);
    expect(localStorage.getItem(FUNNEL_INSTALL_ID_KEY)).toBe(id);
  });
});

describe('cancelDetail', () => {
  it('buckets the on-phone time a sign-in sheet was open before it said cancelled', () => {
    expect(cancelDetail(240)).toBe('user_cancelled_lt1s');
    expect(cancelDetail(999)).toBe('user_cancelled_lt1s');
    expect(cancelDetail(1000)).toBe('user_cancelled_1to5s');
    expect(cancelDetail(4999)).toBe('user_cancelled_1to5s');
    expect(cancelDetail(5000)).toBe('user_cancelled_gt5s');
  });
  it('falls back to the plain code for a clock that went backwards or is not a number', () => {
    expect(cancelDetail(-5)).toBe('user_cancelled');
    expect(cancelDetail(Number.NaN)).toBe('user_cancelled');
  });
  it('fits the database check on detail: [a-z0-9_]{0,40}', () => {
    for (const ms of [0, 2000, 60000]) expect(cancelDetail(ms)).toMatch(/^[a-z0-9_]{0,40}$/);
  });
});
