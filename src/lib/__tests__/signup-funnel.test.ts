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

import { recordFunnelStep, toErrorCode, __resetFunnelForTests } from '../signup-funnel';

beforeEach(() => {
  fromMock.mockClear();
  insertMock.mockReset().mockResolvedValue({ error: null });
  optOut.mockReturnValue(false);
  loadConsentMock.mockReturnValue(null);
  getPlatform.mockReturnValue('ios');
  __resetFunnelForTests();
});

describe('recordFunnelStep', () => {
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
