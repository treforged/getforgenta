import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { isEnabled, setEnabled } from '@/lib/notification-service';

/**
 * The one place notifications can be switched off.
 *
 * RENDERS NOTHING ON THE WEB, deliberately. Local notifications do not exist in the browser
 * build, so a toggle there would be a control that does nothing - worse than no control, because
 * a user who turns it ON would reasonably expect to start hearing from us.
 *
 * Applies IMMEDIATELY with no Save button, following the Appearance precedent on the same screen:
 * this is a device-level preference rather than part of the profile the Save button writes, and
 * folding it into `dirty` would mean a user could switch notifications off, navigate away, and
 * have them silently stay on.
 *
 * There is no permission prompt here either. Permission is asked at the first moment there is
 * something real to send (see notification-service.ts) - not from a settings screen, where it
 * would buy the user nothing and can only be answered once.
 */
export default function NotificationSettings() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isEnabled().then(value => {
      if (!cancelled) setOn(value);
    });
    return () => { cancelled = true; };
  }, []);

  if (!Capacitor.isNativePlatform()) return null;
  // Until the stored value has been read there is no honest state to draw. Rendering a default
  // would flip under the user the moment the real value arrived.
  if (on === null) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    void setEnabled(next);
  };

  return (
    <div className="card-forged p-5 space-y-4">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notifications</h2>
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-3">
          <span className="text-xs">Alerts about your money</span>
          <p className="text-[10px] text-muted-foreground mt-1">
            A bill you cannot cover, a month projected below your cash floor, a milestone, or a
            Sunday summary. At most three a week, never between 9pm and 8am.
          </p>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={on}
          aria-label="Alerts about your money"
          className={`shrink-0 w-8 h-4 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'} relative`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );
}
