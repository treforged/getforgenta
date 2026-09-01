import { useEffect } from 'react';
import { loadConsent, COOKIE_CONSENT_EVENT } from '@/lib/consent-prefs';
import { initGA } from '@/lib/analytics';

/**
 * Consent-gated Google Analytics loader. Renders nothing. Initializes GA4 for
 * returning users who already granted analytics consent, and listens for a live
 * consent change (the cookie banner dispatches COOKIE_CONSENT_EVENT) to init GA
 * the moment analytics is accepted this session.
 */
export default function Analytics() {
  useEffect(() => {
    if (loadConsent()?.analytics) initGA(); // returning users (stored consent)

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { analytics?: boolean } | undefined;
      if (detail?.analytics) initGA(); // live accept this session
    };
    window.addEventListener(COOKIE_CONSENT_EVENT, onChange);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onChange);
  }, []);

  return null;
}
