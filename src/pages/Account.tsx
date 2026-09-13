import { Link } from 'react-router';
import { User, Settings as SettingsIcon, Trophy } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useSupabaseData';
import { useFriendLink } from '@/hooks/useFriendLink';
import { PartnerLink } from '@/components/settings/PartnerLink';
import { FriendLink } from '@/components/settings/FriendLink';
import { FriendsLeaderboard } from '@/components/settings/FriendsLeaderboard';

/**
 * ACCOUNT — who you are and who you are connected to, promoted to a tab of its own.
 *
 * Tre, 2026-09-12: "profile should be a new tab located to the right side, which would represent...
 * or I guess that would be account in this instance, and that would also have the location on, like,
 * the friends list. Make it easier to locate, also partner linking and more things that should be
 * user accessible and easy to find that are not currently. That should also be the location of the
 * leaderboard."
 *
 * ⚠️ THE LEADERBOARD WAS NEVER MISSING — IT WAS FOUR LEVELS DEEP AND CONDITIONAL. `FriendsLeaderboard`
 * has existed, wired and tested, rendering from `FriendLink.tsx` behind `friends.length > 0`, inside
 * the Connections card, inside the Settings Account panel. So a user who wanted to SEE a leaderboard
 * had no path to one, and a user with no friends saw no hint it existed. "Get that created ASAP" was
 * a reasonable inference from a real symptom, and building a second one would have been the expensive
 * answer. It is surfaced here instead, unconditionally — its own "nobody is sharing yet" empty state
 * is better than absence, which is the whole reason that state was written.
 *
 * ⚠️ AND THIS DOES NOT DUPLICATE THE SETTINGS PANEL. Partner linking and friends still live under
 * Settings -> Account as the place you MANAGE them; this is the place you LOOK at them. The
 * components are the same ones, mounted twice, so there is no second implementation to drift.
 */
export default function Account() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { friends } = useFriendLink();

  return (
    <div className="py-4 lg:py-6 max-w-2xl mx-auto stack-section overflow-x-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <User size={20} className="text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg tracking-tight truncate">
              {profile?.display_name || 'Your account'}
            </h1>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        {/* Everything editable still lives in Settings. This tab is for finding things, not for
            growing a second copy of every control — which is how two screens start disagreeing. */}
        <Link
          to="/settings"
          className="btn btn-md btn-secondary shrink-0"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <SettingsIcon size={12} /> Settings
        </Link>
      </div>

      <div className="card-forged p-5 space-y-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</h2>
        <PartnerLink />
        <div className="border-t border-border" />
        <FriendLink />
      </div>

      {/*
        ⚠️ RENDERED UNCONDITIONALLY, unlike its other mount. `FriendLink` gates this behind
        `friends.length > 0` — defensible there, because a board among controls you have not used
        yet is clutter. Here it is the reason the tab exists, so hiding it until you already have
        friends would recreate exactly the invisibility Tre reported.
      */}
      <div className="card-forged p-5 space-y-4">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Trophy size={12} className="text-primary" /> Leaderboard
        </h2>
        <FriendsLeaderboard friends={friends} />
      </div>
    </div>
  );
}
