// What changed, for someone who was already using the app.
//
// Tre, 2026-09-13: "also start adding a popup for already logged in users to describe what changed.
// keep it consumer friendly. they dont need detailed explanations."
//
// ⚠️ HIS CONSTRAINT IS THE DESIGN, NOT A STYLE NOTE. Every line below is what the change DOES FOR
// THEM, in the words they would use. Not a changelog, not a commit subject, and never the cause —
// "Your sharing switches now save" rather than anything about a column-level grant. A person who
// opens this to find engineering has learned to dismiss the next one unread.
//
// ⚠️ ONLY WHAT A USER CAN NOTICE. A release with nothing visible gets NO entry rather than a padded
// one; `RELEASES` may legitimately skip a version. Padding is the fastest way to make this ignored.
//
// ⚠️ AND NOTHING THAT IS NOT TRUE YET. This app already carries one notice announcing a path that
// has never run in production (the free first bank link). A second claim of that shape would teach
// people that what this popup says is aspirational.

export interface Release {
  /** Compared as an opaque string, never parsed — see `shouldShowWhatsNew`. */
  version: string;
  /** One line per change, in the user's language. Keep to a handful; this is not a log. */
  lines: readonly string[];
}

/**
 * Newest first. The FIRST entry is the current release.
 *
 * ⚠️ EACH LINE IS A PROMISE THE APP ALREADY KEEPS. Everything here shipped and was verified on
 * 2026-09-13 before being written down.
 */
export const RELEASES: readonly Release[] = [
  // 2026-09-18. WRITTEN BECAUSE HE ASKED FOR THREE OF THESE AGAIN, BELIEVING THEY WERE NEVER
  // BUILT - they were, and they were already on his phone. The commits carried no customer line,
  // so nothing anywhere told him. Every line below was verified BY CALLER before being written:
  // FollowersPanel is mounted at Account.tsx:231, the share link is built at FollowersPanel.tsx:66,
  // and the three follower badges are registered in achievement-icons.ts. Nothing here about
  // today's guide fix, which is on origin but not on a build - an entry ships inside the build
  // that carries the feature, so a line must be true of the build a person is reading it in.
  // ⚠️ THE LAST FOUR LINES WERE ADDED ON 2026-09-18 TO AN ENTRY THAT ALREADY EXISTED, AND THAT WAS
  // MEASURED RATHER THAN GUESSED. Only CURRENT_RELEASE (RELEASES[0]) is ever rendered, so opening a
  // NEW entry for them would have BURIED the four lines above for everyone who had not yet seen
  // this one. At the time: 33 profiles, 2 carried whats_new_2026-09-18, control whats_new_2026-09-13
  // read 4 - so 31 of 33 get the complete list here and only 2 miss the additions.
  // ⚠️ EVERY ONE OF THESE IS TRUE OF BUILD 956, verified by ancestry against f8520a64 with a
  // negative control, because this file's own rule is that a line must be true of the build a
  // person is reading it in. Today's red-text and chart-legend fixes are deliberately NOT here -
  // they are on origin and NOT in 956, so they belong to the next entry, not this one.
  {
    version: '2026-09-18',
    lines: [
      'Friends are now Followers - see who follows you and who you follow, on your Account tab.',
      'Share your profile with a link, and earn badges for your first, fifth and tenth follower.',
      'Banks with a single account take up less room in your Accounts list.',
      'Dark mode is easier to read - the smaller grey text is no longer washed out.',
      'Your trophy case and Learn each have their own section on the Account tab.',
      'Every badge has its own icon, and achievement rows no longer strand their numbers.',
    ],
  },
  {
    version: '2026-09-13',
    lines: [
      'Your sharing switches now save — and they look like switches.',
      'Friends leaderboards fill in once you turn sharing on.',
      'We stopped asking what category your paycheck is.',
      'You stay signed in longer on your own device.',
      'Charts now show amounts in your own currency.',
    ],
  },
];

export const CURRENT_RELEASE = RELEASES[0];

/**
 * The `profiles.tour_flags` key recording that an account has seen one release.
 *
 * ⚠️ KEYED BY VERSION, so an older release can never re-show and a new one is a new key. It lives
 * here rather than beside the component because `tour_flags` is a shared map and a second file
 * inventing its own spelling is how two writers come to disagree about one flag.
 */
export const whatsNewFlag = (version: string) => `whats_new_${version}`;

/**
 * Whether to show it, and the two ways it must stay quiet.
 *
 * ⚠️ NEVER ON FIRST RUN. A brand-new user has nothing to catch up on, and 22 of 31 users only ever
 * saw first run — putting a "what changed" card in front of them is pure noise at the one moment
 * that decides whether they stay. `hasOnboarded` is the gate.
 *
 * ⚠️ AND NEVER TWICE FOR THE SAME RELEASE. `seenVersion` is the last version this ACCOUNT was
 * shown, read from a durable store rather than component state — a popup that reappears is worse
 * than no popup, and `useState` has already taught this repo that lesson once via demo mode.
 *
 * ⚠️ AN ABSENT `seenVersion` IS NOT A REASON TO SHOW. Someone who has never been shown one might
 * have been using the app for months or might have signed up ten minutes ago, and this function
 * cannot tell them apart — `hasOnboarded` can, which is why it, not the absence, is the decider.
 * The caller records the current version either way, so nobody is shown a release twice.
 *
 * Versions are compared for INEQUALITY, never ordered. A rolled-back release should still be
 * announced if its content differs, and string ordering on a date is a trap the moment a version
 * scheme changes.
 */
export function shouldShowWhatsNew(
  seenVersion: string | null | undefined,
  hasOnboarded: boolean,
  current: Release = CURRENT_RELEASE,
): boolean {
  if (!hasOnboarded) return false;
  // A release with nothing worth saying says nothing.
  if (current.lines.length === 0) return false;
  return seenVersion !== current.version;
}
