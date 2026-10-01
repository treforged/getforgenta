import { Capacitor } from '@capacitor/core';

const KEY = 'forged:debug_log';
const MAX = 200;

// ⚠️ WRITES ARE QUEUED, ONE AT A TIME (ask 98cbf494). Each write reads the whole log and sets it back,
// so two unawaited calls that overlap (Face ID fires FACEID_OK, UNLOCK_PERSISTED and UNLOCK_PAINTED
// within a few frames) both read the same old log and the second set drops the first line. A lost
// FACEID_OK means that unlock never produces a timing row at all. The native side (AppDelegate)
// writes the same key and is NOT covered by this queue.
let queue: Promise<void> = Promise.resolve();

async function append(event: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: KEY });
    const lines = (value ?? '').split('\n').filter(Boolean);
    const trimmed = lines.length >= MAX ? lines.slice(lines.length - MAX + 1) : lines;
    trimmed.push(`${Date.now()}|JS:${event}`);
    await Preferences.set({ key: KEY, value: trimmed.join('\n') });
  } catch { /* never block the app */ }
}

export function debugLog(event: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  queue = queue.then(() => append(event));
  return queue;
}
