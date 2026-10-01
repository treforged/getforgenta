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

function platformFor(via: RefreshVia): 'ios' | 'android' | 'web' | '' {
  // The Android hidden WebView has no Capacitor bridge, so getPlatform() would say 'web' there.
  if (via === 'host') return 'android';
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' || p === 'web' ? p : '';
}

/** Best effort: a failed log must never fail or delay the widget publish it describes. */
export async function logBackgroundRefresh(via: RefreshVia): Promise<void> {
  try {
    const { error } = await supabase.from('widget_refresh_events').insert({ platform: platformFor(via), via });
    if (error) console.warn('[widget-refresh-log] insert refused:', error.message);
  } catch (err) {
    console.warn('[widget-refresh-log] insert threw:', err);
  }
}
