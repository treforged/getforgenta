import { useState, useEffect } from 'react';
import { useProfile } from '@/hooks/useSupabaseData';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { NEW_USER_STEPS, PREMIUM_STEPS } from '@/lib/tour-steps';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';

export type TourVariant = 'new-user' | 'premium';

// Flag keys stored in profiles.tour_flags JSONB — account-based, cross-device
const FLAG_KEY: Record<TourVariant, string> = {
  'new-user': 'new_user_done',
  'premium': 'premium_done',
};

// localStorage cache key (device-level fast check to avoid DB round-trip on every load)
const LOCAL_KEY: Record<TourVariant, string> = {
  'new-user': 'forged:tour_done_new_user',
  'premium': 'forged:tour_done_premium',
};

interface AppTourProps {
  variant: TourVariant;
  onDone?: () => void;
}

export default function AppTour({ variant, onDone }: AppTourProps) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  /**
   * ⚠️ READ THROUGH THE SHARED PROFILE QUERY, NOT THROUGH A REQUEST OF ITS OWN.
   *
   * `/rest/v1/profiles` is BIMODAL on this project — measured over 85 timed requests: median 347ms,
   * p95 5082ms, with five pinned at the ~5s gateway ceiling and 2 of 33 calls returning 504. It is
   * "fast, or stuck until the gateway gives up", and the table holds 49 rows with two indexes, so
   * query cost cannot be the cause. That makes EVERY DUPLICATE REQUEST ANOTHER INDEPENDENT DRAW
   * AGAINST A 5-SECOND TAIL, and the Dashboard waits on the slowest of the ones it fires.
   *
   * This component used to make TWO of its own — one here, one in `dismiss` — both for the same
   * `tour_flags` on the same single row that `useProfile` already has cached. Going through the
   * shared query means TanStack dedupes them into the one request the page was making anyway.
   *
   * ⚠️ AND IT NO LONGER CALLS `supabase.auth.getUser()`, which was a second round trip to learn
   * something `useAuth` is already holding.
   *
   * ⚠️ NOTHING IS SHOWN WHILE THE PROFILE IS STILL LOADING. The old code only set `visible` after
   * its read came back, so an absent answer never rendered the tour; `loading` preserves exactly
   * that. Without it, somebody who dismissed the tour months ago would see it flash on every open
   * while the profile was in flight — the tail this commit is about making that flash LONGER.
   */
  const { data: profile, loading: profileLoading, update } = useProfile();
  const tourFlags = (profile?.tour_flags as Record<string, boolean> | null) ?? null;

  /**
   * ⚠️ WHETHER TO SHOW IS COMPUTED DURING RENDER, NOT SET FROM AN EFFECT.
   *
   * The first version of this change kept the old `setVisible(true)` inside the effect and lint
   * refused it — "Calling setState synchronously within an effect can trigger cascading renders".
   * That is the same rule that caught the what's-new dialog earlier today, and the fix is the same
   * shape: derive during render, and let the effect do only the WRITE. Read once into state so a
   * later `setItem` cannot change the answer mid-session and make the tour vanish under the user.
   */
  const [deviceDone] = useState(() => {
    try {
      return !!localStorage.getItem(LOCAL_KEY[variant]);
    } catch {
      // Private mode or blocked site data. Falling back to "not done" means the account is asked
      // instead, which is the authoritative answer anyway.
      return false;
    }
  });
  const accountDone = tourFlags?.[FLAG_KEY[variant]] === true;
  const ready = !profileLoading && !!profile;
  const visible = !dismissed && !deviceDone && ready && !accountDone;

  // The only effect: back-fill the device cache when the ACCOUNT already says done, so the next
  // open takes the fast path and never consults the slow endpoint at all. A write, not a setState.
  useEffect(() => {
    if (deviceDone || !ready || !accountDone) return;
    try {
      localStorage.setItem(LOCAL_KEY[variant], '1');
    } catch { /* nothing to do; the account remains the source of truth */ }
  }, [variant, deviceDone, ready, accountDone]);

  const steps = variant === 'premium' ? PREMIUM_STEPS : NEW_USER_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;

  const dismiss = async () => {
    setDismissed(true);
    // Write to device cache immediately
    localStorage.setItem(LOCAL_KEY[variant], '1');
    // Persist to the account so other devices see it too.
    //
    // ⚠️ THE EXISTING FLAGS COME FROM THE CACHED PROFILE, NOT FROM A FRESH READ. The old code did a
    // select-then-update here, which is a second round trip against the same slow endpoint for a
    // value already in hand. `tour_flags` is a MAP, so the spread is still required — writing only
    // this key would clear every other one-time flag on the account.
    try {
      await update.mutateAsync({
        tour_flags: { ...(tourFlags ?? {}), [FLAG_KEY[variant]]: true },
      });
    } catch {
      // The device cache is already set, so the tour stays gone here. It may reappear on another
      // device, which is a far better failure than blocking the dismissal on a 5-second request.
    }
    onDone?.();
  };

  // The backdrop already dismisses the tour, so Escape does the same.
  useEscapeToClose(() => { void dismiss(); }, visible);
  if (!visible) return null;

  return (
    <div className="modal-overlay z-100">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={dismiss} />

      {/* Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="App tour"
        className="relative z-10 w-full max-w-sm card-forged p-5 space-y-4"
        style={{ boxShadow: '0 0 40px -8px hsl(43 56% 52% / 0.25)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {variant === 'premium' && <Sparkles size={14} className="text-primary" />}
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {variant === 'premium' ? 'Premium Tour' : 'Getting Started'} · {step + 1}/{steps.length}
            </span>
          </div>
          <button aria-label="Close tour" onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={14} />
          </button>
        </div>

        {/* Step progress dots */}
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-0.5 flex-1 rounded-full transition-all duration-300"
              style={{ background: i <= step ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="space-y-2">
          <div className="text-2xl">{current.emoji}</div>
          <p className="font-display font-bold text-base tracking-tight">{current.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{current.body}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          >
            <ChevronLeft size={13} /> Back
          </button>

          {isLast ? (
            <button
              onClick={dismiss}
              className="bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Let's go
            </button>
          ) : (
            <button
              onClick={() => setStep(s => s + 1)}
              className="flex items-center gap-1 bg-primary text-primary-foreground px-4 py-1.5 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Next <ChevronRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
