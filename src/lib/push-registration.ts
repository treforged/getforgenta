/**
 * Registering this device to RECEIVE a push, and revoking it on sign-out.
 *
 * ── WHY PUSH AT ALL, WHEN THE APP ALREADY HAS NOTIFICATIONS ──────────────────
 * It does not. Everything shipped today is a LOCAL notification — scheduled ON the device BY
 * the app — so it only ever fires for someone who has already opened it. Measured 2026-09-05:
 * 31 accounts, 2 active in seven days, 23 dormant beyond thirty days. **A local notification
 * cannot reach one of those 23 people.** That is the entire reason this file exists.
 *
 * ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────
 * It carries NO judgement. It does not decide what to send, when, or how often — that is
 * `notification-policy.ts`, which is already transport-agnostic and is called by the SERVER.
 * This is the address book: it obtains a token and stores it, and it stops.
 *
 * ⚠️ DO NOT REUSE `notification-service.ts` FOR THIS. That is the LOCAL transport with the
 * transport baked in — it early-returns off native and calls `LocalNotifications.schedule`
 * directly. Its `ensurePermission()` asks for LOCAL notification permission, which is a
 * DIFFERENT OS prompt and a different API from push.
 *
 * ⚠️ THE REMOTE-URL TRAP, and it will waste a whole build if you miss it.
 * `capacitor.config.ts:8` sets `server.url` to https://getforgenta.com, so the shipped app is a
 * WebView pointed at the LIVE SITE rather than the bundled `dist`. Native plugin calls still
 * work through the bridge — but THIS CODE MUST BE IN THE DEPLOYED WEB BUILD. A native rebuild
 * without a matching web deploy registers nothing, produces no tokens, and reports no error.
 */
import { Capacitor } from '@capacitor/core';

/** The two pools APNs keeps, which are not interchangeable. See the note in `resolveEnvironment`. */
export type PushEnvironment = 'sandbox' | 'production';

export interface DeviceTokenRow {
  platform: 'ios' | 'android';
  token: string;
  environment: PushEnvironment;
}

/**
 * The minimum a caller must give us to store a row. Passed in rather than imported so this
 * module has no dependency on the Supabase client and can be exercised without one.
 */
export interface PushStore {
  saveToken(row: DeviceTokenRow): Promise<void>;
  revokeToken(token: string): Promise<void>;
}

/**
 * Which APNs pool this build's tokens belong to.
 *
 * ⚠️ APNs SANDBOX AND PRODUCTION ARE SEPARATE POOLS AND A TOKEN FROM ONE IS SILENTLY REJECTED
 * BY THE OTHER. Not an error the user sees, and not one the sender can tell apart from a dead
 * device — the notification simply never arrives. A TestFlight build and an App Store build of
 * the same binary mint tokens that are not interchangeable, which is why the environment is
 * stored with the token rather than inferred later from a deploy flag.
 *
 * Derived from the build mode, because that is the only thing the JS layer can actually see:
 * a development or TestFlight build runs the dev bundle, a store build runs the production one.
 * If that ever stops being true, this is the function to fix, and the token rows will say so —
 * sends to one environment failing while the other works is exactly the shape of that bug.
 */
export function resolveEnvironment(isProductionBuild: boolean): PushEnvironment {
  return isProductionBuild ? 'production' : 'sandbox';
}

/** Android has no such split. Kept explicit so nobody "fixes" the ios-only reasoning above. */
export function environmentFor(
  platform: 'ios' | 'android',
  isProductionBuild: boolean,
): PushEnvironment {
  return platform === 'android' ? 'production' : resolveEnvironment(isProductionBuild);
}

/**
 * Ask for permission, register with the OS, and store whatever token comes back.
 *
 * Returns the token on success and null on every other path — declined, not native, or the
 * plugin failed. **Null is not an error worth surfacing to the user.** Someone who says no to
 * notifications has answered the question, and asking again from a catch block is how an app
 * gets its permission prompt permanently denied.
 *
 * ⚠️ ONLY CALL THIS AFTER SIGN-IN. A token with no user_id is a row we cannot address and a
 * prompt the person has not yet been given a reason for. The caller is AuthContext, beside the
 * RevenueCat call, on both SIGNED_IN and INITIAL_SESSION — the second of which is the one that
 * fires for a returning user and the one that was missed for RevenueCat until 2026-09-05.
 */
export async function registerForPush(store: PushStore): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // `checkPermissions` first: `requestPermissions` on an already-decided device re-presents
    // nothing on iOS but does return the standing answer, and asking a person who declined is
    // not something to do on every launch.
    const current = await PushNotifications.checkPermissions();
    const status = current.receive === 'prompt' || current.receive === 'prompt-with-rationale'
      ? (await PushNotifications.requestPermissions()).receive
      : current.receive;
    if (status !== 'granted') return null;

    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    const environment = environmentFor(platform, import.meta.env.PROD);

    // The token arrives on an EVENT, not as a return value — `register()` resolves as soon as
    // the request is made, long before APNs or FCM has answered. Anything that awaited
    // `register()` and then read a token would read nothing, every time.
    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      // Nothing may wait forever: a device with no network answers neither listener.
      const timer = setTimeout(() => finish(null), REGISTRATION_TIMEOUT_MS);

      void PushNotifications.addListener('registration', ({ value }) => {
        clearTimeout(timer);
        finish(value ?? null);
      });
      void PushNotifications.addListener('registrationError', () => {
        clearTimeout(timer);
        finish(null);
      });

      void PushNotifications.register();
    });

    if (!token) return null;
    await store.saveToken({ platform, token, environment });
    return token;
  } catch {
    // A failure to register is not a failure of the app. Swallowed on purpose, and it stays
    // swallowed: the alternative is a toast about notifications while somebody is trying to
    // look at their money.
    return null;
  }
}

/** How long to wait for APNs or FCM to answer before giving up on this launch. */
export const REGISTRATION_TIMEOUT_MS = 10_000;

/**
 * Mark this device's token revoked on sign-out.
 *
 * ⚠️ REVOKED, NOT DELETED, and the row keeps its history. Deleting it would make "this person
 * never had a device" and "this person had one and signed out" look identical, and the second
 * is the number that says whether registration is working at all.
 *
 * Best effort by design. A sign-out that fails because a token write failed would trap someone
 * in an account they are trying to leave, which is a far worse outcome than a stale row that
 * the next send will fail against and retire anyway.
 */
export async function revokeCurrentPushToken(
  store: PushStore,
  token: string | null,
): Promise<void> {
  if (!Capacitor.isNativePlatform() || !token) return;
  try {
    await store.revokeToken(token);
  } catch {
    // See above.
  }
}
