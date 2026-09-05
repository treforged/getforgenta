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
  answerWith: 'token' as 'token' | 'error' | 'silence' | 'empty',
  saved: [] as unknown[],
  revoked: [] as string[],
  /** Outcomes the fake store was told to record, so each path can be pinned to a NAMED reason. */
  recorded: [] as { outcome: string; platform: string; prompted: boolean; build?: string | null; detail?: string | null }[],
  /** Makes `saveToken` report failure — a real token minted and then lost to a backend error. */
  saveFails: false,
  /** Listener events attached, in order, and whether `register()` beat them. */
  attached: [] as string[],
  removed: [] as string[],
  registerCalledBeforeListeners: false,
}));

// ⚠️ THE BUILD NUMBER IS PART OF THE DIAGNOSIS NOW. 29 `timeout` rows on a real iPhone could not
// be attributed to a binary, so "682 is installed and still fails" and "these are more 676
// attempts" were the same row. Every case below asserts the build travelled with the outcome.
vi.mock('@capacitor/app', () => ({
  App: { getInfo: async () => ({ version: '6.6', build: '682', name: 'Forgenta', id: 'com.treforged.forged' }) },
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
      // ⚠️ ATTACHMENT IS ASYNCHRONOUS, WHICH IS THE WHOLE BUG. The real plugin returns a Promise
      // and registers the native listener on a later tick. Resolving immediately would hide the
      // race that cost 31 registration attempts, so this deliberately defers.
      addListener: async (event: string, cb: (p: unknown) => void) => {
        await new Promise(r => setTimeout(r, 0));
        (listeners[event] ??= []).push(cb);
        h.attached.push(event);
        return { remove: async () => { h.removed.push(event); } };
      },
      register: async () => {
        h.registerCalls += 1;
        // The assertion that matters: were BOTH listeners already attached when the OS was asked?
        if (h.attached.length < 2) h.registerCalledBeforeListeners = true;
        // The real plugin answers on an EVENT, asynchronously, after register() resolves.
        queueMicrotask(() => {
          if (h.answerWith === 'token') h.emit?.('registration', { value: 'apns-token-abc' });
          if (h.answerWith === 'error') h.emit?.('registrationError', { error: 'no' });
          // Granted, the event fired, and the token came back empty: a PLATFORM problem, and a
          // different one from a timeout or a refusal.
          if (h.answerWith === 'empty') h.emit?.('registration', { value: '' });
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
  saveToken: async (row) => { h.saved.push(row); return !h.saveFails; },
  revokeToken: async (token) => { h.revoked.push(token); },
  recordOutcome: async (outcome, platform, prompted, app, detail) => {
    h.recorded.push({ outcome, platform, prompted, build: app?.build ?? null, detail: detail ?? null });
  },
};

describe('push registration', () => {
  beforeEach(() => {
    h.native = true; h.platform = 'ios';
    h.permission = 'granted'; h.initialPermission = 'prompt';
    h.registerCalls = 0; h.requestCalls = 0;
    h.answerWith = 'token';
    h.saved = []; h.revoked = []; h.recorded = []; h.saveFails = false;
    h.attached = []; h.removed = []; h.registerCalledBeforeListeners = false;
  });
  afterEach(() => vi.clearAllMocks());

  it('stores the token the OS hands back on its EVENT, not the register() return', async () => {
    const { outcome, token } = await registerForPush(store, { prompt: true });
    expect(outcome).toBe('registered');
    expect(token).toBe('apns-token-abc');
    expect(h.saved).toEqual([
      { platform: 'ios', token: 'apns-token-abc', environment: 'sandbox' },
    ]);
    expect(h.recorded).toEqual([{ outcome: 'registered', platform: 'ios', prompted: true, build: '682', detail: null }]);
  });

  it('stores NOTHING and asks for nothing when the person already declined', async () => {
    h.initialPermission = 'denied';
    const { outcome } = await registerForPush(store);

    expect(outcome).toBe('denied');
    expect(h.saved).toEqual([]);
    // Asking again from a launch loop is how a permission prompt gets permanently denied.
    expect(h.requestCalls).toBe(0);
    expect(h.registerCalls).toBe(0);
  });

  it('stores nothing when the person declines the prompt now', async () => {
    // Reaching the prompt at all now requires being invited to ask.
    h.permission = 'denied';
    expect((await registerForPush(store)).outcome).toBe('undecided_not_asked');
    expect(h.saved).toEqual([]);
  });

  it('stores nothing when the provider answers with an error', async () => {
    h.answerWith = 'error';
    // ⚠️ `registration_error` IS THE BUCKET THE MISSING `aps-environment` ENTITLEMENT LANDS IN.
    // Until 2026-09-05 `App.entitlements` had no `aps-environment` key at all, so iOS refused to
    // register and no token was ever minted — and this outcome was indistinguishable from a user
    // who had simply never been asked. That is why it is named rather than `null`: one is a build
    // problem and the other is a product decision.
    expect((await registerForPush(store, { prompt: true })).outcome).toBe('registration_error');
    expect(h.saved).toEqual([]);
  });

  it('gives up rather than hanging when nothing ever answers', async () => {
    vi.useFakeTimers();
    h.answerWith = 'silence';
    const pending = registerForPush(store, { prompt: true });
    await vi.advanceTimersByTimeAsync(11_000);
    // A network problem, NOT a build problem and NOT a declined user.
    expect((await pending).outcome).toBe('timeout');
    expect(h.saved).toEqual([]);
    vi.useRealTimers();
  });

  /**
   * ⚠️ THE ONE-SHOT PROMPT, AND WHO IS ALLOWED TO SPEND IT.
   *
   * On iOS the system notification prompt can be presented ONCE. Declined, the app can never ask
   * again — the person has to find it in Settings, which nobody does. So a prompt shown before
   * the user has any reason to say yes is not merely ineffective, it is SPENT, and every new user
   * who taps "Don't Allow" there is permanently unreachable by a notification.
   *
   * `AuthContext` calls this on sign-in. These pin that the sign-in path CANNOT ask.
   */
  it('⚠️ does NOT ask on the sign-in path — the one-shot prompt is left unspent', async () => {
    h.initialPermission = 'prompt';
    const { outcome } = await registerForPush(store);  // no options: this is the sign-in call
    expect(h.requestCalls).toBe(0);                    // the assertion that matters
    expect(outcome).toBe('undecided_not_asked');
    // ⚠️ AND IT IS RECORDED AS NOT-ASKED, not as a failure. This is the row that tells a product
    // question ("nobody has opened the switch") apart from a bug ("everybody tried and it broke"),
    // which is the whole reason the outcome type exists.
    expect(h.recorded).toEqual([
      { outcome: 'undecided_not_asked', platform: 'ios', prompted: false, build: '682', detail: null },
    ]);
    expect(h.registerCalls).toBe(0);
    expect(h.saved).toEqual([]);
  });

  it('DOES ask when the user turns notifications on, which is the whole point', async () => {
    h.initialPermission = 'prompt';
    h.permission = 'granted';
    const { outcome, token } = await registerForPush(store, { prompt: true });
    expect(h.requestCalls).toBe(1);
    expect(outcome).toBe('registered');
    expect(token).toBe('apns-token-abc');
  });

  it('still registers on sign-in for a device that ALREADY granted — without asking again', async () => {
    // The silent path has to keep working, or declining to prompt would cost every existing user
    // their token on the next launch.
    h.initialPermission = 'granted';
    const { outcome, token } = await registerForPush(store);
    expect(h.requestCalls).toBe(0);
    expect(outcome).toBe('registered');
    expect(token).toBe('apns-token-abc');
    expect(h.saved).toHaveLength(1);
  });

  it('never re-asks somebody who declined, even at the intent moment', async () => {
    // iOS would show nothing anyway; asking is pointless and the answer stands.
    h.initialPermission = 'denied';
    expect((await registerForPush(store, { prompt: true })).outcome).toBe('denied');
    expect(h.requestCalls).toBe(0);
  });

  it('⚠️ ATTACHES BOTH LISTENERS BEFORE asking the OS to register', async () => {
    // THE BUG THAT COST 31 ATTEMPTS. `addListener` returns a Promise; the old code `void`-ed both
    // calls and called `register()` in the same tick, so APNs could answer before either listener
    // existed. The token fired into nothing and the timeout won — recorded as `timeout`, which is
    // indistinguishable from APNs never replying, which is why three entitlement fixes moved
    // nothing.
    await registerForPush(store, { prompt: true });
    expect(h.registerCalledBeforeListeners).toBe(false);
    expect(h.attached).toEqual(['registration', 'registrationError']);
  });

  it('removes both listeners afterwards, rather than leaking one per attempt', async () => {
    // 31 attempts previously left 62 live listeners on one device.
    await registerForPush(store, { prompt: true });
    expect(h.removed.sort()).toEqual(['registration', 'registrationError']);
  });

  it('⚠️ KEEPS the provider error text instead of discarding it', async () => {
    // A real APNs refusal used to be recorded as a bare failure with no message. Apple's string
    // usually names the cause outright.
    h.answerWith = 'error';
    const { outcome } = await registerForPush(store, { prompt: true });
    expect(outcome).toBe('registration_error');
    expect(h.recorded[0].detail).toBe('no');
  });

  it('does nothing at all on web', async () => {
    h.native = false;
    const { outcome } = await registerForPush(store, { prompt: true });
    expect(outcome).toBe('web');
    expect(h.registerCalls).toBe(0);
    expect(h.saved).toEqual([]);
    // ⚠️ AND RECORDS NOTHING. A row per browser session would drown the one number this is for,
    // and there is no OS here to have failed.
    expect(h.recorded).toEqual([]);
  });

  it('⚠️ calls a token that failed to SAVE a failure — it used to look identical to success', async () => {
    // The worst of the outcomes: a real, reachable device minted a real token, the write lost it,
    // and `saveToken` returning `void` meant `registerForPush` reported it exactly like a
    // registered device. The person is then counted unreachable forever with nothing red anywhere.
    h.saveFails = true;
    const { outcome, token } = await registerForPush(store, { prompt: true });
    expect(outcome).toBe('save_failed');
    // The token is still handed back: it is real, and losing it here too would help nobody.
    expect(token).toBe('apns-token-abc');
    expect(h.recorded).toEqual([{ outcome: 'save_failed', platform: 'ios', prompted: true, build: '682', detail: null }]);
  });

  it('records an outcome for every path that reaches the OS, so none can go uncounted', async () => {
    const cases: Array<[() => void, string]> = [
      [() => { h.initialPermission = 'denied'; }, 'denied'],
      [() => { h.answerWith = 'error'; }, 'registration_error'],
      [() => { h.answerWith = 'empty'; }, 'empty_token'],
      [() => { h.saveFails = true; }, 'save_failed'],
      [() => { /* the happy path */ }, 'registered'],
    ];
    for (const [arrange, expected] of cases) {
      h.initialPermission = 'prompt'; h.permission = 'granted';
      h.answerWith = 'token'; h.saveFails = false; h.recorded = [];
      arrange();
      const { outcome } = await registerForPush(store, { prompt: true });
      expect(outcome).toBe(expected);
      expect(h.recorded).toHaveLength(1);
      expect(h.recorded[0].outcome).toBe(expected);
    }
  });

  it('never lets a failed RECORDING break a registration that worked', async () => {
    // Diagnosing a failure must not become a second way to fail.
    const flaky: PushStore = {
      saveToken: async (row) => { h.saved.push(row); return true; },
      revokeToken: async () => {},
      recordOutcome: async () => { throw new Error('rpc down'); },
    };
    const { outcome, token } = await registerForPush(flaky, { prompt: true });
    expect(outcome).toBe('registered');
    expect(token).toBe('apns-token-abc');
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
      saveToken: async () => true,
      revokeToken: async () => { throw new Error('network gone'); },
      recordOutcome: async () => {},
    };
    // Trapping someone in an account they are trying to leave is far worse than a stale row,
    // which the next failed send retires anyway.
    await expect(revokeCurrentPushToken(throwing, 'apns-token-abc')).resolves.toBeUndefined();
  });
});
