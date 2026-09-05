import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { loadPrefs, savePrefs, NOTIFICATION_CATEGORIES } from '@/lib/notification-prefs';
import type { NotificationPrefs, NotificationCategory } from '@/lib/notification-prefs';
import type { PushRegistrationOutcome } from '@/lib/push-registration';

/**
 * What to tell somebody whose switch is on but whose device did not register.
 *
 * ⚠️ THE SWITCH USED TO LIE, AND ON iOS IT LIED TO EVERYONE. `registerForPush` was called with
 * `.catch(() => {})` and its result discarded, so the toggle went to ON whether a token had been
 * minted or not. Measured 2026-09-05: `App.entitlements` had no `aps-environment` key, so every
 * iOS registration failed — and the switch said ON, with `device_tokens` holding zero iOS rows.
 * A control that reports success while doing nothing is the exact failure this repo keeps
 * finding in its own code.
 *
 * Each message says whose problem it is without blaming the reader, and none of them is a toast:
 * a toast about notifications while somebody is looking at their money is its own bad idea, and
 * this is a line under the control they just pressed.
 */
const REGISTRATION_NOTE: Partial<Record<PushRegistrationOutcome, string>> = {
  denied: 'Notifications are turned off for Forgenta in your device settings, so nothing can be delivered. Turn them on there and flip this switch again.',
  timeout: 'Your device could not reach the notification service just now. It will try again the next time you open the app.',
  registration_error: 'This build of the app cannot receive notifications yet. Nothing is wrong with your settings — it is being fixed, and no action from you will help until it is.',
  empty_token: 'Your device did not return a delivery address. Reopening the app usually fixes it.',
  save_failed: 'Your device registered but we could not save it. It will try again the next time you open the app.',
  plugin_error: 'This build of the app cannot receive notifications yet. It is being fixed.',
};

/**
 * The one place notifications can be switched off.
 *
 * IT USED TO RENDER NOTHING ON THE WEB. The reasoning was that local notifications do not exist
 * in a browser, so a toggle there would be a control that does nothing. What that actually
 * produced was an app with NO off switch anywhere a browser user could reach — and the preference
 * was stored per-device, so it did not follow the account either.
 *
 * The switch is now an ACCOUNT preference (`profiles.notification_prefs`), which makes it real in
 * a browser: it is the value every device and every future server-side sender reads. The web copy
 * says plainly where the alerts are delivered, rather than implying the browser will buzz.
 *
 * Applies IMMEDIATELY with no Save button, following the Appearance precedent on the same screen.
 * Unlike before, a failed write is SHOWN and the switch goes back: a toggle that flips on screen
 * while the write fails leaves a user believing they are muted, and they are not.
 *
 * LOCAL notification permission is asked at the first moment there is something real to send
 * (see notification-service.ts). PUSH permission is asked HERE, and only here — see below.
 */
export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  // `null` = nothing to say: not asked yet, on the web, or it worked.
  const [registrationNote, setRegistrationNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPrefs().then(value => {
      if (!cancelled) setPrefs(value);
    });
    return () => { cancelled = true; };
  }, []);

  // Until the stored value has been read there is no honest state to draw. Rendering a default
  // would flip under the user the moment the real value arrived.
  if (prefs === null) return null;

  const commit = async (next: NotificationPrefs) => {
    const previous = prefs;
    setPrefs(next);
    setSaving(true);
    const ok = await savePrefs(next);
    setSaving(false);
    if (!ok) {
      setPrefs(previous);
      toast.error('Could not save that. Your notification settings are unchanged.');
    }
  };

  /**
   * ⚠️ THE ONLY PLACE THE PUSH PERMISSION PROMPT IS ASKED FOR, and the reason is the same one
   * `review-moment.ts` gives for reviews: on iOS the system prompt is a ONE-SHOT resource.
   * Decline it and the app can never present it again — the person has to find it in Settings,
   * which nobody does. So it has to be spent at a moment the user has a reason to say yes.
   *
   * Turning notifications ON is that moment. It is the user stating the intent in their own
   * words, seconds before the prompt appears, which is the strongest rationale the app will ever
   * have. `registerForPush` used to fire from `AuthContext` on sign-in instead — before a single
   * notification-worthy thing had happened — and every new user who tapped "Don't Allow" there
   * became permanently unreachable.
   *
   * Ordering matters: the preference is SAVED FIRST and the prompt follows. A person who says no
   * to the OS still has notifications switched on in the app, so the moment they grant permission
   * later — from Settings, or by toggling again — there is nothing else for them to redo. And a
   * declined prompt is deliberately NOT surfaced as an error: they answered the question.
   */
  const toggleMaster = () => {
    const next = { ...prefs, enabled: !prefs.enabled };
    void (async () => {
      await commit(next);
      setRegistrationNote(null);
      if (next.enabled && Capacitor.isNativePlatform()) {
        const { registerForPush } = await import('@/lib/push-registration');
        const { supabasePushStore } = await import('@/lib/push-store');
        // ⚠️ THE RESULT IS READ NOW. It used to be `.catch(() => {})` with the value discarded,
        // so the switch went ON whether or not a token existed — and on iOS a token never did.
        const { outcome } = await registerForPush(supabasePushStore, { prompt: true })
          .catch(() => ({ outcome: 'plugin_error' as const, token: null }));
        if (outcome !== 'registered' && outcome !== 'web') {
          setRegistrationNote(REGISTRATION_NOTE[outcome] ?? null);
        }
      }
    })();
  };

  const toggleCategory = (key: NotificationCategory) => {
    void commit({
      ...prefs,
      categories: { ...prefs.categories, [key]: prefs.categories[key] === false },
    });
  };

  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="card-forged p-5 space-y-4">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notifications</h2>

      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-3">
          <span className="text-xs">Alerts about your money</span>
          <p className="text-[10px] text-muted-foreground mt-1">
            A bill you cannot cover, a month projected below your cash floor, a milestone, a
            lesson, or a Sunday recap. At most five a week, one a day, never between 9pm and 8am.
          </p>
          {!isNative && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Delivered on the Forgenta mobile app. This setting applies to every device on your
              account.
            </p>
          )}
        </div>
        <Switch
          checked={prefs.enabled}
          onPress={toggleMaster}
          disabled={saving}
          label="Alerts about your money"
        />
      </div>

      {registrationNote && (
        <p
          role="status"
          data-testid="push-registration-note"
          className="text-[10px] text-destructive"
        >
          {registrationNote}
        </p>
      )}

      {/*
        Per-category opt-outs. They exist because a single master switch forces an all-or-nothing
        choice, and the user who would have muted only the weekly recap mutes everything instead —
        including the bill warning that was the reason to install the app.
      */}
      <div className={`space-y-3 pt-1 ${prefs.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
        {NOTIFICATION_CATEGORIES.map(category => (
          <div key={category.key} className="flex items-center justify-between">
            <div className="min-w-0 pr-3">
              <span className="text-[11px]">{category.label}</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">{category.description}</p>
            </div>
            <Switch
              checked={prefs.categories[category.key] !== false}
              onPress={() => toggleCategory(category.key)}
              disabled={saving || !prefs.enabled}
              label={category.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The switch itself, extracted only so the master and the seven categories cannot drift apart. */
function Switch({ checked, onPress, disabled, label }: {
  checked: boolean;
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onPress}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`shrink-0 w-8 h-4 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-secondary'} relative disabled:opacity-60`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}
