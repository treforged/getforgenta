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
