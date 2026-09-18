import { useState } from 'react';
import { Link } from 'react-router';
import { X, ChevronDown, ChevronUp, Shield } from 'lucide-react';
import { COOKIE_CATEGORIES, CookieConsentState } from '@/lib/consent-prefs';
import { useConsentPrefs } from '@/hooks/useConsentPrefs';
import { ToggleSwitch } from '@/components/shared/ToggleSwitch';

// ---------------------------------------------------------------------------
// Preferences modal
// ---------------------------------------------------------------------------
interface PreferencesModalProps {
  initialAnalytics: boolean;
  initialMarketing: boolean;
  onSave: (prefs: Pick<CookieConsentState, 'analytics' | 'marketing'>) => void;
  onClose: () => void;
}

function PreferencesModal({
  initialAnalytics,
  initialMarketing,
  onSave,
  onClose,
}: PreferencesModalProps) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const [marketing, setMarketing] = useState(initialMarketing);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div
      className="modal-overlay z-60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-prefs-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative w-full max-w-md bg-card border border-border shadow-xl flex flex-col max-h-full"
        style={{ borderRadius: 'var(--radius)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-primary" />
            <h2 id="cookie-prefs-title" className="font-display font-semibold text-sm">
              Cookie Preferences
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose which cookies you allow. Essential cookies are always active. Your
            preferences are saved in your browser and apply to this device only.{' '}
            <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
          </p>

          {COOKIE_CATEGORIES.map((cat) => {
            const isOpen = expanded === cat.id;
            const value =
              cat.id === 'essential'
                ? true
                : cat.id === 'analytics'
                ? analytics
                : marketing;

            const toggle =
              cat.id === 'essential'
                ? undefined
                : cat.id === 'analytics'
                ? () => setAnalytics((v) => !v)
                : () => setMarketing((v) => !v);

            return (
              <div
                key={cat.id}
                className="border border-border"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  {/* Expand toggle */}
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={() => setExpanded(isOpen ? null : cat.id)}
                    aria-expanded={isOpen}
                    aria-controls={`cookie-cat-${cat.id}`}
                  >
                    <span className="text-xs font-medium">{cat.label}</span>
                    {isOpen ? (
                      <ChevronUp size={12} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                    )}
                  </button>

                  {/*
                    THE shared switch. This was a THIRD hand-rolled copy until 2026-09-14 — the
                    consolidation recorded on 2026-09-13 named it as done and had not touched it.
                    Its OFF track was a flat `bg-muted` with no border, so off read as
                    un-highlighted rather than OFF, on a COOKIE CONSENT control.
                  */}
                  <ToggleSwitch
                    checked={value}
                    onPress={toggle ?? (() => {})}
                    disabled={cat.required}
                    label={`${cat.label} cookies${cat.required ? ' (required)' : ''}`}
                  />
                </div>

                {isOpen && (
                  <div
                    id={`cookie-cat-${cat.id}`}
                    className="px-4 pb-3 space-y-2 border-t border-border/60"
                  >
                    <p className="text-xs text-muted-foreground leading-relaxed pt-2">
                      {cat.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      <span className="font-medium text-muted-foreground">Examples: </span>
                      {cat.examples.join(', ')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 border border-border transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ analytics, marketing })}
            className="text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main banner
// ---------------------------------------------------------------------------
export default function ConsentBanner() {
  const { status, consent, acceptAll, rejectNonEssential, saveCustom } =
    useConsentPrefs();
  const [showPrefs, setShowPrefs] = useState(false);

  // Don't render once the user has decided
  if (status === 'decided' && !showPrefs) return null;
  if (status === 'decided') {
    // If preferences modal opened from outside banner (e.g. Settings), still show it
    return showPrefs ? (
      <PreferencesModal
        initialAnalytics={consent?.analytics ?? false}
        initialMarketing={consent?.marketing ?? false}
        onSave={(prefs) => {
          saveCustom(prefs);
          setShowPrefs(false);
        }}
        onClose={() => setShowPrefs(false)}
      />
    ) : null;
  }

  return (
    <>
      {/* Banner */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card shadow-xl"
        role="region"
        aria-label="Cookie consent"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/*
          ⚠️ THE HEIGHT OF THIS BANNER IS A PRODUCT DECISION, NOT A STYLING ONE.
          It is fixed to the bottom, so every pixel it takes is a pixel of the first screen a
          new arrival cannot use. At ~300px on a phone it covered BOTH primary CTAs in
          Instagram's in-app browser, whose viewport is ~180px shorter than Safari's — the
          screenshot Tre sent on 2026-09-17. So on a phone it is deliberately compact: a
          four-word heading, two lines of body, and three buttons on one row.
          The full sentence survives at `sm` and above, where there is room for it.
          Gated by scripts/check-landing-first-screen.mjs at 390x664.
        */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          {/* Text */}
          <div className="flex-1 min-w-0 space-y-0.5 sm:space-y-1">
            <p className="text-xs font-semibold text-foreground">
              We use cookies
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug sm:leading-relaxed">
              <span className="hidden sm:inline">
                Essential cookies are always active. We also use analytics cookies to
                improve Budget OS. You can choose which non-essential cookies to allow.{' '}
              </span>
              <span className="sm:hidden">
                Essential ones are always active. Analytics cookies are your choice.{' '}
              </span>
              <Link to="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* The labels shorten on a phone so all three fit ONE row rather than three.
                The accessible name stays the full phrase — a screen-reader user must not be
                handed "Manage" and left to guess what it manages. */}
            <button
              onClick={() => setShowPrefs(true)}
              aria-label="Manage preferences"
              className="text-[11px] text-foreground/75 hover:text-foreground px-3 py-1.5 border border-border transition-colors btn-press whitespace-nowrap"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <span className="hidden sm:inline">Manage preferences</span>
              <span className="sm:hidden">Manage</span>
            </button>
            <button
              onClick={rejectNonEssential}
              aria-label="Reject non-essential"
              className="text-[11px] text-foreground/75 hover:text-foreground px-3 py-1.5 border border-border transition-colors btn-press whitespace-nowrap"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <span className="hidden sm:inline">Reject non-essential</span>
              <span className="sm:hidden">Reject</span>
            </button>
            <button
              onClick={acceptAll}
              className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 transition-colors btn-press whitespace-nowrap"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Accept all
            </button>
          </div>
        </div>
      </div>

      {/* Preferences modal (opened from banner) */}
      {showPrefs && (
        <PreferencesModal
          initialAnalytics={false}
          initialMarketing={false}
          onSave={(prefs) => {
            saveCustom(prefs);
            setShowPrefs(false);
          }}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </>
  );
}
