// @vitest-environment jsdom
//
// THE VERCEL TRACKER DOES NOT MOUNT WITHOUT CONSENT, AND A GPC SIGNAL OUTRANKS CONSENT.
//
// ⚠️ THE FAILURE THIS GUARDS IS SILENT IN BOTH DIRECTIONS. A tracker that mounts when it should
// not sends a real person's pageviews to a vendor they refused — and it looks EXACTLY like a
// working tracker, because a working tracker also sends pageviews. A tracker that never mounts
// looks exactly like no tracker at all. Neither shows up as an error, so neither is noticed.
//
// ⚠️ THE POSITIVE CASE IS THE LOAD-BEARING ONE HERE. It is easy to write a privacy gate that
// refuses everything and calls itself safe: every "must not mount" case passes and the product
// silently collects nothing. That is the state this app was ALREADY in — `@vercel/speed-insights`
// sat in package.json unmounted, and Ruby has been working to a retention target with no
// instrument. So "mounts WHEN consent is given" is asserted first and deliberately.
//
// WHAT THIS DOES NOT CATCH, said plainly: whether a pageview actually ARRIVES at Vercel. That is
// a network fact about a deployed origin and no unit test can see it — it needs the live site and
// the Vercel API answering something other than 404. Named rather than implied.
//
// ⚠️ THAT NETWORK FACT WAS MEASURED ON 2026-09-14, AND THE ANSWER IS THAT NOTHING IS RETAINED.
// Recorded here so nobody re-derives it, and because two instruments manufacture a FALSE defect
// on the way to it:
//
//   1. The live production deployment DOES carry this component (commit 3b649028, deployed), and
//      https://getforgenta.com/_vercel/insights/script.js serves REAL JavaScript —
//      `application/javascript`, 3,106 bytes. The negative control is what makes that meaningful:
//      a made-up path under `/_vercel/` returns `text/html` index.html from the SPA fallback, so
//      a bare 200 would have proved nothing.
//   2. A pageview POSTed directly to `/_vercel/insights/view` is answered **200 OK**.
//   3. And the Vercel Web Analytics API still answers **404 "Web Analytics not found"** for the
//      project, for every window queried.
//
// Those are not in conflict. The ingest endpoint is FIRE-AND-FORGET: it accepts and discards when
// the product is not enabled on the project, so **a 200 there is not evidence of arrival** — it
// is an endpoint designed never to fail. The API 404 is the authoritative read, and it means
// WEB ANALYTICS IS NOT ENABLED IN THE VERCEL DASHBOARD. That is one toggle on Tre's account, and
// it is the only thing still standing between this code and a number Ruby can work to.
//
// ⚠️ AND A DRIVEN BROWSER CANNOT MEASURE THIS AT ALL — it reports the gate as broken when the
// gate is correct. Two independent reasons, either one sufficient:
//   • the Claude-controlled Chrome sends `navigator.doNotTrack === '1'` AND
//     `navigator.globalPrivacyControl === true`, so `hasTrackingOptOutSignal()` is true and this
//     component correctly renders nothing; and
//   • Vercel's own script self-disables on `navigator.webdriver`, which any automated browser
//     sets — `if (navigator.webdriver || navigator.userAgent.includes("Headless")) return`.
// So "no _vercel script in the DOM and no request on the live site" is the CORRECT behaviour
// under automation, and reading it as a defect would send the next session into this gate, which
// is fine. Do not chase it there.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({ consent: null as { analytics: boolean } | null, optOut: false }));

vi.mock('@/lib/consent-prefs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/consent-prefs')>('@/lib/consent-prefs');
  return { ...actual, loadConsent: () => state.consent };
});

vi.mock('@/lib/analytics', () => ({ hasTrackingOptOutSignal: () => state.optOut }));

// The vendor components are stubbed so the assertion is "did we RENDER it", which is the whole
// decision this component makes. Stubbing also keeps a real vendor script out of the test run.
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => <div data-testid="vercel-analytics" /> }));
vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => <div data-testid="vercel-speed" /> }));

import VercelAnalytics from '@/components/shared/VercelAnalytics';

beforeEach(() => { state.consent = null; state.optOut = false; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mounted = (c: ReturnType<typeof render>) => ({
  analytics: !!c.queryByTestId('vercel-analytics'),
  speed: !!c.queryByTestId('vercel-speed'),
});

describe('VercelAnalytics consent gate', () => {
  it('MOUNTS both when analytics consent is granted — the case a refuse-everything gate fails', () => {
    state.consent = { analytics: true };
    expect(mounted(render(<VercelAnalytics />))).toEqual({ analytics: true, speed: true });
  });

  it('does NOT mount when there is no stored consent at all', () => {
    state.consent = null;
    expect(mounted(render(<VercelAnalytics />))).toEqual({ analytics: false, speed: false });
  });

  it('does NOT mount when analytics consent was explicitly refused', () => {
    state.consent = { analytics: false };
    expect(mounted(render(<VercelAnalytics />))).toEqual({ analytics: false, speed: false });
  });

  it('a GPC / DNT signal OUTRANKS granted consent', () => {
    // The privacy policy says an opt-out signal suppresses analytics. Consent stored earlier must
    // not override a signal the browser is sending now.
    state.consent = { analytics: true };
    state.optOut = true;
    expect(mounted(render(<VercelAnalytics />))).toEqual({ analytics: false, speed: false });
  });
});
