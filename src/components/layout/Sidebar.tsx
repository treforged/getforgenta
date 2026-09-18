import { Link, useLocation } from 'react-router';
import {
  Crown, LogOut, ChevronLeft, ChevronRight,
  Home, Zap, ArrowLeft, Eye,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDemoSession } from '@/hooks/useDemoSession';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { usePartnerLinkStatus } from '@/hooks/usePartnerLink';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';
import { PRIMARY_NAV } from '@/lib/primary-nav';

/**
 * ⚠️ DERIVED, NOT DECLARED — the rail and the phone bar are ONE list now.
 *
 * Tre, 2026-09-15: the selections on a big screen were different from the selections on mobile,
 * and mobile is the reference. This file used to declare its own seven destinations against the
 * phone bar's five. See `src/lib/primary-nav.ts` for the measured mismatch, for what the rail
 * lost, and for where each lost destination is still reached from.
 */
const navItems = PRIMARY_NAV;


/**
 * A LABEL THAT VANISHES WHILE THE RAIL IS NARROW.
 *
 * ⚠️ THE RAIL'S WIDTH AND THE RAIL'S CONTENT ARE DRIVEN BY DIFFERENT THINGS, AND THEY
 * DISAGREED. The width is CSS - `fine-pointer:w-16`, widening to `w-52` only on hover or
 * focus, so the expansion is an overlay and never a reflow. The content was React state:
 * `collapsed`, which starts FALSE. So on any mouse, from the first paint, full-width
 * labels rendered inside a 64px `overflow-hidden` rail. Measured 2026-09-15 at both 1440
 * and 1024: the wordmark's box ended at 139px against a rail ending at 72 (Tre saw "FO"),
 * and "Sign Out" sat on TWO lines - 36px over an 18px line-height - with its icon pushed
 * out of sight. His words: "It needs to look overall clear."
 *
 * The nav labels escaped this only by accident: `flex-1 min-w-0 truncate` collapses them
 * to zero width. That is a side effect, not an intention, and it is why the two labels
 * built WITHOUT that combination were the two he reported.
 *
 * So visibility now follows the same signal the width does. On a fine pointer the label
 * is hidden and comes back with hover or focus-within - `group-focus-within` is not
 * decoration, it is what keeps a keyboard user from tabbing through unlabelled icons. On
 * a coarse pointer nothing here applies and `collapsed` alone decides, which is correct:
 * there is no hover to expand into on a touch device.
 */
const RAIL_LABEL = 'fine-pointer:hidden fine-pointer:group-hover:inline fine-pointer:group-focus-within:inline';

/**
 * `RAIL_LABEL` for a label row that is itself a FLEX container. The plain constant restores
 * `display: inline` on hover, which would collapse this row's own flex layout - the numeric badge
 * uses `ml-auto` and has nothing to push against once the parent stops being a flex box.
 */
const RAIL_LABEL_FLEX = 'fine-pointer:hidden fine-pointer:group-hover:flex fine-pointer:group-focus-within:flex';

/**
 * The mirror of `RAIL_LABEL`: visible ONLY while the rail is narrow on a mouse.
 *
 * ⚠️ IT STARTS `hidden` ON PURPOSE. A coarse pointer has no hover to expand into, so on touch the
 * manual `collapsed` flag is the only signal — and this class must contribute nothing there. The
 * caller adds it only when `collapsed` is false; when it is true the dot is shown outright, for
 * both pointer kinds.
 */
const RAIL_ONLY = 'hidden fine-pointer:block fine-pointer:group-hover:hidden fine-pointer:group-focus-within:hidden';

export default function Sidebar() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { isDemo, isPreview, leaveDemo } = useDemoSession();
  const [collapsed, setCollapsed] = useState(false);

  /**
   * §1B Stage 5 — bank charges the app has a suggested match for and is waiting on.
   *
   * ⚠️ NOT a count of unreviewed rows. Most bank rows are unreviewed by design and always will be
   * (Tre, 2026-08-08); badging that would be a number nobody can drive to zero. Read
   * `@/lib/bank-activity-queue`'s header before changing what this means.
   *
   * ⚠️ THIS COSTS A REAL FETCH ON EVERY PAGE, and it is a deliberate trade. The rail renders app-wide,
   * so the all-history synced-transaction query now runs everywhere rather than only on
   * `/transactions`. That is the entire point: the suggestions already worked and were invisible
   * because reaching them required already being on the page that hides them. react-query serves
   * every consumer from one cache, so the tab badge and Bank Activity itself add nothing on top.
   *
   * Null while loading and null at zero — the badge simply is not rendered, because a "0" and a
   * badge that failed to compute look identical.
   */
  const reviewQueueCount = useBankReviewQueueCount();

  /**
   * The partner-view switcher (partner-linking design §4 Phase 1). Rendered only when
   * there is genuinely somewhere to switch TO: not demo, and an ACTIVE link with the
   * partner's id on it. Absent for everyone else — an entry that opens onto nothing
   * would be a dead button. Deliberately NOT gated on the viewer's own premium:
   * premium is enforced server-side at INVITE time and the invitee rides along
   * (design §5, the household-plan promise), so an active link IS the entitlement.
   */
  const { isPartnerView, switchTo, switchBack } = useViewedProfile();
  const { partnerUserId, partnerLabel } = usePartnerLinkStatus();
  const showPartnerSwitch = !isDemo && !!partnerUserId;

  // Brand link: dashboard if logged in, landing if demo/auth
  const brandTo = isDemo ? '/' : '/dashboard';

  return (
    <aside
      className={cn(
        // ⚠️ `z-40` BELONGS ON THIS ELEMENT, NOT ONLY ON THE RAIL INSIDE IT - Tre, 2026-09-16,
        // with a desktop screenshot: *"the pop out should go over the items, not behind."*
        // MEASURED, because a z-index read cannot answer this and the class list looked correct:
        // `elementFromPoint` at a point 12px inside the EXPANDED rail returned a <p> from an
        // account card. `position: sticky` CREATES A STACKING CONTEXT even at `z-index: auto`,
        // so the rail's own `z-40` only ranked it INSIDE this aside. In the root stacking context
        // the aside sat at level 0 against `.card-forged`, which is also a level-0 stacking
        // context because it carries a `backdrop-filter` - and between two level-0 contexts DOM
        // ORDER decides. The content column comes after the aside, so every glass card on every
        // desktop route painted over the pop-out. Raising the aside lifts its whole subtree.
        // Stays BELOW the z-50 modals deliberately: an overlay must still cover the rail.
        "hidden lg:block h-screen sticky top-0 shrink-0 z-40",
        // ⚠️ THE FOOTPRINT NEVER CHANGES ON A MOUSE, and that is what makes the expansion an
        // OVERLAY rather than a reflow. Tre: "it can partially cover where the items on the page
        // are." If this element grew, every bounding box on the page would move instead.
        "fine-pointer:w-16",
        collapsed ? "w-16" : "w-52"
      )}
    >
      {/*
        The panel. Out of flow on a mouse, so widening it covers the content rather than pushing it.

        ⚠️ `focus-within` IS NOT DECORATION — without it this is mouse-only in the literal sense: a
        keyboard user would tab through a column of unlabelled icons and never see a label.
        ⚠️ AND IT CANNOT EAT CLICKS. Only 64px of it is ever on screen unhovered; the extra width
        exists only while it is open, so content behind the rail stays clickable.
      */}
      <div
        className={cn(
          "group flex flex-col bg-sidebar border-r border-sidebar-border h-screen transition-all duration-200 overflow-hidden",
          "fine-pointer:absolute fine-pointer:inset-y-0 fine-pointer:left-0 fine-pointer:z-40",
          "fine-pointer:w-16 fine-pointer:hover:w-52 fine-pointer:focus-within:w-52",
          "fine-pointer:hover:shadow-xl fine-pointer:focus-within:shadow-xl",
          collapsed ? "w-16" : "w-52"
        )}
      >
      {/* THE MARK SURVIVES THE COLLAPSE (Tre, 2026-09-01: "keep the logo still
          visible when you collapse the left side bar on desktop"). The whole
          brand link used to be dropped, which left a 64px rail with nothing in
          it but a chevron -- and took away the only way back to the dashboard
          from the header.

          The WORDMARK still goes, because it cannot fit and it is the half that
          repeats what the tab title already says. The mark shrinks 34 -> 24 and
          the padding tightens to px-2 so that 8 + 24 + gap + a 16px chevron + 8
          lands inside the rail rather than wrapping. */}
      {/*
        ⚠️ THE HEADER SIZED ITSELF BY `collapsed` WHILE THE RAIL SIZED ITSELF BY CSS - the same
        disagreement described above, and the one that survived the first fix because the header's
        geometry is padding and a pixel height rather than a label. Measured 2026-09-15: at rest on
        a mouse it asked for px-3 (12) + a 34px mark + a 25px button + px-3 (12) = 83px inside a
        71px rail, and its right edge landed at 72.5 against a rail ending at 72. That 2px IS half
        of the horizontal scrollbar Tre reported bottom-left (ask 98830520 item 2).

        So the narrow geometry now follows the rail on BOTH signals: `collapsed` for touch, the
        `fine-pointer` variants for a mouse. 8 + 24 + 25 + 8 = 65 and it fits.
      */}
      <div className={cn(
        "flex items-center justify-between h-14 border-b border-sidebar-border",
        collapsed
          ? "px-2 gap-1"
          : "px-3 fine-pointer:px-2 fine-pointer:group-hover:px-3 fine-pointer:group-focus-within:px-3",
      )}>
        <Link
          to={brandTo}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
          aria-label="Forgenta home"
        >
          <img
            src="/logo-transparent.png"
            alt="Forgenta"
            // Kept in proportion with the mobile bar's mark, which went 22 -> 30.
            // ⚠️ THE SIZE IS A CLASS, NOT AN INLINE STYLE, so that it can follow the rail's CSS
            // width on a mouse. An inline height can only ever follow React state, and state is
            // exactly what disagreed with the rail - see the header comment above for the 83px.
            className={cn(
              'object-contain shrink-0',
              collapsed
                ? 'h-6 w-6'
                : 'h-[34px] w-[34px] fine-pointer:h-6 fine-pointer:w-6 fine-pointer:group-hover:h-[34px] fine-pointer:group-hover:w-[34px] fine-pointer:group-focus-within:h-[34px] fine-pointer:group-focus-within:w-[34px]',
            )}
            draggable={false}
          />
          {!collapsed && (
            <span className={cn("font-display font-bold text-sm tracking-tight text-primary", RAIL_LABEL)}>FORGENTA</span>
          )}
          {!collapsed && isDemo && (
            <span className={cn("text-[9px] font-bold uppercase tracking-wider text-gold bg-gold/10 px-1 py-0.5 rounded shrink-0", RAIL_LABEL)}>Demo</span>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors btn-press"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {/* No filter: every destination in PRIMARY_NAV is for every user at every width. The
            `/premium` row this used to hide for demo and premium users is no longer a rail row —
            Upgrade is reached from the contextual `PremiumGate` links instead. */}
        {navItems.map(item => {
          const active = pathname === item.to;
          const badge = item.to === '/transactions' ? reviewQueueCount : null;
          return (
            <Link
              key={item.to}
              to={item.to}
              // ⚠️ THE LABEL ELEMENT IS NOT RENDERED WHEN COLLAPSED, so without this the link's
              // accessible name is EMPTY and a screen reader announces an unnamed link. That was
              // already true of the manual collapse; the hover rail makes icon-only the DEFAULT on
              // every mouse, which turns a latent defect into the normal case.
              aria-label={item.label}
              title={badge !== null
                ? `${badge} bank ${badge === 1 ? 'charge has' : 'charges have'} a suggested match waiting for you`
                : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs font-medium transition-colors duration-150 btn-press",
                active
                  ? "bg-sidebar-accent text-primary"
                  : item.highlight
                    ? "text-primary/80 bg-primary/8 hover:bg-primary/12 hover:text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
              style={{ borderRadius: 'var(--radius)' }}
            >
              {/* Collapsed, the label is gone and a number would have nothing to attach to — so the
                  badge degrades to a dot. Still says "there is something here", which is the whole
                  job of this affordance. */}
              <span className="relative shrink-0">
                <item.icon size={16} />
                {/* ⚠️ THE DOT NOW FOLLOWS THE RAIL'S WIDTH, NOT THE `collapsed` FLAG (Tre,
                    2026-09-15, ask 98830520 item 3: "the notification number on Transactions must
                    stay visible when compressed"). It was gated on `collapsed` alone, which is
                    FALSE at rest on any mouse — so in the narrow rail there was no dot AND no
                    number, and the only badge a mouse user ever had was one clipped out of sight.
                    See RAIL_ONLY for why the coarse-pointer case still rides on `collapsed`. */}
                {badge !== null && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      // ⚠️ `top-0 right-0`, NOT `-top-0.5 -right-0.5`. A `w-2` dot nudged half a
                      // step out of a 16px wrapper lands its right edge 2.3px OUTSIDE that
                      // wrapper - measured 2026-09-15 - and that is the other half of the
                      // horizontal scrollbar. Inside the wrapper it still reads as a corner
                      // marker, and it is the only nav icon box whose scrollWidth used to differ
                      // from its clientWidth.
                      'absolute top-0 right-0 w-2 h-2 bg-primary rounded-full',
                      !collapsed && RAIL_ONLY,
                    )}
                  />
                )}
              </span>
              {!collapsed && (
                <span className={cn('flex items-center gap-1.5 flex-1 min-w-0', RAIL_LABEL_FLEX)}>
                  <span className="truncate">{item.label}</span>
                  {item.highlight && !active && <Zap size={10} className="text-primary fill-primary shrink-0" />}
                  {badge !== null && (
                    <span
                      className="ml-auto text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 leading-none shrink-0"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {badge}
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-sidebar-border space-y-1">
        {showPartnerSwitch && (
          <button
            onClick={() => (isPartnerView ? switchBack() : switchTo(partnerUserId))}
            title={isPartnerView
              ? 'Stop viewing your partner and return to your own data'
              : `View ${partnerLabel ?? 'your partner'}'s budget, read only`}
            className={cn(
              'flex items-center gap-3 px-3 py-2 text-xs font-medium transition-colors w-full btn-press',
              isPartnerView
                ? 'text-primary bg-primary/8 hover:bg-primary/12'
                : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50',
            )}
            style={{ borderRadius: 'var(--radius)' }}
          >
            <Eye size={16} className="shrink-0" />
            {!collapsed && (
              <span className="truncate">
                {isPartnerView ? 'Back to my account' : `View ${partnerLabel ?? 'partner'}`}
              </span>
            )}
          </button>
        )}
        {/* A signed-in user looking at the reference account leaves it, they do not sign up for it
            — one predicate, `useDemoSession().isPreview`, shared with the banner and the mobile
            menu so the three cannot offer three different doors. */}
        {isPreview ? (
          <button
            onClick={leaveDemo}
            className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-full btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {!collapsed && <span className={cn('truncate', RAIL_LABEL)}>Back to my account</span>}
            {collapsed && <ArrowLeft size={16} className="shrink-0" />}
          </button>
        ) : isDemo ? (
          <>
            <Link
              to="/auth"
              className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-full btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {!collapsed && <span className={cn('truncate', RAIL_LABEL)}>Sign Up Free</span>}
              {collapsed && <Crown size={16} className="shrink-0" />}
            </Link>
            {!collapsed && (
              <Link
                to="/"
                className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Home size={16} className="shrink-0" />
                <span className={cn('truncate', RAIL_LABEL)}>Main Page</span>
              </Link>
            )}
          </>
        ) : (
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-destructive-text transition-colors w-full btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && <span className={cn('truncate', RAIL_LABEL)}>Sign Out</span>}
          </button>
        )}
      </div>
      </div>
    </aside>
  );
}
