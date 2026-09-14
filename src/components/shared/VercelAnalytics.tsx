import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { loadConsent, COOKIE_CONSENT_EVENT } from '@/lib/consent-prefs';
import { hasTrackingOptOutSignal } from '@/lib/analytics';

/**
 * Vercel Web Analytics and Speed Insights — MOUNTED ONLY BEHIND THE SAME CONSENT GATE AS GA4.
 *
 * ⚠️ THE PACKAGE WAS NEVER INSTALLED, WHICH IS WHY THE DASHBOARD SHOWED INSTALL STEPS. Tre
 * believed he had enabled Web Analytics in the Vercel dashboard; the API kept answering 404.
 * Enabling it there does nothing on its own — the app has to SEND a pageview, and nothing ever
 * did. `@vercel/speed-insights` was in `package.json` from some earlier pass and was never
 * mounted either, so it had never sent anything in its life.
 *
 * ⚠️ NAME COLLISION, AND IT IS A TRAP FOR THE NEXT READER. `src/components/shared/Analytics.tsx`
 * already exists and is mounted at `App.tsx` — that one is the consent-gated GOOGLE loader. A
 * grep for "Analytics" finds it and reads as "already wired". It is a different vendor. This
 * file is deliberately named `VercelAnalytics` so the two can never be confused again.
 *
 * ⚠️ WHY GATED RATHER THAN MOUNTED UNCONDITIONALLY, which is what Vercel's own docs show.
 * This app asks for analytics consent and the privacy policy makes two promises that an
 * always-on tracker would break outright:
 *   1. analytics cookies load only after the user accepts the `analytics` category, and
 *   2. a Global Privacy Control or Do Not Track signal suppresses analytics entirely.
 * `hasTrackingOptOutSignal()` is REUSED from `@/lib/analytics` rather than reimplemented — two
 * copies of a privacy gate is two chances for them to disagree, and the one that drifts is the
 * one nobody is reading. GPC is a legally binding opt-out request, not a preference.
 *
 * ⚠️ MOUNTING IS THE GATE. There is no "load it but tell it to stay quiet" here: when consent is
 * absent the components are not rendered, so no script is fetched and no request is made. That
 * is stronger than a `beforeSend` returning null, which still loads the vendor script.
 *
 * Renders nothing visible.
 */
export default function VercelAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const decide = () => {
      // An opt-out signal OUTRANKS stored consent, exactly as `initGA` treats it.
      if (hasTrackingOptOutSignal()) return setAllowed(false);
      setAllowed(loadConsent()?.analytics === true);
    };

    decide(); // returning users, from stored consent

    // The cookie banner dispatches this when the choice changes mid-session. Without it, a user
    // who accepts analytics would not be counted until their next page load — and one who
    // WITHDRAWS consent would keep being counted for the rest of the session, which is the half
    // that actually matters.
    const onChange = () => decide();
    window.addEventListener(COOKIE_CONSENT_EVENT, onChange);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onChange);
  }, []);

  if (!allowed) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
