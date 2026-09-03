/**
 * Whether the app has a number good enough to put on someone's HOME SCREEN.
 *
 * A widget is the least forgiving surface this app has. It shows a figure without
 * anyone opening anything, which means **nobody opens the app to check what the
 * home screen already told them**. A stale or defaulted value there is worse than
 * a blank one: a blank prompts a tap, a wrong number ends the conversation.
 *
 * So the rule from every other surface applies hardest here — never render a
 * figure you did not actually read — and it is enforced in two places on purpose:
 *
 *   - HERE, on the way out: the app refuses to SEND a number it does not have.
 *   - In `WidgetSnapshot.java`, on the way in: the widget refuses to RENDER a
 *     snapshot that is absent, malformed, or too old.
 *
 * Either one alone leaves a hole. A widget installed on a phone that has not
 * opened the app in a month has a perfectly well-formed snapshot; only the
 * reader can catch that one.
 */

/**
 * After this long without an update, the number on the home screen stops being
 * information and starts being a claim about a past that may not hold. Seven
 * days is chosen against what the figures actually are: month-end cash and net
 * worth move with every transaction, and a week is long enough that a balance
 * can have changed by a paycheck and a rent payment.
 */
export const WIDGET_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface WidgetPayload {
  monthEndCash: number;
  netWorth: number;
  currency: string;
  updatedAt: string;
}

export interface WidgetInputs {
  monthEndCash: number | null | undefined;
  netWorth: number | null | undefined;
  currency: string | null | undefined;
  /** False in demo, in partner view, or while the figures are still loading. */
  enabled: boolean;
}

/**
 * The payload to send, or null when the app does not have one worth sending.
 *
 * ⚠️ `null` and `undefined` are NOT zero. A user whose net worth genuinely is
 * zero and a user whose projection has not loaded are different people, and
 * `optDouble(..., 0)` on the Android side used to render both as "$0" in
 * confident gold. Sending nothing leaves the widget saying "open Forgenta to
 * sync", which is true.
 *
 * NaN and Infinity are refused for the same reason: they are what a division by
 * a missing denominator looks like, and `NumberFormat` will happily print "∞".
 */
export function buildWidgetPayload(inputs: WidgetInputs, now: Date): WidgetPayload | null {
  if (!inputs.enabled) return null;

  const cash = inputs.monthEndCash;
  const worth = inputs.netWorth;
  if (typeof cash !== 'number' || !Number.isFinite(cash)) return null;
  if (typeof worth !== 'number' || !Number.isFinite(worth)) return null;

  return {
    monthEndCash: cash,
    netWorth: worth,
    // The user's own currency, not a hardcoded dollar sign. Formatting a
    // non-USD figure with "$" is a wrong number rendered confidently, which is
    // the same failure as a stale one.
    currency: inputs.currency && inputs.currency.trim() !== '' ? inputs.currency : 'USD',
    updatedAt: now.toISOString(),
  };
}

/** True when a snapshot of this age should no longer be shown as a figure. */
export function isSnapshotStale(updatedAt: string | null, now: Date): boolean {
  if (!updatedAt) return true;
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then > WIDGET_STALE_AFTER_MS;
}
