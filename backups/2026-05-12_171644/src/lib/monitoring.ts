import { Capacitor } from '@capacitor/core';

export function initMonitoring(): void {
  if (Capacitor.isNativePlatform()) return;

  const clientId = import.meta.env.VITE_LD_CLIENT_ID as string | undefined;
  if (!clientId) return;

  Promise.all([
    import('@launchdarkly/observability'),
    import('@launchdarkly/session-replay'),
  ]).then(([{ LDObserve }, { LDRecord }]) => {
    LDObserve.init(clientId, {
      serviceName: 'forgenta-web',
      tracingOrigins: true,
      networkRecording: {
        enabled: true,
        recordHeadersAndBody: false,
      },
    });
    LDRecord.init(clientId);
  }).catch(() => { /* non-critical — never block the app */ });
}

export function identifyMonitoringUser(userId: string, email?: string): void {
  if (Capacitor.isNativePlatform()) return;
  import('@launchdarkly/observability').then(({ LDObserve }) => {
    LDObserve.identify(userId, email ? { email } : undefined);
  }).catch(() => {});
}
