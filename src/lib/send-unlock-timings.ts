// iOS only: send each finished Face ID unlock's timing (unlock-timing-report.ts) to
// public.client_boot_failures with path 'unlock-timing' (ask 98cbf494). Called at boot and a few
// seconds after each unlock. Never throws and never blocks the app.
import { supabase } from '@/lib/supabase';

export async function sendUnlockTimings(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() !== 'ios') return;
    const { Preferences } = await import('@capacitor/preferences');
    const { reportUnlockTimings, UNLOCK_REPORTED_KEY } = await import('./unlock-timing-report');
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return;
    await reportUnlockTimings({
      readLog: async () => (await Preferences.get({ key: 'forged:debug_log' })).value,
      readMark: async () => (await Preferences.get({ key: UNLOCK_REPORTED_KEY })).value,
      writeMark: async ts => { await Preferences.set({ key: UNLOCK_REPORTED_KEY, value: ts }); },
      send: async t => {
        const { error } = await supabase.from('client_boot_failures' as never).insert({
          user_id: uid, reason: t.reason, failed_at: t.at, path: 'unlock-timing', platform: 'ios',
        } as never);
        return !error;
      },
    });
  } catch { /* never block the app */ }
}
