import { useState } from 'react';
import { useLocation, Link } from 'react-router';
import { Users, Loader2, CheckCircle, Unlink, Crown } from 'lucide-react';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { usePartnerLink } from '@/hooks/usePartnerLink';
import { format } from 'date-fns';

/**
 * Partner linking, from Settings (docs/partner-linking-design.md §1, §4 Phase 1).
 *
 * The card is one of five honest states: demo teaser, loading, could-not-load,
 * active link, pending invite, or the two entry forms (invite by email, accept by
 * code). Invite and accept go through the `partner-link` Edge Function; UNLINK is a
 * direct RLS-scoped update so leaving works even when functions are down. The invite
 * email's accept URL lands on `/settings?partner_code=…`, so the code field pre-fills
 * itself from the query string.
 *
 * Demo renders a static description with no buttons: the Edge Function requires a
 * real premium JWT, so a live form would be a dead button (design §5).
 */
export function PartnerLink() {
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  const { search } = useLocation();
  const {
    loading, error, refetch, activeLink, pendingInvite, partnerUserId, partnerLabel,
    invite, accept, revoke,
  } = usePartnerLink();

  const [email, setEmail] = useState('');
  // The invite email's accept link lands here with the code in the query string.
  const [code, setCode] = useState(
    () => new URLSearchParams(search).get('partner_code') ?? '',
  );

  const header = (
    <div className="flex items-center gap-2">
      <Users size={13} className="text-muted-foreground" />
      <span className="text-xs font-medium">Partner Link</span>
    </div>
  );

  // Demo: a static teaser, no dead buttons (design §5).
  if (isDemo) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-[10px] text-muted-foreground">
          Premium members can link with a partner and view each other's budget, read only.
          Nobody can edit anybody else's money, and either of you can unlink at any time.
        </p>
        <p className="text-xs text-muted-foreground italic">
          Sign up and upgrade to Premium to link with your partner.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {header}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  // An honest failure state: a card that could not read the link must say so, not
  // render the "no link" forms over an unknown truth.
  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-xs text-muted-foreground">
          Could not load your partner link status.
        </p>
        <button
          onClick={refetch}
          className="px-2.5 py-1 text-[10px] font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (activeLink) {
    return (
      <div className="space-y-3">
        {header}
        <div
          className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle size={12} className="text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">
                Linked with {partnerLabel ?? 'your partner'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Use "View partner" in the menu to see their budget, read only.
              </p>
            </div>
          </div>
          <button
            onClick={() => revoke.mutate({ id: activeLink.id, exPartnerUserId: partnerUserId, kind: 'link' })}
            disabled={revoke.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press disabled:opacity-50 shrink-0"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {revoke.isPending ? <Loader2 size={10} className="animate-spin" /> : <Unlink size={10} />}
            Unlink
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Unlinking takes effect immediately for both of you and needs no confirmation
          from the other side.
        </p>
      </div>
    );
  }

  if (pendingInvite) {
    return (
      <div className="space-y-3">
        {header}
        <div
          className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">Invite sent to {pendingInvite.invitee_email}</p>
            <p className="text-[10px] text-muted-foreground">
              Expires {format(new Date(pendingInvite.expires_at), 'MMM d, yyyy')}. They accept
              from the email, signed in with that address.
            </p>
          </div>
          <button
            onClick={() => revoke.mutate({ id: pendingInvite.id, exPartnerUserId: null, kind: 'invite' })}
            disabled={revoke.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press disabled:opacity-50 shrink-0"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {revoke.isPending ? <Loader2 size={10} className="animate-spin" /> : null}
            Cancel invite
          </button>
        </div>
      </div>
    );
  }

  // No link, no pending invite: the two ways in.
  return (
    <div className="space-y-3">
      {header}
      <p className="text-[10px] text-muted-foreground">
        Link with a partner to view each other's budget, read only. Nobody can edit
        anybody else's money, and either of you can unlink at any time.
      </p>

      {isPremium ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Partner's email address"
            className="w-full sm:flex-1 min-w-0 bg-secondary border border-border px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            style={{ borderRadius: 'var(--radius)' }}
          />
          <button
            onClick={() => invite.mutate(email)}
            disabled={invite.isPending || !email.trim()}
            className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {invite.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
            {invite.isPending ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          <Crown size={12} className="inline text-primary mr-1" />
          Inviting a partner is a Premium feature.{' '}
          <Link to="/premium" className="text-primary hover:underline">Upgrade</Link>
          {' '}to send an invite. If your partner has Premium, they can invite you and
          you accept below for free.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Have an invite code? Paste it here"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full sm:flex-1 min-w-0 bg-secondary border border-border px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
          style={{ borderRadius: 'var(--radius)' }}
        />
        <button
          onClick={() => accept.mutate(code)}
          disabled={accept.isPending || !code.trim()}
          className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-secondary border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {accept.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
          {accept.isPending ? 'Checking…' : 'Accept Invite'}
        </button>
      </div>
    </div>
  );
}
