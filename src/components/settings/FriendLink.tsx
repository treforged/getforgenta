import { useState } from 'react';
import { SettingsSectionHeading } from './SettingsSection';
import { useLocation } from 'react-router';
import { UserPlus, Loader2, CheckCircle, UserMinus } from 'lucide-react';
import { useDemo } from '@/contexts/DemoContext';
import { useFriendLink } from '@/hooks/useFriendLink';
import { LeaderboardShareToggles } from './LeaderboardShareToggles';
import { FriendsLeaderboard } from './FriendsLeaderboard';
import { UsernameClaim } from './UsernameClaim';
import { format } from 'date-fns';

/**
 * Friend links, from Settings (docs/friends-leaderboard-plan.md §4 Phase 1).
 *
 * Deliberately the PartnerLink card's twin in look and behaviour, and its
 * opposite in what it grants: a friend gets NO view of anybody's budget. The
 * only thing a friendship can ever surface is a rounded weekly bucket the owner
 * opted into publishing (plan §2, arriving in Phase 2), so the copy here says
 * so rather than leaving the reader to assume the partner rules apply.
 *
 * Free tier, capped server-side — there is no premium gate on this card, which
 * is why it has no Upgrade branch. Hitting the cap is the function's 403, shown
 * verbatim in a toast, so the number lives in exactly one place.
 *
 * Invite and accept go through the `friend-link` Edge Function; REMOVE is a
 * direct RLS-scoped update so leaving works even when functions are down. The
 * invite email's accept URL lands on `/settings?friend_code=…`, so the code
 * field pre-fills itself from the query string.
 *
 * Demo renders a static description with no buttons: the Edge Function requires
 * a real JWT, so a live form would be a dead button.
 */
export function FriendLink() {
  const { isDemo } = useDemo();
  const { search } = useLocation();
  const {
    loading, error, refetch, friends, pendingInvites, namesUnavailable,
    invite, accept, revoke,
  } = useFriendLink();

  const [email, setEmail] = useState('');
  // The invite email's accept link lands here with the code in the query string.
  const [code, setCode] = useState(
    () => new URLSearchParams(search).get('friend_code') ?? '',
  );

  // Heading AND blurb together, from the one shared implementation. `blurb` is kept as a separate
  // name because several branches below render it on its own; it is now empty for those, since the
  // header already carries it and printing it twice is what "symmetry" is not.
  const header = (
    <SettingsSectionHeading
      icon={UserPlus}
      title="Friends"
      description="Add friends to cheer each other on. Friends never see your budget, your accounts or any dollar amount — only the rounded progress you choose to share. Either of you can remove the other at any time."
    />
  );

  const blurb = null;

  // Demo: a static teaser, no dead buttons.
  if (isDemo) {
    return (
      <div className="space-y-3">
        {header}
        {blurb}
        <p className="text-xs text-muted-foreground italic">
          Sign up to add friends and compare progress.
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

  // An honest failure state: a card that could not read the friend list must say
  // so, not render the empty "no friends" case over an unknown truth.
  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-xs text-muted-foreground">
          Could not load your friends.
        </p>
        <button
          onClick={refetch}
          className="px-2.5 py-1 text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors btn-press"
          style={{ borderRadius: 'var(--radius)' }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}
      {blurb}

      {friends.length > 0 && (
        <div className="space-y-2">
          {friends.map(friend => (
            <div
              key={friend.linkId}
              className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <CheckCircle size={12} className="text-primary shrink-0" />
                <p className="text-xs font-medium truncate">{friend.label}</p>
              </div>
              <button
                onClick={() => revoke.mutate({ id: friend.linkId, exFriendUserId: friend.userId, kind: 'link' })}
                disabled={revoke.isPending}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press disabled:opacity-50 shrink-0 rounded-nested-2"
              >
                {revoke.isPending ? <Loader2 size={10} className="animate-spin" /> : <UserMinus size={10} />}
                Remove
              </button>
            </div>
          ))}
          {/* A name we could not read is not a name we may invent — say which it is. */}
          {namesUnavailable && (
            <p className="text-xs text-muted-foreground italic">
              Friends' names couldn't be loaded right now, so they're shown by the
              address you invited.
            </p>
          )}
        </div>
      )}

      {pendingInvites.map(pending => (
        <div
          key={pending.id}
          className="flex items-center justify-between bg-secondary/40 border border-border px-3 py-2.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium truncate">Invite sent to {pending.invitee_email}</p>
            <p className="text-xs text-muted-foreground">
              Expires {format(new Date(pending.expires_at), 'MMM d, yyyy')}. They accept
              from the email, signed in with that address.
            </p>
          </div>
          <button
            onClick={() => revoke.mutate({ id: pending.id, exFriendUserId: null, kind: 'invite' })}
            disabled={revoke.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors btn-press disabled:opacity-50 shrink-0 rounded-nested-2"
          >
            {revoke.isPending ? <Loader2 size={10} className="animate-spin" /> : null}
            Cancel invite
          </button>
        </div>
      ))}

      {friends.length === 0 && pendingInvites.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No friends yet.</p>
      )}

      {/* ⚠️ YOUR OWN HANDLE FIRST, BECAUSE IT IS THE HALF THAT LETS SOMEBODY ADD *YOU*.
          Tre, 2026-09-13: "maybe we should do usernames instead or make that an option to add
          people by usernames." The validator, the migration and the unique index shipped in
          `a787279c` and had NO CALLER anywhere in `src/` until this mount — a foundation nobody
          could reach is indistinguishable from one that was never built. */}
      <UsernameClaim />

      {/* The two ways in, kept together and directly under the list they add to. */}
      <h4 className="text-xs font-semibold pt-1">Add a friend</h4>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Friend's email address"
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

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Have a friend invite code? Paste it here"
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

      {/* ── What friends can see, and the board itself ───────────────────────────────────
          ⚠️ MOVED BELOW THE INVITE FIELDS ON PURPOSE (Tre, 2026-09-13): "we need to keep, like,
          the friends and, uh, email address slash invite code, put that above." They used to sit
          between the friend list and the two inputs, which split one task — see who you are
          connected to, then connect to someone else — across the whole card with two unrelated
          panels in the middle. Adding a friend is the thing a person comes here to DO; the
          sharing switches are what they adjust afterwards.

          The headings are the other half of "it's not formatted well, honestly": before this the
          card was six visually identical rows with no grouping, so the switches read as more
          friends and the board read as more switches. Rendered only once a friendship exists,
          which is unchanged — switches that publish to nobody are a control that appears to do
          nothing. */}
      {friends.length > 0 && (
        <div className="space-y-3 pt-1 border-t border-border/60">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold pt-2">What friends can see</h4>
            <LeaderboardShareToggles />
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold">Leaderboard</h4>
            <FriendsLeaderboard friends={friends} />
          </div>
        </div>
      )}
    </div>
  );
}
