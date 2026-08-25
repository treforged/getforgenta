import { Eye } from 'lucide-react';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { usePartnerLinkStatus } from '@/hooks/usePartnerLink';

/**
 * The partner-view announcement — the lens equivalent of `DemoBanner`, and deliberately
 * shaped like it: a persistent strip inside DashboardLayout's sticky header that says
 * WHOSE data every page is rendering and that none of it can be edited, with the one
 * way back right there in the strip.
 *
 * It renders on every route while the lens is on the partner and nowhere else. Writes
 * are refused at the data layer (useSupabaseData's guards) and by RLS server-side; this
 * banner is the honest announcement of that state, not the enforcement of it.
 *
 * ⚠️ NO SAFE-AREA INSET HERE. `DashboardLayout`'s sticky wrapper owns it — same rule,
 * same reason as `DemoBanner`.
 */
export default function PartnerViewBanner() {
  const { isPartnerView, switchBack } = useViewedProfile();
  const { partnerLabel } = usePartnerLinkStatus();

  if (!isPartnerView) return null;

  const who = partnerLabel ? `${partnerLabel}'s` : "your partner's";

  return (
    <div className="bg-card border-b border-border/80 px-3 sm:px-5 pt-2.5 pb-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="shrink-0 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/15 px-2 py-0.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Eye size={10} /> Partner view
        </span>
        <span className="text-[11px] text-muted-foreground truncate">
          <span className="text-foreground font-medium">Viewing {who} budget</span>
          {' · '}
          read only
        </span>
      </div>

      <button
        onClick={switchBack}
        className="shrink-0 text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 btn-press"
        style={{ borderRadius: 'var(--radius)' }}
      >
        Back to my account
      </button>
    </div>
  );
}
