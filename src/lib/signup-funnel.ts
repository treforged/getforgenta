/**
 * Anonymous counts of sign-in screen steps.
 * No user identifiers are stored, nothing is persisted on the device.
 * Respects GPC/DNT signals and explicit analytics rejection.
 * Inserts only into the anon-only table `signup_funnel_events`.
 * Migration: 20260930b_signup_funnel_counts.sql
 */

import { supabase } from '@/integrations/supabase/client';
import { hasTrackingOptOutSignal } from '@/lib/analytics';
import { loadConsent } from '@/lib/consent-prefs';
import { Capacitor } from '@capacitor/core';

export type FunnelStep =
  | 'app_opened'
  | 'welcome_shown'
  | 'signup_form_shown'
  | 'tap_email'
  | 'tap_google'
  | 'tap_apple'
  | 'auth_error'
  | 'confirm_email_shown'
  | 'signup_completed'
  | 'try_demo';
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

    const key = `${step}|${method}`;

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
      .insert({ step, method, detail, platform, env: funnelEnv(currentHostname()) } as never)
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
