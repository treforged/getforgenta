import { Capacitor } from '@capacitor/core';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    doNotTrack?: string | null;
  }
  interface Navigator {
    // Global Privacy Control — not yet in the DOM lib typings
    globalPrivacyControl?: boolean;
    // Legacy vendor-prefixed Do Not Track
    msDoNotTrack?: string | null;
  }
}

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

let initialized = false;

/**
 * True when the browser is broadcasting an opt-out of tracking.
 *
 * Two distinct signals are honored:
 *  - Global Privacy Control (`Sec-GPC`) — a legally binding opt-out request
 *    under CPRA (California), CPA (Colorado), and CTDPA (Connecticut).
 *  - Do Not Track — deprecated and voluntary, but still sent by Firefox and
 *    several privacy browsers; we treat it as an opt-out too.
 *
 * Either signal suppresses analytics regardless of stored cookie consent, so a
 * consent record captured before the user enabled the signal cannot override it.
 */
export function hasTrackingOptOutSignal(): boolean {
  if (typeof navigator === 'undefined') return false;

  if (navigator.globalPrivacyControl === true) return true;

  // DNT lives in three places depending on browser vintage; '1' means opt out.
  const dnt = navigator.doNotTrack ?? window.doNotTrack ?? navigator.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/**
 * Load Google Analytics 4 (gtag.js) and start a session. Idempotent, web-only,
 * and a no-op unless a Measurement ID is configured. Must only be called after
 * the user has granted analytics cookie consent.
 */
export function initGA(): void {
  if (initialized) return;
  if (Capacitor.isNativePlatform()) return; // web-only
  if (!MEASUREMENT_ID) return;
  if (hasTrackingOptOutSignal()) return; // DNT / GPC overrides stored consent

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // GTM's command processor only dispatches dataLayer entries that are the
  // `arguments` object (array-LIKE, Array.isArray()===false). A rest-parameter
  // array (`...args`) is a genuine Array and is silently ignored, so the
  // `config`/`event`/`get` commands never take effect. This MUST push the real
  // `arguments` object, which requires a classic function (not an arrow).
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);

  initialized = true;
}

/**
 * Fire the GA4 `sign_up` conversion event. No-op if GA has not been initialized
 * (e.g. analytics consent not granted, native platform, or no Measurement ID).
 */
export function trackSignUp(method: 'email' | 'oauth'): void {
  if (hasTrackingOptOutSignal()) return;
  if (!window.gtag) return;
  window.gtag('event', 'sign_up', { method });
}

interface OAuthUser {
  id: string;
  created_at?: string;
  app_metadata?: { provider?: string };
}

/**
 * Fire `sign_up` for OAuth (Google/Apple) users on their FIRST sign-in only.
 * Email signups are tracked separately at the signUp call site, so this skips
 * non-OAuth providers. Returning logins are skipped via a created_at freshness
 * check, and a localStorage flag dedups across sessions.
 */
export function maybeTrackOAuthSignUp(user: OAuthUser): void {
  const provider = user.app_metadata?.provider;
  if (provider !== 'google' && provider !== 'apple') return; // email tracked at signUp
  if (!user.created_at) return;
  if (Date.now() - new Date(user.created_at).getTime() > 60_000) return; // returning login

  const key = `forgenta:signup_tracked_${user.id}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');

  trackSignUp('oauth');
}
