import { Capacitor } from '@capacitor/core';
import { InAppReview } from '@capacitor-community/in-app-review';

const KEY_COUNT = 'tre:review:actionCount';
const KEY_DONE = 'tre:review:requested';
const THRESHOLD = 3;

function getCount(): number {
  return parseInt(localStorage.getItem(KEY_COUNT) ?? '0', 10);
}

function setCount(n: number): void {
  localStorage.setItem(KEY_COUNT, String(n));
}

function isDone(): boolean {
  return localStorage.getItem(KEY_DONE) === 'true';
}

/**
 * Call after a positive user action (rule saved, goal created, etc.).
 * Fires the native review prompt on the 3rd qualifying action, once ever.
 * No-ops on web.
 */
export async function requestReviewAfterAction(): Promise<void> {
  if (!Capacitor.isNativePlatform() || isDone()) return;
  const next = getCount() + 1;
  setCount(next);
  if (next >= THRESHOLD) {
    localStorage.setItem(KEY_DONE, 'true');
    try {
      await InAppReview.requestReview();
    } catch {
      // silently ignore — review prompt is best-effort
    }
  }
}
