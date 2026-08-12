import { Capacitor } from '@capacitor/core';

// ─────────────────────────────────────────────────────────────────────────────
// Error tracking + session replay.
//
// VENDOR: LaunchDarkly Observability + Session Replay (the Highlight.io engine).
// It was already a dependency, already initialized here, and already had a
// client id configured, and it covers all three things this app needs —
// error tracking, session replay, and source maps. Sentry was the original
// suggestion, but its stated reason ("first-class Next.js SDK") does not apply:
// this is a Vite + React + react-router app, not Next.js. Adding Sentry on top
// would mean TWO session-replay recorders running at once on a financial app —
// twice the bundle, twice the egress, and twice the surface that could capture
// a balance. See board card b0c8b701.
//
// Everything below the vendor boundary is `reportError()` / `identifyMonitoringUser()`.
// Callers never import the vendor SDK directly, so swapping vendors is this
// file and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replay redaction policy. Exported so a test can assert it rather than trusting
 * that nobody loosened it later.
 *
 * `strict` is the SDK's maximum: it redacts ALL text, ALL input fields, images
 * and videos — not the regex-based "looks like PII" guess that `default` uses.
 * This app renders real account balances, statement balances and payoff figures
 * as ordinary text, and a dollar amount does not look like PII to a regex, so
 * `default` would have shipped those balances into the replay.
 *
 * It is set EXPLICITLY even though the SDK currently falls back to `strict` on
 * its own (`privacySetting: s?.privacySetting ?? 'strict'` in the v1.1.17
 * bundle — note that this contradicts the SDK's own JSDoc, which documents the
 * default as the regex mode). Relying on an undocumented default to protect
 * real balances is one dependency bump away from being wrong, and the change
 * would be silent. Stated here, and pinned by a test.
 *
 * NOTE: `maskAllInputs` / `maskInputOptions` are deliberately NOT set — the SDK
 * only applies them when `privacySetting` is `none`. Setting them alongside
 * `strict` would read like extra safety while doing nothing.
 */
export const REPLAY_PRIVACY = {
  privacySetting: 'strict',
} as const;

/**
 * Observability policy. `recordHeadersAndBody` stays false: replay masking does
 * nothing for network capture, and the Supabase responses this app makes carry
 * every balance and transaction in cleartext. Masking the screen while shipping
 * the JSON that populated it would be masking in name only.
 */
export const OBSERVE_OPTIONS = {
  serviceName: 'forgenta-web',
  tracingOrigins: true,
  networkRecording: {
    enabled: true,
    recordHeadersAndBody: false,
  },
} as const;

// Component stacks can run to tens of kilobytes on a deep tree. The first few
// frames are the ones that name the culprit.
const MAX_COMPONENT_STACK = 4000;

let monitoringEnabled = false;

function isEnabled(): boolean {
  return monitoringEnabled && !Capacitor.isNativePlatform();
}

/** Test seam only — resets the module flag between cases. */
export function __setMonitoringEnabledForTests(value: boolean): void {
  monitoringEnabled = value;
}

export function initMonitoring(): void {
  if (Capacitor.isNativePlatform()) return;

  const clientId = import.meta.env.VITE_LD_CLIENT_ID as string | undefined;
  if (!clientId) return;

  monitoringEnabled = true;

  Promise.all([
    import('@launchdarkly/observability'),
    import('@launchdarkly/session-replay'),
  ]).then(([observeMod, recordMod]) => {
    const ObservePlugin = observeMod.default as unknown as { new(opts?: object): { initialize(id: string, opts?: object): void } };
    const RecordPlugin = recordMod.default as unknown as { new(opts?: object): { initialize(id: string, opts?: object): void } };
    new ObservePlugin({}).initialize(clientId, {
      ...OBSERVE_OPTIONS,
      environment: import.meta.env.MODE,
    });
    new RecordPlugin({}).initialize(clientId, {
      ...REPLAY_PRIVACY,
      environment: import.meta.env.MODE,
    });
  }).catch(() => { /* non-critical — never block the app */ });
}

export interface ErrorReportContext {
  /**
   * What the user would call the thing that broke ("Dashboard", "Forecast").
   * The ErrorBoundary's own label, so a report names a surface rather than a
   * minified component.
   */
  label?: string;
  /** React component stack, from componentDidCatch. */
  componentStack?: string;
  /** Which mechanism caught it. Defaults to the React boundary. */
  source?: string;
}

/**
 * Report a caught error to the error tracker, with the session replay attached.
 *
 * The SDK already captures `window.onerror` and unhandled rejections on its own.
 * What it CANNOT see is an error a React error boundary swallowed — the whole
 * point of a boundary is that the error never reaches the window. Without this
 * call, the errors users actually hit (a card that says "couldn't load") are the
 * exact ones that never get reported.
 *
 * Deliberately carries no application data: a label and a component stack, both
 * of which describe code, not the person using it.
 */
// NOTE: `context` is optional rather than defaulted to `{}` on purpose. The
// pre-commit hook's empty-stub guard matches `export function NAME[^{]*\{\s*\}`,
// and a `= {}` default parameter looks exactly like an empty body to it. Not
// worth weakening a guard that exists because empty stubs black-screened
// production twice (5ec0100 / c3c616d).
export function reportError(error: Error, context?: ErrorReportContext): void {
  if (!isEnabled()) return;

  const payload: Record<string, string> = {};
  if (context?.label) payload.label = context.label;
  if (context?.componentStack) {
    payload.componentStack = context.componentStack.slice(0, MAX_COMPONENT_STACK);
  }

  import('@launchdarkly/observability')
    .then(({ LDObserve }) => {
      (LDObserve as unknown as {
        recordError(
          error: Error,
          message?: string,
          payload?: Record<string, string>,
          source?: string,
          type?: string,
        ): void;
      }).recordError(
        error,
        context?.label ? `${context.label} failed to render` : error.message,
        payload,
        context?.source ?? 'ErrorBoundary',
        'React.ErrorBoundary',
      );
    })
    .catch(() => { /* reporting must never become the error */ });
}

export function identifyMonitoringUser(userId: string, email?: string): void {
  if (Capacitor.isNativePlatform()) return;
  import('@launchdarkly/session-replay').then(({ LDRecord }) => {
    (LDRecord as unknown as { identify(userId: string, opts?: { email?: string }): void })
      .identify(userId, email ? { email } : undefined);
  }).catch(() => {});
}
