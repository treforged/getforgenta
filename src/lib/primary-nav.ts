import { LayoutDashboard, ArrowLeftRight, Landmark, Car, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * THE PRIMARY NAVIGATION DESTINATIONS — ONE LIST, BOTH WIDTHS.
 *
 * Tre, 2026-09-15: *"regarding the desktop sidebar section matching mobile, that's for the
 * getforgenta app. The tabs or selections for the left side when it's on a bigger screen are
 * different from the selections when it's on mobile."* And earlier, naming the reference:
 * *"the desktop version with the left sidebar needs to match how it, the sectioning on the
 * mobile version"* — so MOBILE IS THE REFERENCE and the desktop rail reconciles to it.
 *
 * ⚠️ IT WAS AN INVENTORY MISMATCH, NOT STYLING, and it was measured rather than guessed. The
 * two components each declared their own array:
 *
 *     desktop rail   /dashboard "Dashboard" · /transactions · /debt "Debt Payoff" · /vehicles
 *                    · /ai (flag) · /settings · /premium "Upgrade"      → 7 declared
 *     mobile bar     /dashboard "Home"      · /transactions · /debt "Debt"       · /vehicles
 *                    · /account                                         → 5
 *
 * Three destinations existed only on desktop, one only on mobile, and two shared destinations
 * were called different things at different widths.
 *
 * ⚠️ TWO HAND-DECLARED LISTS CANNOT BE KEPT IN STEP BY A TEST THAT COMPARES THEM — this repo
 * already tried. `nav-routes.test.ts` compared `TAB_ROOT_PATHS` against `MobileNav`'s PRIMARY and
 * never looked at the rail, so when Forecast was removed from the bar and left in the rail, the
 * same destination existed twice for days. The fix is not a better comparison, it is ONE LIST
 * that both components map over, so the sets are equal BY CONSTRUCTION.
 * `src/lib/__tests__/nav-parity.gate.test.ts` then guards the only way back: either component
 * re-declaring destinations of its own.
 *
 * ⚠️ WHAT THE DESKTOP RAIL LOST, AND WHERE EACH ONE STILL LIVES — checked before removing, not
 * assumed, because a destination that is reachable from nowhere is a worse defect than a rail
 * that is too long:
 *   · `/settings` — the Account page links to it (`Account.tsx`), which is now IN this list at
 *     both widths. That is exactly how a phone has always reached Settings.
 *   · `/premium` — 17 in-app links, including every `PremiumGate` and the Forecast upsell, all of
 *     which render at every width. It was already conditional in the rail (hidden for demo and
 *     for premium users). ⚠️ SAID PLAINLY: this makes Upgrade less prominent on desktop than it
 *     was. That is the trade the ask asks for, and mobile has always been on the other side of it.
 *   · `/ai` — the advisor is MOUNTED on the Account page's "Forgenta AI" section, so it is reached
 *     at both widths. The `/ai` route itself had ZERO in-app links other than the rail row.
 */
export interface NavDestination {
  to: string;
  icon: LucideIcon;
  label: string;
  highlight?: boolean;
}

export const PRIMARY_NAV: readonly NavDestination[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  // "Transactions" since 2026-08-27 (Tre: "rename activity in the tab section to Transactions").
  // ONE name at every width — the phone bar carries the width trade that comes with the longer
  // word, and a label that renames itself on a resize is worse than a tight fit.
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/debt', icon: Landmark, label: 'Debt', highlight: true },
  // Accounts, Plan, Goals and Forecast are all PANELS of the surfaces above rather than
  // destinations of their own — Tre, 2026-08-18: "we need to reduce how many separate tabs".
  // Their old routes still resolve as redirects, so every bookmark still lands.
  { to: '/vehicles', icon: Car, label: 'Garage' },
  // Rightmost on the phone, and five is what a 320px SE holds; six is what breaks it.
  { to: '/account', icon: User, label: 'Account' },
];
