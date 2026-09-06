import { Link } from 'react-router';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useSupabaseData';
import { useDemoSession } from '@/hooks/useDemoSession';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { usePartnerLinkStatus } from '@/hooks/usePartnerLink';
import { resolveIdentity } from '@/lib/identity-badge';

/**
 * WHOSE ACCOUNT THIS IS, IN THE TOP-LEFT CORNER THE HAMBURGER VACATED.
 *
 * ⚠️ RANKED FIRST OF FIVE in `docs/navigation-jakobs-law.md`, by encounters per session. Every
 * other item in that plan is met occasionally; this one is unanswered on every screen of every
 * session. Nothing in the chrome carried an avatar or an account indicator before 2026-09-06 —
 * confirmed by grep across `src/`, which found no Avatar or initials component at all.
 *
 * ⚠️ THE PARTNER-VIEW BANNER STAYS. Constraint 1 of that document: do not take information away
 * to make a screen tidier. The banner is removed only by a change that shows the same fact MORE
 * prominently, and a 44px badge in a corner is not that. Two signals for a fact this expensive to
 * get wrong is the right number, not a duplication to clean up.
 *
 * ⚠️ ONE JOB: it goes to Settings, always, in every state. Making it switch back out of partner
 * view would give one control two behaviours depending on a state the control itself is reporting
 * — and the banner already offers that switch. A badge that sometimes navigates and sometimes
 * mutates the session is worse than no badge.
 *
 * The label and initials come from `resolveIdentity`, which never invents a name; see its header.
 */
export default function IdentityBadge() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { isDemo } = useDemoSession();
  const { isPartnerView } = useViewedProfile();
  const { partnerLabel } = usePartnerLinkStatus();

  const id = resolveIdentity({
    isDemo,
    isPartnerView,
    partnerLabel,
    displayName: profile?.display_name,
    email: user?.email,
  });

  return (
    <Link
      to="/settings"
      aria-label={id.title}
      title={id.title}
      className={cn(
        // 44px is the floor for a touch target, and this one sits at the very edge of the bar
        // where a thumb arrives at an angle. `min-h`/`min-w` rather than a fixed size so a longer
        // label grows the control sideways instead of shrinking the tap area.
        'flex items-center gap-1.5 min-h-[44px] min-w-[44px] pr-1.5 transition-colors btn-press',
        isPartnerView ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center w-7 h-7 shrink-0 text-[11px] font-semibold border',
          // ⚠️ Partner view is marked in COLOUR as well as in text. A person scanning the corner
          // rather than reading it still gets a signal that something is different.
          isPartnerView
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-secondary border-border text-foreground',
        )}
        style={{ borderRadius: '9999px' }}
        aria-hidden="true"
      >
        {/* No initial is honest when there is no name and no email to take one from. The generic
            glyph says "an account" without claiming to say whose. */}
        {id.initials || <User size={13} />}
      </span>
      {/* Hidden below 360px: at that width the label competes with the centred wordmark, and the
          circle plus its accessible name still answer the question. */}
      <span className="hidden min-[360px]:inline max-w-[5.5rem] truncate text-[11px] font-medium">
        {id.label}
      </span>
    </Link>
  );
}
