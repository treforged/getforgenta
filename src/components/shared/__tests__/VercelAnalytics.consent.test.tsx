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
