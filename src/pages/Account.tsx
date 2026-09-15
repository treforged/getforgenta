import { Link } from 'react-router';
import { User, Settings as SettingsIcon, Trophy } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useSupabaseData';
import { useFriendLink } from '@/hooks/useFriendLink';
import { usePersistedState } from '@/hooks/usePersistedState';
import PanelBar from '@/components/shared/PanelBar';
import { PartnerLink } from '@/components/settings/PartnerLink';
import { FriendLink } from '@/components/settings/FriendLink';
import { FriendsLeaderboard } from '@/components/settings/FriendsLeaderboard';

type AccountSection = 'profile' | 'leaderboard';

/**
 * ACCOUNT — who you are and who you are connected to, promoted to a tab of its own.
 *
 * Tre, 2026-09-12: "profile should be a new tab located to the right side, which would represent...
 * or I guess that would be account in this instance, and that would also have the location on, like,
 * the friends list. Make it easier to locate, also partner linking and more things that should be
 * user accessible and easy to find that are not currently. That should also be the location of the
 * leaderboard."
 *
 * Tre, 2026-09-15: the leaderboard gets its own SECTION inside this tab, reached by a top bar that
 * switches sections — "the pattern the app already uses". It does, and this page was the only main
 * surface not using it: `PanelBar` already owns the track on seven others, so this adds a CALLER and
 * not a second implementation. Which is the whole point of that rule — the same control, behaving
 * the same way, so nobody has to learn this screen separately.
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
 *
 * ⚠️ THE HEADER STAYS OUTSIDE THE SECTIONS, deliberately. Who you are is not one of the two things
 * you are choosing between — moving it inside "Profile" would make your own name disappear the
 * moment you opened the leaderboard, which reads as having navigated away from your account rather
 * than to a section of it.
 */
export default function Account() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { friends } = useFriendLink();
  const [section, setSection] = usePersistedState<AccountSection>('account-section', 'profile');

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

      {/* Same markup, same classes and the same inline radius as the other seven surfaces. The
          track is glass (`seg-track` carries the backdrop-filter), so it takes its tint from
          whatever scrolls under it — see `@utility glass` in src/index.css for why that is the
          honest form of the effect Tre asked for and why the reel's own package cannot be used. */}
      <PanelBar>
        <button onClick={() => setSection('profile')}
          aria-selected={section === 'profile'}
          role="tab"
          className={`seg-item btn-press ${section === 'profile' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <User size={13} /> Profile
        </button>
        <button onClick={() => setSection('leaderboard')}
          aria-selected={section === 'leaderboard'}
          role="tab"
          className={`seg-item btn-press ${section === 'leaderboard' ? 'seg-item-active' : ''}`}
          style={{ borderRadius: 'var(--radius)' }}>
          <Trophy size={13} /> Leaderboard
        </button>
      </PanelBar>

      {section === 'profile' ? (
        <div className="card-forged p-5 space-y-5">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</h2>
          <PartnerLink />
          <div className="border-t border-border" />
          <FriendLink />
        </div>
      ) : (
        /*
          ⚠️ RENDERED UNCONDITIONALLY, unlike its other mount. `FriendLink` gates this behind
          `friends.length > 0` — defensible there, because a board among controls you have not used
          yet is clutter. Here it is the reason the section exists, so hiding it until you already
          have friends would recreate exactly the invisibility Tre reported.
        */
        <div className="card-forged p-5 space-y-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Trophy size={12} className="text-primary" /> Leaderboard
          </h2>
          <FriendsLeaderboard friends={friends} />
        </div>
      )}
    </div>
  );
}
