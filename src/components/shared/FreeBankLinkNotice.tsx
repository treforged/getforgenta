import { useState } from 'react';
import { Link } from 'react-router';
import { Landmark, X } from 'lucide-react';
import { useDemo } from '@/contexts/DemoContext';
import { useAccounts } from '@/hooks/useSupabaseData';

/**
 * "Your first bank connection is free" - shown in-app to somebody who has never linked one.
 *
 * ⚠️ **WHAT THIS REACHES, AND WHAT IT CANNOT.** It fires when a signed-in user OPENS the app. It
 * therefore cannot cause a dormant user to return: a person who never opens it never sees this,
 * exactly as they never receive a push (a push token is only minted on open, so the 23 dormant
 * accounts have none). **This makes a return worth something. It does not produce one.** Saying
 * that plainly here because "shipped" and "reaches the people it was meant to" are different
 * claims, and conflating them is the failure this repo keeps finding.
 *
 * **WHY IT EXISTS AT ALL, given the app already says it.** `Accounts.tsx` carries "Your first bank
 * is free" in a grey subheading on the Accounts page. Measured 2026-09-06: bank linking was
 * premium-gated, so the only 2 of 31 accounts that ever linked a bank did it because they ALREADY
 * had premium, and 29 were asked for $89.99 for a sync they had never seen work on their own
 * money. The gate moved to the second link on 2026-09-06. **Those 29 people have no reason to know
 * that**, and a line on a page they never open is not how they find out. This is the same true
 * claim, put where a returning user lands.
 *
 * ⚠️ **THE CLAIM IS WIRED BUT UNEXERCISED.** `free_bank_link_grants` holds ZERO rows, so the free
 * path has never run in production - the two existing linkers predate it and were premium. The
 * entitlement is imported by all four link functions (`plaid-create-link-token`,
 * `plaid-exchange-token`, `akoya-auth-url`, `akoya-exchange-token`), so it is not unbuilt; it is
 * untested against a real bank. **Verify with one real link before trusting this notice**, because
 * a notice that promises something the first user then cannot do is worse than no notice.
 *
 * Renders NOTHING for anyone who already has a linked account - the same discipline as
 * `AccountUpdateReminder`: a prompt with no action behind it is noise. Dismissal is permanent per
 * device rather than per month, because unlike a stale balance this does not come back.
 */

const DISMISSED_KEY = 'free-bank-link-notice-dismissed';

export default function FreeBankLinkNotice() {
  const { isDemo } = useDemo();
  const { data: accounts, loading } = useAccounts();
  const [dismissed, setDismissed] = useState(false);
  // A LAZY INITIALISER rather than an effect, so the store is read exactly once at mount instead of
  // on every render, and without the `set-state-in-effect` suppression the sibling component needs.
  //
  // localStorage can throw outright (private windows, blocked site data), and a notice that crashes
  // the dashboard is far worse than one that never shows. The catch defaults to DISMISSED, so an
  // unreadable store hides the notice rather than showing it on every single load forever.
  const [everDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return true;
    }
  });

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Nothing to do: it stays hidden for this session either way.
    }
    setDismissed(true);
  };

  if (isDemo || dismissed || everDismissed) return null;

  // ⚠️ Wait for the real answer. Showing this while accounts are still loading would flash
  // "you have never linked a bank" at somebody who has eight, which is a confident wrong claim
  // about their own money - the same shape as rendering an absent value as zero.
  if (loading) return null;

  const linked = (accounts ?? []).filter((a) => a.plaid_account_id && a.active);
  if (linked.length > 0) return null;

  return (
    <div
      className="mb-4 p-4 border-2 border-primary/40 bg-primary/5 flex items-start gap-3"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <Landmark className="text-primary shrink-0 mt-0.5" size={20} />
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm mb-1">Your first bank connection is free</h3>
        <p className="text-xs text-muted-foreground">
          Connect one account and your balances and transactions update on their own, with no
          subscription. Premium is for connecting more than one.
        </p>
        <Link
          to="/accounts"
          className="inline-block mt-2 px-2.5 py-1 text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Connect a bank
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  );
}
