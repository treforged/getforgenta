// "What changed" for someone who was already using the app.
//
// Tre, 2026-09-13: "also start adding a popup for already logged in users to describe what changed.
// keep it consumer friendly. they dont need detailed explanations."
//
// The RULES live in `@/lib/whats-new` as pure functions, so the part that can be wrong is the part
// that is tested. This file reads whether this account has seen the current release, shows it, and
// records that it has.
//
// ⚠️ THE RECORD IS DURABLE AND PER ACCOUNT, not per component and not per device.
// `profiles.tour_flags` is the mechanism this app already uses for one-time UI (`new_user_done`,
// the checklist), it is a boolean map, and "has seen release X" is exactly a boolean per release.
// So no migration, and the answer survives a reload, a new device and a reinstall — a popup that
// comes back is worse than no popup, and `useState` has already taught this repo that lesson once
// through demo mode.
//
// ⚠️ NOTHING IS SET INTO STATE FROM AN EFFECT. Whether to show is COMPUTED during render from the
// profile, so there is no cascading render and no window where the dialog is open because an
// effect has not run yet. The only effect here performs a write, never a `setState`.
//
// ⚠️ AND A BRAND-NEW USER IS RECORDED WITHOUT BEING SHOWN. Otherwise their first ever popup would
// be a catch-up card about a version they never used. That is the silent branch below, and it is
// the one worth checking when this looks like it is doing nothing.
import { useEffect, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useProfile } from '@/hooks/useSupabaseData';
import { useDemo } from '@/contexts/DemoContext';
import { CURRENT_RELEASE, shouldShowWhatsNew, whatsNewFlag } from '@/lib/whats-new';

export function WhatsNewDialog() {
  const { isDemo } = useDemo();
  const { data: profile, loading, update } = useProfile();
  const [dismissed, setDismissed] = useState(false);

  const flags = (profile?.tour_flags as Record<string, boolean> | null) ?? {};
  const alreadySeen = flags[whatsNewFlag(CURRENT_RELEASE.version)] === true;
  const hasOnboarded = profile?.onboarding_completed === true;
  const ready = !isDemo && !loading && !!profile;

  const open =
    ready && !dismissed && shouldShowWhatsNew(alreadySeen ? CURRENT_RELEASE.version : null, hasOnboarded);

  // The silent branch: a user who will never be SHOWN this release still has it recorded, so their
  // first popup is the NEXT release rather than a catch-up about this one. A write, not a setState.
  useEffect(() => {
    if (!ready || alreadySeen || hasOnboarded) return;
    update.mutate({ tour_flags: { ...flags, [whatsNewFlag(CURRENT_RELEASE.version)]: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, alreadySeen, hasOnboarded]);

  const close = () => {
    setDismissed(true);
    // Recorded on dismissal rather than on display, so someone who closed the app mid-read is
    // shown it again. "Seen" should mean acknowledged, not merely rendered once.
    if (!alreadySeen) {
      update.mutate({ tour_flags: { ...flags, [whatsNewFlag(CURRENT_RELEASE.version)]: true } });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="What's new in Forgenta"
    >
      <div className="card-forged w-full max-w-sm p-5 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold">What's new</h2>
          </div>
          {/* ⚠️ ONE TAP TO DISMISS. A returning user opened the app to do something; this is an
              aside, not a gate, and it blocks nothing but its own overlay. */}
          <button
            onClick={close}
            aria-label="Close what's new"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors btn-press"
          >
            <X size={14} />
          </button>
        </div>

        <ul className="space-y-2">
          {CURRENT_RELEASE.lines.map(line => (
            <li key={line} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-primary shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <button onClick={close} className="btn btn-md btn-primary w-full">Got it</button>
      </div>
    </div>
  );
}
