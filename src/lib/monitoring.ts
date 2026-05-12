import { Capacitor } from '@capacitor/core';

export function initMonitoring(): void {
  if (Capacitor.isNativePlatform()) return;

  const clientId = import.meta.env.VITE_LD_CLIENT_ID as string | undefined;
  if (!clientId) return;

  Promise.all([
    import('@launchdarkly/observability'),
    import('@launchdarkly/session-replay'),
  ]).then(([observeMod, recordMod]) => {
    const ObservePlugin = observeMod.default as unknown as { new(opts?: object): { initialize(id: string, opts?: object): void } };
    const RecordPlugin = recordMod.default as unknown as { new(opts?: object): { initialize(id: string, opts?: object): void } };
    new ObservePlugin({}).initialize(clientId, {
      serviceName: 'forgenta-web',
      tracingOrigins: true,
      networkRecording: {
        enabled: true,
        recordHeadersAndBody: false,
      },
    });
    new RecordPlugin({}).initialize(clientId);
  }).catch(() => { /* non-critical — never block the app */ });
}

export function identifyMonitoringUser(userId: string, email?: string): void {
  if (Capacitor.isNativePlatform()) return;
  import('@launchdarkly/session-replay').then(({ LDRecord }) => {
    (LDRecord as any).identify(userId, email ? { email } : undefined);
  }).catch(() => {});
}
