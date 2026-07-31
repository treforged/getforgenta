import { useState, useCallback } from 'react';
import {
  CookieConsentState,
  loadConsent,
  saveConsent,
} from '@/lib/cookie-consent';

export type ConsentStatus = 'pending' | 'decided';

interface UseCookieConsentReturn {
  /** null while loading; populated once localStorage is read */
  consent: CookieConsentState | null;
  status: ConsentStatus;
  /** Accept all non-essential categories */
  acceptAll: () => void;
  /** Accept only essential cookies */
  rejectNonEssential: () => void;
  /** Save a custom selection */
  saveCustom: (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => void;
}

export function useCookieConsent(): UseCookieConsentReturn {
  // Read localStorage in a lazy initializer rather than a mount effect. The
  // stored consent never changes between the initializer and the first commit,
  // and initializing here means a returning visitor no longer gets one frame of
  // the cookie banner before it is dismissed again.
  // If nothing is stored, status stays 'pending' → banner shows.
  const [consent, setConsent] = useState<CookieConsentState | null>(() => loadConsent());

  // `status` was a second piece of state, but it was set to 'decided' in exactly
  // the same places `consent` was set to a value, and never anywhere else — so it
  // is derived instead of stored.
  const status: ConsentStatus = consent ? 'decided' : 'pending';

  const acceptAll = useCallback(() => {
    setConsent(saveConsent({ analytics: true, marketing: true }));
  }, []);

  const rejectNonEssential = useCallback(() => {
    setConsent(saveConsent({ analytics: false, marketing: false }));
  }, []);

  const saveCustom = useCallback(
    (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => {
      setConsent(saveConsent(prefs));
    },
    [],
  );

  return { consent, status, acceptAll, rejectNonEssential, saveCustom };
}
