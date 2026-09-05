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
  /** `true` when the row actually landed. ⚠️ NOT `void`: a token that is minted and then lost to
   *  a failed write is the worst of the nine outcomes — a real, reachable device recorded as
   *  unreachable — and a `void` return made it indistinguishable from success. */
  saveToken(row: DeviceTokenRow): Promise<boolean>;
  revokeToken(token: string): Promise<void>;
  /**
    * Best effort, never throws. See `PushRegistrationOutcome`.
    *
    * ⚠️ `build` IS NOT OPTIONAL DECORATION — IT IS THE FIELD WHOSE ABSENCE MADE 29 ROWS USELESS.
    * On 2026-09-05 Tre's iPhone recorded 29 `timeout` attempts across two builds, and the row
    * could not say which binary produced them. "682 is installed and still fails" and "these are
    * more 676 attempts" were the SAME ROW and needed opposite fixes. A diagnostic that cannot
    * attribute its own measurement is one field short of useful.
    */
  recordOutcome(
    outcome: PushRegistrationOutcome,
    platform: 'ios' | 'android',
    prompted: boolean,
    app: { version: string | null; build: string | null },
    /** The provider's own error text, when there is one. Never invented. */
    detail?: string | null,
  ): Promise<void>;
}

/**
 * WHY A PERSON HAS NO DEVICE TOKEN.
 *
 * ⚠️ THIS TYPE EXISTS BECAUSE `registerForPush` USED TO RETURN `null` FOR ALL OF IT. Measured
 * 2026-09-05: the sender reported `candidates: 48, sent: 0, unreachable: 48` — forty-eight people
 * it would have notified, none reachable — and nothing in the system could say which of these it
 * was. "Nobody has ever been asked" and "everybody was asked and it failed" produced the same
 * empty table and need opposite fixes: one is a product decision, the other is a bug hunt.
 *
 * Each value names a different owner:
 *   registered           it worked
 *   undecided_not_asked  the notification switch was never opened — PRODUCT, not a bug
 *   denied               they said no; leave them alone
 *   timeout              APNs/FCM did not answer inside REGISTRATION_TIMEOUT_MS — NETWORK
 *   registration_error   the OS refused — BUILD (entitlements, google-services.json, provisioning)
 *   empty_token          granted, the event fired, the token was empty — PLATFORM
 *   save_failed          a real token was minted and the write lost it — BACKEND, and the worst
 *   plugin_error         the plugin threw — PACKAGING
 */
export type PushRegistrationOutcome =
  | 'registered'
  | 'undecided_not_asked'
  | 'denied'
  | 'timeout'
  | 'registration_error'
  | 'empty_token'
  | 'save_failed'
  | 'plugin_error';

/** What `registerForPush` answers. `token` is non-null only when `outcome` is `registered`. */
export interface PushRegistrationResult {
  outcome: PushRegistrationOutcome | 'web';
  token: string | null;
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
 * ⚠️ ONLY CALL THIS AFTER SIGN-IN. A token with no user_id is a row we cannot address.
 *
 * ⚠️⚠️ AND IT DOES NOT ASK BY DEFAULT. `prompt` defaults to FALSE, so the ordinary sign-in call
 * registers a device that has ALREADY granted permission and shows nothing to anybody else.
 *
 * THE ONE-SHOT PROBLEM. On iOS the system notification prompt can be presented ONCE. Decline it
 * and the app cannot ask again — the person has to find it in Settings, which nobody does. So a
 * prompt shown at the wrong moment is not merely ineffective, it is SPENT, and the app cannot
 * tell that it was wasted. `src/lib/review-moment.ts` documents exactly this constraint for the
 * review prompt and draws exactly this conclusion; this is the same rule for the same reason.
 *
 * WHAT IT USED TO DO: `AuthContext` called this on sign-in and it asked immediately, so the OS
 * prompt appeared seconds after somebody first got into the app — before a single notification-
 * worthy thing had happened and before they had any reason to say yes. Every new user who tapped
 * "Don't Allow" in that moment could never be reached by a notification again.
 *
 * WHEN TO PASS `prompt: true`: at the first NOTIFICATION-SHAPED INTENT — the user turning
 * notifications on. That is `NotificationSettings`' master switch today. Do not add it to a
 * launch path, a sign-in path, or anything that runs without the user having asked for alerts.
 */
export async function registerForPush(
  store: PushStore,
  options: { prompt?: boolean } = {},
): Promise<PushRegistrationResult> {
  // Web is not a failure and is not recorded: there is no OS to register with, and writing a row
  // for every browser session would drown the one number this is for.
  if (!Capacitor.isNativePlatform()) return { outcome: 'web', token: null };

  const prompted = options.prompt === true;
  /** The OS's own answer, carried into whatever outcome is recorded. Null until it is read. */
  let permissionReading: string | null = null;
  let platform: 'ios' | 'android' = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

  /**
   * The binary that is running, so every recorded outcome names the build behind it.
   *
   * Read lazily and never allowed to throw: on a device where `App.getInfo()` is unavailable this
   * must degrade to "unknown build", not to "no diagnosis at all".
   */
  const appInfo = async (): Promise<{ version: string | null; build: string | null }> => {
    try {
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      return { version: info.version ?? null, build: info.build ?? null };
    } catch {
      return { version: null, build: null };
    }
  };

  /** Record and return in one step, so no branch below can forget the recording half. */
  const done = async (
    outcome: PushRegistrationOutcome,
    token: string | null = null,
    detail: string | null = null,
  ): Promise<PushRegistrationResult> => {
    const app = await appInfo();
    // An error's own text wins; otherwise carry the permission reading, so a `timeout` row still
    // says what iOS reported rather than leaving us to infer it a thirty-seventh time.
    const recordedDetail = detail ?? permissionReading;
    await store.recordOutcome(outcome, platform, prompted, app, recordedDetail).catch(() => {
      // The diagnosis failing must never take the registration with it.
    });
    return { outcome, token };
  };

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // `checkPermissions` first: `requestPermissions` on an already-decided device re-presents
    // nothing on iOS but does return the standing answer, and asking a person who declined is
    // not something to do on every launch.
    const current = await PushNotifications.checkPermissions();
    // ⚠️ WHAT iOS ACTUALLY SAID, RECORDED RATHER THAN INFERRED. `prompted: false` has been read as
    // "permission was already granted" for 36 attempts — but that is OUR INFERENCE from which
    // branch ran, not a reading. If `receive` is anything other than `granted`, `register()`
    // no-ops quietly and we have been reading our own assumption back. Same class as every other
    // confident blank found today: a field inferred instead of measured.
    permissionReading = `permission=${current.receive}`;   // provisional; refined once asked
    const undecided = current.receive === 'prompt' || current.receive === 'prompt-with-rationale';
    // Undecided AND not invited to ask: leave the one-shot prompt unspent and register nothing.
    // The device is not lost — the next time the user turns notifications on, this runs with
    // `prompt: true` and asks then, which is the moment they have a reason to say yes.
    if (undecided && !options.prompt) return done('undecided_not_asked');
    const status = undecided
      ? (await PushNotifications.requestPermissions()).receive
      : current.receive;
    // ⚠️ THE EFFECTIVE STATUS IS WHAT GATES `register()`, so that is what the row must carry. The
    // pre-request value is kept alongside it when they differ, because "was prompt, now granted"
    // and "was granted all along" are different stories about the same device.
    permissionReading = current.receive === status
      ? `permission=${status}`
      : `permission=${current.receive}->${status}`;
    if (status !== 'granted') return done('denied');

    platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    const environment = environmentFor(platform, import.meta.env.PROD);

    // The token arrives on an EVENT, not as a return value — `register()` resolves as soon as
    // the request is made, long before APNs or FCM has answered. Anything that awaited
    // `register()` and then read a token would read nothing, every time.
    // ⚠️ THE THREE WAYS THIS ENDS ARE NOT THE SAME and used to collapse into one `null`: a
    // timeout is a network problem, a `registrationError` is a build problem, and an empty token
    // on a successful event is a platform problem. They are carried out separately.
    // ⚠️ THE LISTENERS ARE AWAITED BEFORE `register()`. THIS IS THE BUG THAT COST 31 ATTEMPTS.
    //
    // `PushNotifications.addListener()` returns a **Promise**, and this code used to `void` both
    // calls and then call `register()` SYNCHRONOUSLY in the same tick. Capacitor attaches the
    // native listener asynchronously, so `register()` could reach the OS — and APNs could answer —
    // **before either listener existed**. The token fired into nothing, the timeout won, and the
    // outcome was recorded as `timeout`: indistinguishable from APNs never replying at all.
    //
    // Measured on Tre's iPhone: 31 attempts between 17:33Z and 20:11Z, every one `timeout`, across
    // three different builds. The entitlement fixes (`aps-environment` absent, then `development`
    // instead of `production`) were both real and both irrelevant to THIS path, which is why no
    // config change ever moved the number.
    //
    // Awaiting the handles is the whole fix. It also gives us something to REMOVE, which the
    // previous version never had — see below.
    // The handlers are declared first and assigned inside the promise below, so the listeners can
    // be ATTACHED (and awaited) before anything is asked of the OS.
    let onToken: (v: string | null) => void = () => {};
    let onError: (e: unknown) => void = () => {};

    const registrationHandle = await PushNotifications.addListener(
      'registration', ({ value }) => onToken(value ?? null),
    );
    const errorHandle = await PushNotifications.addListener(
      'registrationError', (err) => onError(err),
    );

    const settledAs = await new Promise<{ how: 'token' | 'timeout' | 'error'; value: string | null; detail: string | null }>(
      (resolve) => {
        let settled = false;
        const finish = (how: 'token' | 'timeout' | 'error', value: string | null, detail: string | null = null) => {
          if (settled) return;
          settled = true;
          resolve({ how, value, detail });
        };

        // Nothing may wait forever: a device with no network answers neither listener.
        const timer = setTimeout(() => finish('timeout', null), REGISTRATION_TIMEOUT_MS);

        onToken = (value) => { clearTimeout(timer); finish('token', value); };
        // ⚠️ THE ERROR TEXT IS KEPT NOW. It used to be discarded — `finish('error', null)` — so a
        // real APNs refusal was recorded as a bare `registration_error` with no message. Apple's
        // string usually names the cause outright, and a day was spent inferring what it would
        // have said. Whatever arrives is stringified defensively; this must not throw.
        onError = (err) => {
          clearTimeout(timer);
          const describe = (): string | null => {
            try {
              const e = err as { error?: unknown; message?: unknown } | null;
              return String(e?.error ?? e?.message ?? JSON.stringify(err) ?? '').slice(0, 300) || null;
            } catch {
              // A payload that cannot even be stringified is still worth SAYING, rather than
              // becoming another silent null.
              return 'unstringifiable registrationError payload';
            }
          };
          finish('error', null, describe());
        };

        void PushNotifications.register();
      },
    );

    // ⚠️ ON A TIMEOUT THE `registration` LISTENER STAYS ALIVE. THIS IS THE POINT OF THE WHOLE FIX.
    //
    // A timeout that STOPS LISTENING is worse than no timeout at all: if APNs answers at twelve
    // seconds and we stopped at ten, **a working token is thrown away** and `timeout` is written —
    // which looks identical, on every attempt, for ever, no matter how many times the app is
    // opened. A first registration on a cold app, on cellular, is exactly when APNs is slowest.
    //
    // Worse, THIS CODE CAUSED THAT. The removal below was added earlier today to stop a listener
    // leak (31 attempts had left 62 live listeners), and stopping the leak also stopped late
    // tokens being heard at all. Fixing one bug introduced another with the same signature.
    //
    // So the error listener goes — an error after we stopped waiting tells us nothing new — and
    // the token listener SURVIVES, saving whatever arrives whenever it arrives and recording the
    // outcome as `registered`. `timeout` therefore means "no answer YET", a provisional state that
    // a later token overwrites, rather than "we gave up".
    await errorHandle.remove().catch(() => {});

    if (settledAs.how !== 'token') {
      // Re-point the token handler at the late path before returning. The promise is settled, so
      // the original `onToken` is a no-op from here.
      onToken = (value) => {
        void (async () => {
          // Remove first: whatever happens next, this listener has done its one job.
          await registrationHandle.remove().catch(() => {});
          if (!value) return;
          const saved = await store.saveToken({ platform, token: value, environment })
            .catch(() => false);
          const app = await appInfo();
          await store
            .recordOutcome(saved ? 'registered' : 'save_failed', platform, prompted, app,
              `${permissionReading ?? ''} late=${LATE_TOKEN_NOTE}`.trim())
            .catch(() => {});
        })();
      };
    } else {
      await registrationHandle.remove().catch(() => {});
    }

    if (settledAs.how === 'timeout') return done('timeout');
    if (settledAs.how === 'error') return done('registration_error', null, settledAs.detail);
    if (!settledAs.value) return done('empty_token');

    const token = settledAs.value;
    // ⚠️ A FAILED WRITE IS NOT A SUCCESS. `saveToken` used to return `void` and log to the
    // console, so a real token lost to a backend error was reported exactly like a registered
    // one — a reachable device counted as unreachable, forever, with nothing red.
    const saved = await store.saveToken({ platform, token, environment });
    if (!saved) return done('save_failed', token);
    return done('registered', token);
  } catch {
    // A failure to register is not a failure of the app, and it stays swallowed as far as the
    // USER is concerned: the alternative is a toast about notifications while somebody is trying
    // to look at their money. It is no longer swallowed as far as WE are concerned, which is the
    // whole point of the change — silence to the person, a recorded reason to us.
    return done('plugin_error');
  }
}

/** Marks a row written by the late-arrival path, so a slow provider is visible in the data. */
const LATE_TOKEN_NOTE = 'arrived after the wait window';

/**
 * How long to wait for APNs or FCM to answer BEFORE REPORTING — not before giving up.
 *
 * ⚠️ NOTHING IS DISCARDED WHEN THIS ELAPSES. The `registration` listener outlives it and saves a
 * token that arrives later, so this number decides only how quickly a provisional `timeout` is
 * recorded. Raised from 10s because a first registration on a cold app over cellular is routinely
 * slower than that, but the survival of the listener is the fix and this is only the tuning.
 */
export const REGISTRATION_TIMEOUT_MS = 30_000;

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
