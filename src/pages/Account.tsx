import { Link, useLocation } from 'react-router';
import { lazy, Suspense, useEffect } from 'react';
import { User, Settings as SettingsIcon, Trophy, Sparkles, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useSupabaseData';
import { useFollows } from '@/hooks/useFollows';
import { usePersistedState } from '@/hooks/usePersistedState';
import PanelBar from '@/components/shared/PanelBar';
import { PartnerLink } from '@/components/settings/PartnerLink';
import { FriendsLeaderboard } from '@/components/settings/FriendsLeaderboard';
import { FollowersPanel } from '@/components/settings/FollowersPanel';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

/**
 * ⚠️ `lazy`, NOT A STATIC IMPORT, and for the same reason `App.tsx` does it. A static import here
 * would pull the advisor into the Account chunk for every user - including every production user,
 * where the feature is deliberately OFF - which is the opposite of what the gate is for.
 */
const AiAdvisor = lazy(() => import('./AiAdvisor'));

type AccountSection = 'profile' | 'followers' | 'leaderboard' | 'ai';

/**
 * ⚠️ THE AI SECTION IS GATED ON THE SAME FLAG AS THE `/ai` ROUTE, and that is not a formality.
 *
 * Tre asked for the advisor to sit in this tab after the Leaderboard section (2026-09-15).
 * `AI_ADVISOR_ENABLED` is `import.meta.env.DEV`, so it is FALSE in every shipped build while the
 * data-sharing policy and the account-level controls are unfinished - see `feature-flags.ts`.
 * Mounting `AiAdvisor` reads the user's transactions, debts, goals, accounts and car funds and
 * forwards them to the `ai-advisor` edge function, so putting it on this page UNGATED would ship
 * that data flow ahead of the policy that is supposed to govern it. It is the same gate, read from
 * the same constant, so flipping that one line turns this on too and nothing here needs revisiting.
 *
 * In production the bar therefore has TWO segments, exactly as before. It is NOT a tab that renders
 * an "unavailable" screen: a dead tab that throws nothing and does nothing passes every smoke test
 * ever written, and this portfolio has shipped one before.
 */
const SECTION_AVAILABLE: Readonly<Record<AccountSection, boolean>> = {
  profile: true,
  followers: true,
  leaderboard: true,
  ai: AI_ADVISOR_ENABLED,
};

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
  /**
   * ⚠️ THE LEADERBOARD NOW RANKS **MUTUAL FOLLOWS**, not friend_links (Tre, 2026-09-17).
   * `mutuals` is only the people who follow you back, which is the same bilateral consent
   * `friend_links` carried - see the migration for why a one-directional follow is not enough.
   * Legacy friend links still count, on the server side, inside `active_friend_ids()`.
   */
  const { mutuals } = useFollows();
  const [section, setSection] = usePersistedState<AccountSection>('account-section', 'profile');
  // A stored section can outlive its availability: choose `ai` in development, build for
  // production, and the persisted value names a section that no longer has a segment. Reading it
  // back unchecked would leave the bar with nothing selected while a body rendered underneath.
  const activeSection: AccountSection = SECTION_AVAILABLE[section] ? section : 'profile';

  /**
   * ⚠️ AN INVITE EMAIL LANDS HERE, AND THE SECTION IS PERSISTED, SO ARRIVING IS NOT ENOUGH.
   *
   * `friend-link` and `partner-link` mail an accept URL carrying `?friend_code=` / `?partner_code=`.
   * `FriendLink` and `PartnerLink` read that param themselves and pre-fill the code field — but
   * `account-section` remembers whatever the user last chose, so somebody whose last section was
   * Leaderboard would land on a pre-filled field they never see. That is the exact defect
   * `Settings.tsx` recorded and fixed for its own tabs on 2026-09-12: **the pre-fill worked and was
   * invisible, which is why nothing ever reported it as broken.**
   *
   * Deliberately NOT keyed on `section` — it must fire when the recipient ARRIVES on the link, and
   * never again while they click around afterwards.
   */
  const { search } = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('friend_code') || params.get('partner_code')) setSection('profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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
            growing a second copy of every control — which is how two screens start disagreeing.

            ⚠️ DESKTOP ONLY, AND REMOVING THE BREAKPOINT STRANDS SETTINGS ENTIRELY AT THAT WIDTH.
            On a phone, Settings is reached through the hamburger on this tab (Tre, 2026-09-16:
            "you can only get there from the hamburger page"), so a second button here is the
            duplication he was reporting. But `primary-nav.ts` records that THE DESKTOP RAIL HAS NO
            SETTINGS ROW - it was dropped deliberately, on the stated reasoning that "the Account
            page links to it". That link is this one. The hamburger is `lg:hidden`, so deleting
            this outright would leave desktop with no route to Settings at all.
            `settings-reachable.gate.test.ts` holds both widths. */}
        <Link
          to="/settings"
          className="hidden lg:inline-flex btn btn-md btn-secondary shrink-0"
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
          aria-selected={activeSection === 'profile'}
          role="tab"
          className={`seg-item btn-press ${activeSection === 'profile' ? 'seg-item-active' : ''}`}>
          <User size={13} /> Profile
        </button>
        {/* Followers sits between Profile and Leaderboard: it is who you are connected to, which
            is nearer "who you are" than "how you compare". Same seg-item markup as every other
            surface - this adds a CALLER to PanelBar, never a second implementation. */}
        <button onClick={() => setSection('followers')}
          aria-selected={activeSection === 'followers'}
          role="tab"
          className={`seg-item btn-press ${activeSection === 'followers' ? 'seg-item-active' : ''}`}>
          <Users size={13} /> Followers
        </button>
        <button onClick={() => setSection('leaderboard')}
          aria-selected={activeSection === 'leaderboard'}
          role="tab"
          className={`seg-item btn-press ${activeSection === 'leaderboard' ? 'seg-item-active' : ''}`}>
          <Trophy size={13} /> Leaderboard
        </button>
        {SECTION_AVAILABLE.ai && (
          <button onClick={() => setSection('ai')}
            aria-selected={activeSection === 'ai'}
            role="tab"
            className={`seg-item btn-press ${activeSection === 'ai' ? 'seg-item-active' : ''}`}>
            <Sparkles size={13} /> Forgenta AI
          </button>
        )}
      </PanelBar>

      {activeSection === 'profile' && (
        <div className="card-forged p-5 space-y-5">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connections</h2>
          {/*
            ⚠️ THE FRIENDS CARD IS GONE FROM HERE (Tre, 2026-09-17: "friends should be followers
            and following just like instagram. it should only be on that tab"). Adding people,
            the people themselves, and what they can see all live in the FOLLOWERS section now -
            one surface, the way Instagram has one.

            ⚠️ PARTNER LINKING STAYS, AND IT IS NOT THE SAME THING. A partner shares a BUDGET -
            one set of numbers, edited by two people, with a viewing lens. A follow is a
            one-directional social connection that shares nothing by itself. Folding the two
            together would be the one merge this change must not make.
          */}
          <PartnerLink />
        </div>
      )}

      {activeSection === 'followers' && (
        /*
          ⚠️ THE PUBLIC/PRIVATE SWITCH IS NOT IN THIS SECTION, AND THAT IS DELIBERATE. It lives in
          the Connections card (`FriendLink` -> `AccountVisibilityToggle`), beside the sharing
          toggles it belongs with - which is the PROFILE section of this tab AND the Account panel
          in Settings, because that card is mounted in both.

          ONE IMPLEMENTATION, TWO MOUNTS. That is this page's existing pattern, recorded above for
          PartnerLink and FriendLink, and it is the reason there is nothing here to drift out of
          step. A second copy of the switch on this section is exactly how two screens start
          disagreeing about a privacy setting.
        */
        <FollowersPanel currentUserId={user?.id} />
      )}

      {activeSection === 'leaderboard' && (
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
          <FriendsLeaderboard friends={mutuals} />
        </div>
      )}

      {/*
        ⚠️ THE FALLBACK DELIBERATELY DOES NOT SAY "Forgenta AI". `check:account` asserts that
        marker to prove the lazy chunk actually MOUNTED; if the fallback carried the same words, a
        section still loading would satisfy the check and a chunk that never arrived would read as
        a working section.
      */}
      {activeSection === 'ai' && (
        <Suspense fallback={<div className="card-forged p-5 text-sm text-muted-foreground">Loading...</div>}>
          <AiAdvisor />
        </Suspense>
      )}
    </div>
  );
}
