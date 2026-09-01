// Consent preferences.
//
// ⚠️ THE FILENAME IS LOAD-BEARING. This was `cookie-consent.ts` until
// 2026-09-01, and content blockers match that string: uBlock-style lists block
// any request whose path contains `cookie-consent`, along with `cookieconsent`,
// `cookie-banner` and friends. In a Vite dev build every module is its own
// request, so the block did not merely disable a banner -- the request for this
// file FAILED, which failed `CookieBanner` and `Analytics`, which failed
// `App.tsx`, which left a completely blank page.
//
// Blank, and silent: this repo sets `hmr: { overlay: false }`, so there was no
// error overlay, and a module-graph fetch failure logs nothing to the console.
// Proved by copying this file byte-for-byte to a neutral name and importing
// both from the page: the neutral copy loaded, this path threw "Failed to
// fetch" while curl fetched it happily with a 200.
//
// So do not rename this back, and do not add `cookie` to any other module path
// that ships to a browser. The production build inlines these into a hashed
// bundle and is not affected, which is exactly why it went unnoticed in dev.

export type CookieCategoryId = 'essential' | 'analytics' | 'marketing';

export interface CookieConsentState {
  /** Semver string — bump to re-prompt users after policy changes */
  version: string;
  /** ISO timestamp of last decision */
  decidedAt: string;
  /** Always true — required for auth and session */
  essential: true;
  /** Usage analytics (e.g. Vercel Speed Insights) */
  analytics: boolean;
  /** Marketing / advertising cookies (currently unused) */
  marketing: boolean;
}

export interface CookieCategoryDef {
  id: CookieCategoryId;
  label: string;
  description: string;
  required: boolean;
  examples: string[];
}

export const COOKIE_CATEGORIES: CookieCategoryDef[] = [
  {
    id: 'essential',
    label: 'Essential',
    description:
      'Required for the site to function. These enable core features like authentication, security, and session management. They cannot be disabled.',
    required: true,
    examples: ['Supabase session token', 'CSRF protection', 'login state'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description:
      'Help us understand how you use Budget OS so we can improve the experience. Data is aggregated and never sold.',
    required: false,
    examples: ['Google Analytics', 'Vercel Speed Insights', 'page load timing', 'feature usage'],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description:
      'TRE Forgenta Budget OS does not currently use marketing cookies. This category is listed for transparency.',
    required: false,
    examples: ['(none currently active)'],
  },
];

const STORAGE_KEY = 'tre_cookie_consent';
const CURRENT_VERSION = '1.0';

/** Dispatched on `window` whenever consent is saved, so listeners (e.g. the
 * analytics loader) can react to a live decision without a shared context. */
export const COOKIE_CONSENT_EVENT = 'cookieconsentchange';

export function loadConsent(): CookieConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsentState;
    // Re-prompt if policy version changed
    if (parsed.version !== CURRENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConsent(
  prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>,
): CookieConsentState {
  const state: CookieConsentState = {
    version: CURRENT_VERSION,
    decidedAt: new Date().toISOString(),
    essential: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: state }));
  return state;
}

export function clearConsent(): void {
  localStorage.removeItem(STORAGE_KEY);
}
