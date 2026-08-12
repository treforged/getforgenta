import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The SDK is a browser/worker thing; the point of these tests is the wiring
// around it, so it is mocked at the module boundary.
const recordError = vi.fn();
vi.mock('@launchdarkly/observability', () => ({
  LDObserve: { recordError: (...args: unknown[]) => recordError(...args) },
}));

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

import {
  REPLAY_PRIVACY,
  OBSERVE_OPTIONS,
  reportError,
  __setMonitoringEnabledForTests,
} from '../monitoring';

beforeEach(() => {
  recordError.mockClear();
  isNativePlatform.mockReturnValue(false);
  __setMonitoringEnabledForTests(true);
});

afterEach(() => {
  __setMonitoringEnabledForTests(false);
});

describe('replay privacy policy', () => {
  // The reason this is a test and not a comment: the SDK's runtime default is
  // `?? 'strict'` but its published JSDoc says the default is the weaker
  // regex mode. A dependency bump could move the runtime to match the docs
  // and silently start recording balances. This fails if anyone loosens it.
  it('masks all text and inputs by default', () => {
    expect(REPLAY_PRIVACY.privacySetting).toBe('strict');
  });

  it('never records network request/response bodies', () => {
    // Masking the screen while shipping the JSON that populated it would be
    // masking in name only — Supabase responses carry every balance.
    expect(OBSERVE_OPTIONS.networkRecording.recordHeadersAndBody).toBe(false);
  });
});

describe('reportError', () => {
  it('reports a caught error, tagged as a React boundary error', async () => {
    const err = new Error('boom');
    reportError(err, { label: 'Dashboard', componentStack: '\n  at Widget' });
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));

    const [error, message, payload, source, type] = recordError.mock.calls[0];
    expect(error).toBe(err);
    expect(message).toBe('Dashboard failed to render');
    expect(payload).toMatchObject({ label: 'Dashboard', componentStack: '\n  at Widget' });
    expect(source).toBe('ErrorBoundary');
    expect(type).toBe('React.ErrorBoundary');
  });

  it('falls back to the error message when the boundary has no label', async () => {
    reportError(new Error('unlabelled boom'));
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    expect(recordError.mock.calls[0][1]).toBe('unlabelled boom');
  });

  it('truncates a runaway component stack', async () => {
    reportError(new Error('boom'), { componentStack: 'x'.repeat(10_000) });
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    expect(recordError.mock.calls[0][2].componentStack).toHaveLength(4000);
  });

  it('carries only code-describing fields, never application data', async () => {
    reportError(new Error('boom'), { label: 'Accounts', componentStack: 'at X' });
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    // If someone widens the payload later, this is the test that notices.
    expect(Object.keys(recordError.mock.calls[0][2]).sort()).toEqual(['componentStack', 'label']);
  });

  it('stays silent when monitoring is not configured', async () => {
    __setMonitoringEnabledForTests(false);
    reportError(new Error('boom'), { label: 'Dashboard' });
    await new Promise(r => setTimeout(r, 10));
    expect(recordError).not.toHaveBeenCalled();
  });

  it('stays silent on native, where the web SDK does not run', async () => {
    isNativePlatform.mockReturnValue(true);
    reportError(new Error('boom'), { label: 'Dashboard' });
    await new Promise(r => setTimeout(r, 10));
    expect(recordError).not.toHaveBeenCalled();
  });
});
