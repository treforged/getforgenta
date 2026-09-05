/**
 * PUSH REGISTRATION — the address book, pressed, including every path that must REFUSE.
 *
 * Local notifications cannot reach a dormant user; measured 2026-09-05, 23 of 31 accounts are
 * dormant beyond thirty days. Push is the only thing that can, and none of it works if the
 * token never gets stored. So this file is about the token, not about the message.
 *
 * ⚠️ WHAT THESE CANNOT PROVE, and it is the important half. `notification-service.test.ts:8-9`
 * already states the principle for the local transport and it binds harder here: mocks prove
 * every branch RUNS; they "deliberately do NOT prove that the OS actually displays anything.
 * That needs a device." A green run here means the code asked, listened and stored. It does not
 * mean APNs minted a real token, and it certainly does not mean a banner appeared on a phone.
 * The runbook in docs/push-runbook.md is where that gets proven.
 *
 * Would-fail checks: return the token from `register()` instead of the listener and the
 * happy-path case fails, because `register()` resolves long before APNs answers; drop the
 * granted-check and the declined case stores a token for someone who said no; drop the timeout
 * and the no-answer case hangs rather than failing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  platform: 'ios' as string,
  permission: 'granted' as string,
  /** What checkPermissions reports BEFORE any request. 'prompt' means it will ask. */
  initialPermission: 'prompt' as string,
  registerCalls: 0,
  requestCalls: 0,
  /** Fired to simulate APNs / FCM answering. null means it never answers. */
  emit: null as null | ((event: string, payload: unknown) => void),
  answerWith: 'token' as 'token' | 'error' | 'silence',
  saved: [] as unknown[],
  revoked: [] as string[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.native,
    getPlatform: () => h.platform,
  },
}));

vi.mock('@capacitor/push-notifications', () => {
  const listeners: Record<string, ((p: unknown) => void)[]> = {};
  h.emit = (event, payload) => { (listeners[event] ?? []).forEach(cb => cb(payload)); };
  return {
    PushNotifications: {
      checkPermissions: async () => ({ receive: h.initialPermission }),
      requestPermissions: async () => { h.requestCalls += 1; return { receive: h.permission }; },
      addListener: async (event: string, cb: (p: unknown) => void) => {
        (listeners[event] ??= []).push(cb);
        return { remove: () => {} };
      },
      register: async () => {
        h.registerCalls += 1;
        // The real plugin answers on an EVENT, asynchronously, after register() resolves.
        queueMicrotask(() => {
          if (h.answerWith === 'token') h.emit?.('registration', { value: 'apns-token-abc' });
          if (h.answerWith === 'error') h.emit?.('registrationError', { error: 'no' });
        });
      },
    },
  };
});

import {
  registerForPush, revokeCurrentPushToken, environmentFor, resolveEnvironment,
  type PushStore,
} from '@/lib/push-registration';

const store: PushStore = {
  saveToken: async (row) => { h.saved.push(row); },
  revokeToken: async (token) => { h.revoked.push(token); },
};

describe('push registration', () => {
  beforeEach(() => {
    h.native = true; h.platform = 'ios';
    h.permission = 'granted'; h.initialPermission = 'prompt';
    h.registerCalls = 0; h.requestCalls = 0;
    h.answerWith = 'token';
    h.saved = []; h.revoked = [];
  });
  afterEach(() => vi.clearAllMocks());

  it('stores the token the OS hands back on its EVENT, not the register() return', async () => {
    const token = await registerForPush(store);
    expect(token).toBe('apns-token-abc');
    expect(h.saved).toEqual([
      { platform: 'ios', token: 'apns-token-abc', environment: 'sandbox' },
    ]);
  });

  it('stores NOTHING and asks for nothing when the person already declined', async () => {
    h.initialPermission = 'denied';
    const token = await registerForPush(store);

    expect(token).toBeNull();
    expect(h.saved).toEqual([]);
    // Asking again from a launch loop is how a permission prompt gets permanently denied.
    expect(h.requestCalls).toBe(0);
    expect(h.registerCalls).toBe(0);
  });

  it('stores nothing when the person declines the prompt now', async () => {
    h.permission = 'denied';
    expect(await registerForPush(store)).toBeNull();
    expect(h.saved).toEqual([]);
  });

  it('stores nothing when the provider answers with an error', async () => {
    h.answerWith = 'error';
    expect(await registerForPush(store)).toBeNull();
    expect(h.saved).toEqual([]);
  });

  it('gives up rather than hanging when nothing ever answers', async () => {
    vi.useFakeTimers();
    h.answerWith = 'silence';
    const pending = registerForPush(store);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await pending).toBeNull();
    expect(h.saved).toEqual([]);
    vi.useRealTimers();
  });

  it('does nothing at all on web', async () => {
    h.native = false;
    expect(await registerForPush(store)).toBeNull();
    expect(h.registerCalls).toBe(0);
    expect(h.saved).toEqual([]);
  });
});

describe('APNs environment', () => {
  it('separates the two pools, because a token from one is silently rejected by the other', () => {
    expect(resolveEnvironment(true)).toBe('production');
    expect(resolveEnvironment(false)).toBe('sandbox');
    expect(environmentFor('ios', false)).toBe('sandbox');
    expect(environmentFor('ios', true)).toBe('production');
  });

  it('always calls Android production — FCM has no such split', () => {
    expect(environmentFor('android', false)).toBe('production');
    expect(environmentFor('android', true)).toBe('production');
  });
});

describe('revoking on sign-out', () => {
  beforeEach(() => { h.native = true; h.revoked = []; });

  it('retires this device so the next person here gets no-one else\'s notifications', async () => {
    await revokeCurrentPushToken(store, 'apns-token-abc');
    expect(h.revoked).toEqual(['apns-token-abc']);
  });

  it('does nothing when there is no token to retire', async () => {
    await revokeCurrentPushToken(store, null);
    expect(h.revoked).toEqual([]);
  });

  it('never lets a failed revoke break a sign-out', async () => {
    const throwing: PushStore = {
      saveToken: async () => {},
      revokeToken: async () => { throw new Error('network gone'); },
    };
    // Trapping someone in an account they are trying to leave is far worse than a stale row,
    // which the next failed send retires anyway.
    await expect(revokeCurrentPushToken(throwing, 'apns-token-abc')).resolves.toBeUndefined();
  });
});
