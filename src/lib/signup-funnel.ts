/**
 * Anonymous counts of sign-in screen steps.
 * No account, name or email is ever attached. Only when analytics cookies are ACCEPTED does a row
 * carry `install_id`: a random UUID made on this device, kept in localStorage, never derived from
 * the device or linked to an account, and deleted the moment analytics is rejected (Sam approved
 * 2026-10-01, so funnel rows can be counted per install rather than per event).
 * Respects GPC/DNT signals and explicit analytics rejection.
 * Inserts only into the anon-only table `signup_funnel_events`.
 * Migration: 20260930b_signup_funnel_counts.sql
 */

import { supabase } from '@/integrations/supabase/client';
import { hasTrackingOptOutSignal } from '@/lib/analytics';
import { loadConsent } from '@/lib/consent-prefs';
import { Capacitor } from '@capacitor/core';

/**
 * The closed list of steps. The table's CHECK constraint must name exactly these;
 * signup-funnel.steps.test.ts compares this list with the newest migration that sets it.
 */
export const FUNNEL_STEPS = [
  'app_opened',
  'welcome_shown',
  'signup_form_shown',
  'tap_email',
  'tap_google',
  'tap_apple',
  'auth_error',
  'confirm_email_shown',
  'signup_completed',
  'try_demo',
  /** The landing page mounted (ask 4f473837: landing-to-download conversion). */
  'landing_viewed',
  /** A store badge on the landing page was pressed; `detail` is 'app_store' or 'play_store'. */
  'tap_store',
  /** The demo banner's "Sign Up Free" was pressed (e1b0fffc: does the demo convert anyone?). */
  'demo_signup_tap',
  // First week after signup (proposal G, 2026-10-09). Sent by first-week-funnel.ts only, once per
  // account per device, with `detail` = days since signup ('d0'..'d6'). Still no account id.
  /** The wizard's profile save landed. */
  'onboarding_finished',
  /** The first ledger entry saved; detail also names the source, e.g. 'manual_d1'. */
  'first_transaction',
  /** Signed in on a later calendar day than the signup day, inside the first week. */
  'returned_day2',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export type FunnelMethod = '' | 'email' | 'google' | 'apple';

/** Hosts whose rows count as real visitors. The native apps load getforgenta.com too. */
const PROD_HOSTS = new Set(['getforgenta.com', 'www.getforgenta.com']);

/**
 * Which population a row belongs to. Our own walks and checks run on localhost and write to the
 * same production table, so without this a test burst and a real visitor were the same row
 * (2026-10-01: 84 sign-ups in two days, zero real users). Anything that is not the production
 * host is 'dev', a Vercel preview included.
 */
export function funnelEnv(hostname: string): 'prod' | 'dev' {
  return PROD_HOSTS.has(hostname.toLowerCase()) ? 'prod' : 'dev';
}

/** '' where there is no window, so a missing host reads as 'dev' instead of throwing the row away. */
function currentHostname(): string {
  return typeof window !== 'undefined' && window.location ? window.location.hostname : '';
}

export const FUNNEL_INSTALL_ID_KEY = 'forgenta:funnel_install_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The per-install id, or null. Exists ONLY under an explicit analytics accept: no choice yet and a
 * rejection both mean no id, and any stored id is deleted. Never throws.
 */
export function funnelInstallId(): string | null {
  try {
    if (hasTrackingOptOutSignal() || loadConsent()?.analytics !== true) {
      localStorage.removeItem(FUNNEL_INSTALL_ID_KEY);
      return null;
    }
    const stored = localStorage.getItem(FUNNEL_INSTALL_ID_KEY);
    if (stored && UUID_RE.test(stored)) return stored;
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return null;
    const id = crypto.randomUUID();
    localStorage.setItem(FUNNEL_INSTALL_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

const sentSteps = new Set<string>();
let authErrorCount = 0;

/**
 * Normalises an unknown error into a safe lower-case code string.
 * Never returns the original error message.
 */
export function toErrorCode(raw: unknown): string {
  let code: string | undefined;
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'code' in raw &&
    typeof (raw as { code: unknown }).code === 'string'
  ) {
    code = (raw as { code: string }).code;
  } else if (raw instanceof Error) {
    code = raw.name;
  } else {
    code = 'unknown';
  }

  const sanitized = (code ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 40);

  return sanitized || 'unknown';
}

/**
 * How long a sign-in sheet was open before it reported "cancelled", measured ON THE PHONE.
 *
 * The rows' created_at is SERVER insert time, so the gap between tap_apple and auth_error says
 * nothing about the sheet: on 10-01..10-06 five iOS cancels landed 0.2-0.3 s after their tap on
 * the server clock, which would be an instant native failure if true, and a delayed first insert
 * if not. Under 1 s no person has pressed Cancel, so that bucket is a failure labelled as a cancel.
 * Buckets, not milliseconds: detail is limited to [a-z0-9_]{0,40} and a coarse value is enough.
 */
export function cancelDetail(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'user_cancelled';
  if (elapsedMs < 1000) return 'user_cancelled_lt1s';
  if (elapsedMs < 5000) return 'user_cancelled_1to5s';
  return 'user_cancelled_gt5s';
}

/**
 * Records a funnel step if tracking is allowed and the step has not
 * already been sent for this page lifetime (auth_error is limited to 5).
 */
export function recordFunnelStep(
  step: FunnelStep,
  opts?: { method?: FunnelMethod; detail?: string }
): void {
  try {
    if (hasTrackingOptOutSignal()) {
      return;
    }

    const consent = loadConsent();
    if (consent && consent.analytics === false) {
      return;
    }

    const method: FunnelMethod = opts?.method ?? '';
    const rawDetail = opts?.detail ?? '';
    const detail = rawDetail
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 40);

    const platformRaw = Capacitor.getPlatform();
    const platform =
      platformRaw === 'ios' || platformRaw === 'android' || platformRaw === 'web'
        ? platformRaw
        : '';

    // tap_store carries WHICH store in `detail`; without it in the key, a visitor who taps the App
    // Store badge and then the Play badge would record only the first.
    const key = step === 'tap_store' ? `${step}|${method}|${detail}` : `${step}|${method}`;

    if (step === 'auth_error') {
      if (authErrorCount >= 5) {
        return;
      }
      authErrorCount += 1;
    } else {
      if (sentSteps.has(key)) {
        return;
      }
      sentSteps.add(key);
    }

    void supabase
      // Not in the generated types (insert-only, nobody reads it from the client); same cast as
      // main.tsx uses for client_boot_failures.
      .from('signup_funnel_events' as never)
      .insert({ step, method, detail, platform, env: funnelEnv(currentHostname()), install_id: funnelInstallId() } as never)
      .then(undefined, () => {
        /* swallow rejection */
      });
  } catch {
    // Swallow any synchronous error
  }
}

/**
 * Resets in-memory tracking; used only by tests.
 */
export function __resetFunnelForTests(): void {
  sentSteps.clear();
  authErrorCount = 0;
}

/**
 * An OAuth sign-up completes outside Auth.tsx (the provider sheet returns a session), so the
 * auth listener calls this. Same "new account" test as maybeTrackOAuthSignUp: created in the
 * last 60 seconds. Email sign-ups are counted at the signUp call instead.
 */
export function recordOAuthSignupIfNew(user: { created_at?: string; app_metadata?: { provider?: string } }): void {
  const provider = user.app_metadata?.provider;
  if (provider !== 'google' && provider !== 'apple') return;
  if (!user.created_at || Date.now() - new Date(user.created_at).getTime() > 60_000) return;
  recordFunnelStep('signup_completed', { method: provider });
}
