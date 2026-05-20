import { Capacitor } from '@capacitor/core';

const KEY = 'forged:debug_log';
const MAX = 200;

export async function debugLog(event: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: KEY });
    const lines = (value ?? '').split('\n').filter(Boolean);
    const trimmed = lines.length >= MAX ? lines.slice(lines.length - MAX + 1) : lines;
    trimmed.push(`${Date.now()}|JS:${event}`);
    await Preferences.set({ key: KEY, value: trimmed.join('\n') });
  } catch { /* never block the app */ }
}
