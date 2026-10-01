import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';
import { useDemo } from '@/contexts/DemoContext';
import { useAccounts } from '@/hooks/useSupabaseData';
import { isCardOpenAsOf } from '@/lib/card-start-date';

/** Where the balances are typed in: the Dashboard's Accounts panel, Balances view. */
export const UPDATE_BALANCES_HREF = '/dashboard?tab=accounts&panel=balances';

/**
 * The start-of-month nudge to bring balances up to date (1st-7th).
 *
 * ⚠️ IT ONLY EVER MEANT THE ACCOUNTS THAT DO NOT AUTO-SYNC, and until 2026-09-02 it did not say
 * so. Tre saw it on the 2nd with EIGHT linked banks and asked for exactly this: "we need to
 * clarify in the notice for unlinked accounts."
 *
 * Telling someone to hand-update an account Plaid refreshes every morning is worse than saying
 * nothing. It invites them to type a number over a synced one, which is how a balance ends up
 * wrong in the direction the app itself caused - and it makes the honest half of the message
 * (the accounts that genuinely are stale) easy to ignore.
 *
 * So the notice now NAMES the accounts it means, and RENDERS NOTHING when every active account
 * is linked. A reminder with no action behind it is noise.
 *
 * `!plaid_account_id && active` is the same test `Accounts.tsx` uses for its own manual-accounts
 * list, deliberately - two definitions of "unlinked" would drift.
 *
 * A card with a FUTURE `card_start_date` is not open yet, so it has no balance to update and is
 * left out (Tre, 2026-10-01: Venture X and Apple Card were listed while dated 2028).
 * The notice body is a link to the place the balances are typed in (Tre, same day: notices
 * "need to be clickable to take them to the page that would solve whatever is on it").
 */
export default function AccountUpdateReminder() {
  const { isDemo } = useDemo();
  const { data: accounts } = useAccounts();
  const [dismissed, setDismissed] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const dismissedKey = localStorage.getItem('account-update-reminder-dismissed');

    // Show if: (1) not demo, (2) it's 1st-7th of month, (3) not dismissed this month yet
    if (!isDemo && dayOfMonth >= 1 && dayOfMonth <= 7 && dismissedKey !== monthKey) {
      // One-shot visibility decision from two external systems — the wall clock
      // and localStorage. Deriving it during render instead would mean reading
      // both on every render, which is the impurity the sibling rule forbids.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShouldShow(true);
    }
  }, [isDemo]);

  const handleDismiss = () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
    localStorage.setItem('account-update-reminder-dismissed', monthKey);
    setDismissed(true);
  };

  const today = new Date();
  const manual = (accounts ?? []).filter(a => !a.plaid_account_id && a.active && isCardOpenAsOf(a, today));
  const linkedCount = (accounts ?? []).filter(a => a.plaid_account_id && a.active).length;

  if (!shouldShow || dismissed) return null;
  // Nothing to do by hand: every active account updates itself. Saying so would be noise, and
  // asking for an update that is not needed is worse than noise.
  if (manual.length === 0) return null;

  const names = manual.map(a => a.name).join(', ');

  return (
    <div
      className="mb-4 p-4 border-2 border-gold/50 bg-gold/10 flex items-start gap-3"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <AlertTriangle className="text-gold shrink-0 mt-0.5" size={20} />
      <Link to={UPDATE_BALANCES_HREF} className="flex-1 min-w-0 hover:opacity-90 transition-opacity">
        <h3 className="font-semibold text-sm mb-1">
          {manual.length === 1 ? 'One account needs updating by hand' : `${manual.length} accounts need updating by hand`}
        </h3>
        <p className="text-xs text-muted-foreground">
          It's the start of a new month. {manual.length === 1 ? 'This account does' : 'These accounts do'} not
          auto-sync, so {manual.length === 1 ? 'its balance is' : 'their balances are'} only as current as the
          last time you typed {manual.length === 1 ? 'it' : 'them'} in: <strong>{names}</strong>.
          {linkedCount > 0 && (
            <> Your {linkedCount} linked {linkedCount === 1 ? 'account' : 'accounts'} update
            {linkedCount === 1 ? 's' : ''} on {linkedCount === 1 ? 'its' : 'their'} own — leave {linkedCount === 1 ? 'it' : 'them'} alone.</>
          )}
        </p>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold">
          Update balances <ChevronRight size={14} aria-hidden="true" />
        </span>
      </Link>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
