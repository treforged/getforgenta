import type { Json } from '@/integrations/supabase/types';
import type { NotificationKind } from '@/lib/notification-policy';

/**
 * The notification switch, and where it lives.
 *
 * IT USED TO LIVE ON ONE DEVICE. `notification-service.ts` kept `forged:notif_enabled` in
 * Capacitor Preferences, which meant three things were true at once:
 *   - the web app could not show the control at all (it rendered null off-platform), so a browser
 *     user had no off switch anywhere;
 *   - turning it off on a phone left it on for the same account on a tablet;
 *   - nothing on the SERVER could read it, so any notification sent from a cron or an Edge
 *     Function would have had no way to know the user had said no. A switch the sender cannot
 *     read is not a switch, it is a decoration.
 *
 * So the account is now the source of truth (`profiles.notification_prefs`), and the device
 * keeps a MIRROR — because the send path (`runNotificationCheck`) runs on a phone that may be
 * offline, and the honest fallback there is the last value this account actually chose, not a
 * default. The mirror is written on every successful load and every save; it is never the thing
 * a user edits.
 *
 * `null`/`{}` means NEVER CHOSEN, and never-chosen reads as ON. That is deliberate: the existing
 * behaviour for every current user is on, and turning them all off in a migration would silently
 * end a feature they had opted into by installing the app.
 */

/** Every category a user can silence independently. Master off silences all of them. */
export type NotificationCategory = NotificationKind;

export interface NotificationPrefs {
  enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
}

/** Ordered for the settings screen: the ones that are about money owed first. */
export const NOTIFICATION_CATEGORIES: readonly {
  key: NotificationCategory;
  label: string;
  description: string;
}[] = [
  { key: 'bill_due', label: 'Bills you cannot cover', description: 'A bill lands in the next two days and the projection says the cash will not be there.' },
  { key: 'floor_risk', label: 'Month below your floor', description: 'Next month is projected to end under your cash floor, while there is still time to change it.' },
  { key: 'weekly_checkin', label: 'Weekly recap', description: 'Sunday morning: what moved this week, in numbers.' },
  { key: 'learn_lesson', label: 'New lesson ready', description: 'A two-minute money lesson, once a week.' },
  { key: 'streak_risk', label: 'Streak about to break', description: 'Only when you actually have a streak to lose.' },
  { key: 'milestone', label: 'Milestones', description: 'A debt cleared, a goal funded, a net-worth line crossed.' },
  { key: 'stale_accounts', label: 'Accounts need reconnecting', description: 'Your balances have stopped updating and the numbers are going stale.' },
];

export const ALL_CATEGORIES: readonly NotificationCategory[] = NOTIFICATION_CATEGORIES.map(c => c.key);

/** The value for an account that has never chosen: everything on. */
export function defaultPrefs(): NotificationPrefs {
  return {
    enabled: true,
    categories: Object.fromEntries(ALL_CATEGORIES.map(k => [k, true])) as Record<NotificationCategory, boolean>,
  };
}

export const PREFS_MIRROR_KEY = 'forged:notif_prefs';

/**
 * Parse whatever is in the column. Anything unrecognised falls back to on rather than off:
 * a parse failure must not silently mute a user's bill warnings.
 */
export function parsePrefs(raw: unknown): NotificationPrefs {
  const base = defaultPrefs();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled === 'boolean') base.enabled = obj.enabled;
  const cats = obj.categories;
  if (typeof cats === 'object' && cats !== null && !Array.isArray(cats)) {
    for (const key of ALL_CATEGORIES) {
      const value = (cats as Record<string, unknown>)[key];
      if (typeof value === 'boolean') base.categories[key] = value;
    }
  }
  return base;
}

/** True when this category may be sent. Master off wins over any category left on. */
export function isCategoryEnabled(prefs: NotificationPrefs, category: NotificationCategory): boolean {
  return prefs.enabled && prefs.categories[category] !== false;
}

/**
 * The Supabase client is imported LAZILY, like `@capacitor/preferences` below it.
 *
 * `notification-service.ts` is imported by the notification path and by node-environment tests
 * that have no `localStorage`; a top-level import here would drag the browser client — and its
 * `storage: localStorage` — into both. Deferring it keeps this module importable anywhere, and
 * the client is a singleton so the dynamic import costs nothing after the first call.
 */
async function client() {
  const { supabase } = await import('@/integrations/supabase/client');
  return supabase;
}

async function readMirror(): Promise<NotificationPrefs | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PREFS_MIRROR_KEY });
    if (!value) return null;
    return parsePrefs(JSON.parse(value));
  } catch {
    return null;
  }
}

async function writeMirror(prefs: NotificationPrefs): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PREFS_MIRROR_KEY, value: JSON.stringify(prefs) });
  } catch { /* the account row is the source of truth; a failed mirror is not an error */ }
}

/**
 * The account's preferences, with the device mirror as the offline fallback.
 *
 * Never throws. A signed-out or offline client gets the mirror, and failing that the default —
 * which is on, because the alternative is silently swallowing a warning about money.
 */
export async function loadPrefs(): Promise<NotificationPrefs> {
  try {
    const supabase = await client();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return (await readMirror()) ?? defaultPrefs();

    const { data, error } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return (await readMirror()) ?? defaultPrefs();

    const prefs = parsePrefs(data.notification_prefs);
    await writeMirror(prefs);
    return prefs;
  } catch {
    return (await readMirror()) ?? defaultPrefs();
  }
}

/**
 * Write the whole object, not a patch.
 *
 * Returns false when the account row could not be written, and the CALLER IS EXPECTED TO SHOW
 * THAT. A settings toggle that flips on screen while the write fails is the exact shape of bug
 * this whole change exists to remove — the user believes they are muted and then gets a
 * notification anyway.
 */
export async function savePrefs(prefs: NotificationPrefs): Promise<boolean> {
  await writeMirror(prefs);
  try {
    const supabase = await client();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return false;
    const { error } = await supabase
      .from('profiles')
      // The generated `Json` type is structural; the cast says "this plain object is JSON",
      // which it is - there is nothing in `NotificationPrefs` but booleans.
      .update({ notification_prefs: prefs as unknown as Json })
      .eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}
