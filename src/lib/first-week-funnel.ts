/**
 * FIRST-WEEK FUNNEL (proposal G, Tre "yes" via Sam, 2026-10-09).
 *
 * The signup funnel stopped at `signup_completed`, so whether a new account ever finished setup,
 * saved anything or came back could not be read, and a change made today could not be measured
 * next week. Three steps are added, all through `recordFunnelStep`, so they inherit its rules:
 * anonymous rows (no account id, name or email), nothing under GPC/DNT or an analytics rejection.
 *
 *  - onboarding_finished: the wizard's profile save landed.
 *  - first_transaction:   a ledger entry saved; detail carries the source.
 *  - returned_day2:       signed in on a LATER calendar day than the signup day.
 *
 * Each is sent at most once per account per device (a marker in localStorage, which never leaves
 * the device), and only during the account's first 7 local calendar days. `detail` carries the day
 * ('d0'..'d6'), which is what turns three counts into a first-week curve.
 */
import { recordFunnelStep } from '@/lib/signup-funnel';
import { toLocalDateStr } from '@/lib/scheduling';

export type FirstWeekStep = 'onboarding_finished' | 'first_transaction' | 'returned_day2';

export const FIRST_WEEK_DAYS = 7;
const MARKER_PREFIX = 'forgenta:fw:';

/** Local calendar days from signup to `now` (0 = signup day), or null outside the first week. */
export function firstWeekDay(createdAt: string | undefined | null, now: Date): number | null {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return null;
  // Calendar days in the DEVICE's zone, counted on local midnights, never by dividing milliseconds:
  // a DST day is 23 or 25 hours (the reason toLocalDateStr exists).
  const a = toLocalDateStr(created);
  const b = toLocalDateStr(now);
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const days = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
  if (days < 0 || days >= FIRST_WEEK_DAYS) return null;
  return days;
}

function markerKey(step: FirstWeekStep, userId: string): string {
  return `${MARKER_PREFIX}${step}:${userId}`;
}

/**
 * Send `step` for this account if it is in its first week and this device has not sent it.
 * Returns whether a row was handed to the funnel (tests read this). Never throws.
 */
export function recordFirstWeekStep(
  step: FirstWeekStep,
  user: { id?: string; created_at?: string } | null | undefined,
  opts: { source?: string; now?: Date } = {},
): boolean {
  try {
    if (!user?.id) return false;
    const day = firstWeekDay(user.created_at, opts.now ?? new Date());
    if (day === null) return false;
    // "Came back" means a later day than the signup day; the signup session itself is not a return.
    if (step === 'returned_day2' && day < 1) return false;
    const key = markerKey(step, user.id);
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
    const detail = opts.source ? `${opts.source}_d${day}` : `d${day}`;
    recordFunnelStep(step, { detail });
    return true;
  } catch {
    return false;
  }
}
