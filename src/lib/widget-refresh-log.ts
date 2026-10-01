import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { isWidgetHost } from '@/lib/widget-host';

/**
 * Records that a BACKGROUND widget refresh actually published (ask e74da89c), so the desk can read
 * from SQL whether the OS ran the closed-app refresh and how often, instead of asking the user to
 * look at a home screen. Table: public.widget_refresh_events (migration 20261001b) - insert-own and
 * select-own only, and it stores the event, never a figure.
 */
export type RefreshVia = 'host' | 'hidden';

/** How this publish happened in the background, or null for an ordinary foreground publish. */
export function backgroundVia(win: Window = window, doc: Document = document): RefreshVia | null {
  if (isWidgetHost(win)) return 'host';
  return doc.visibilityState === 'hidden' ? 'hidden' : null;
}

export function platformFor(via: RefreshVia): 'ios' | 'android' | 'web' | '' {
  // The Android hidden WebView has no Capacitor bridge, so getPlatform() would say 'web' there.
  if (via === 'host') return 'android';
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' || p === 'web' ? p : '';
}

/** Best effort: a failed log must never fail or delay the widget publish it describes. */
//
// Native platforms only. A browser has no home-screen widget, and the table's trigger keeps at most
// 24 rows per user per 24 hours. On 2026-10-01 desk reads on localhost wrote 24 'web' rows by 10:52Z,
// so every iOS row from Tre's phone after that was silently dropped and the read showed 0 ios rows.
export async function logBackgroundRefresh(
  via: RefreshVia,
  platform: ReturnType<typeof platformFor> = platformFor(via),
): Promise<void> {
  if (platform !== 'ios' && platform !== 'android') return;
  try {
    const { error } = await supabase.from('widget_refresh_events').insert({ platform, via });
    if (error) console.warn('[widget-refresh-log] insert refused:', error.message);
  } catch (err) {
    console.warn('[widget-refresh-log] insert threw:', err);
  }
}
