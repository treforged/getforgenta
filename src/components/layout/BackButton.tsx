import { useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { backTarget, historyIndex } from '@/lib/nav-back';

/**
 * THE WAY OUT OF A PUSHED SCREEN.
 *
 * ⚠️ THERE WAS NONE UNTIL 2026-09-06. Item 3 of `docs/navigation-jakobs-law.md`. Settings, the AI
 * advisor and Premium are reachable only from the drawer, and once there the chrome offered no way
 * back: the bottom bar goes to a TAB, which is a different place rather than the place you came
 * from. Android has the OS gesture and iOS has an edge swipe the app never signals, so on iOS the
 * only exit was one nobody was told about.
 *
 * ── IT REPLACES THE IDENTITY BADGE RATHER THAN SITTING BESIDE IT, AND THAT IS MEASURED ──────
 * ⚠️ At 390px the centred wordmark starts at **x=110** and the identity badge ends at **x=90** —
 * a **19px** gap, measured in a same-origin iframe on 2026-09-06. A 44px control does not fit
 * there, so stacking the two was not a taste question; it was impossible. The corner shows BACK
 * where there is something to go back from and IDENTITY otherwise.
 * ⚠️ Nothing is lost by the swap: the pushed screens are Settings, the AI advisor and Premium, and
 * Settings is itself where the account lives. Constraint 1 of that document is about a page no
 * longer holding an answer it used to hold — this moves one control between two states of one
 * corner, and the identity is one tap away in both.
 *
 * ── BACK GOES THROUGH THE ROUTER, AND A FRESH ENTRY IS THE CASE THAT BREAKS ──
 * ⚠️ `history.back()` on a deep link — a push notification, a pasted URL, the native shell's first
 * screen — leaves the APP rather than returning to the previous screen, because there is no
 * previous screen in this history. `nav-back.ts` reads react-router's own `idx` and falls back to
 * the dashboard, so the control always lands somewhere inside the app.
 * ⚠️ It also has to be a real router navigation for rule 8 (`0982aa18`): scroll position is
 * restored on POP, and `navigate(-1)` produces one.
 */
export default function BackButton() {
  const navigate = useNavigate();
  const target = backTarget(historyIndex());

  return (
    <button
      onClick={() => { if (typeof target === 'number') navigate(target); else navigate(target); }}
      aria-label="Back"
      className="flex items-center justify-center min-w-[44px] min-h-[44px] -my-0.5 text-muted-foreground hover:text-foreground transition-colors btn-press"
    >
      <ChevronLeft size={20} />
    </button>
  );
}
