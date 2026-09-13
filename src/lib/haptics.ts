import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * True when the native haptics engine could be reached at all.
 *
 * Failure-silent by design: `isNativePlatform()` reads a global the web bundle may not have
 * initialised (SSR, a preview iframe, a stripped test environment), so a throw here reads as
 * "no haptics" rather than taking the caller down with it.
 */
export function isHapticsAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * A light tap impact, for per-key feedback on the PIN pad.
 *
 * Failure-silent by design: on web it does nothing, and on a device it swallows every error —
 * a missing plugin, a denied permission, or hardware with no taptic engine. Feedback is a
 * nicety; it must never be able to break the control it decorates.
 */
export async function tapFeedback(): Promise<void> {
  if (!isHapticsAvailable()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Intentionally silent — see the note above.
  }
}
