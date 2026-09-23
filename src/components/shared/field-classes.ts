// ONE definition of what a text field looks like, so three of them on one screen cannot drift.
//
// ⚠️ THE COUNT IS THE DELIVERABLE, and it was 2 implementations across 3 adjacent fields.
// Tre, 2026-09-13, on the sharing toggles: "they dont look like normal buttons. consider design of
// other apps when thinking about our design always. and consistency across tabs." The same rule
// binds text fields, and `FriendLink.tsx` had the username field built one way (a bordered WRAPPER
// with a transparent input inside, so an icon could sit in the box) and the email and invite-code
// fields built another (a bordered input directly). Nobody builds two on purpose; they arrive one
// screen at a time, each reasonable alone.
//
// ⚠️ AND THE DRIFT HAD ALREADY COST A REAL ACCESSIBILITY DEFECT, which is why this is not tidying.
// The username input carried `outline-none` and NOTHING replacing it — so it had NO VISIBLE FOCUS
// STATE AT ALL. A keyboard or switch user tabbing into "Add a friend" landed on an invisible
// cursor. The other two fields had `focus:ring-1 focus:ring-ring` and were fine, which is exactly
// how this kind of defect survives review: the screen looks consistent until you press Tab.
//
// The fix has to differ by shape, and that is the reason these are two constants rather than one:
// a ring on an input INSIDE a wrapper draws inside the box and looks like a mistake, so the wrapper
// takes `focus-within` instead. Same visual result, applied to whichever element owns the border.

/** Surface and border with NO padding, so a field whose geometry differs can still share the skin. */
const FIELD_SKIN = 'bg-secondary border border-border';

/** The surface, border and radius shared by every text field. Pair with `FIELD_RADIUS`. */
const FIELD_SURFACE = `${FIELD_SKIN} px-3 py-2`;

/** A ring that is visible on both themes, and never `outline-none` with nothing after it. */
const FIELD_FOCUS = 'focus:outline-hidden focus:ring-1 focus:ring-ring';

/**
 * Surface, padding and focus ring WITHOUT any width or type size - for a field whose geometry
 * genuinely differs from `FIELD_INPUT` (a phone field that is `flex-1`, a 2FA code that is
 * `w-full text-sm text-center tracking-widest`). Compose, do not re-spell: three inputs had the
 * skin and the ring copied out by hand, and a copy is what drifts.
 */
export const FIELD_BASE = `${FIELD_SURFACE} ${FIELD_FOCUS}`;

/** A field that IS the input — the ordinary case. */
export const FIELD_INPUT =
  `w-full sm:flex-1 min-w-0 ${FIELD_SURFACE} text-xs text-foreground ${FIELD_FOCUS}`;

/**
 * The wrapper for a field that holds an icon or a prefix beside its input.
 *
 * `focus-within` rather than `focus`: the wrapper never receives focus itself, so `focus:` would
 * never match and the field would silently keep the no-indicator defect this file exists to fix.
 */
export const FIELD_WRAPPER =
  `flex items-center gap-1 w-full sm:flex-1 min-w-0 ${FIELD_SURFACE} focus-within:ring-1 focus-within:ring-ring`;

/** The input inside `FIELD_WRAPPER`. Its border and ring belong to the wrapper, not to it. */
export const FIELD_INPUT_BARE = 'flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none';

/**
 * A SHORT FIXED-WIDTH field - a two-letter country code, a state abbreviation - whose geometry
 * cannot be `FIELD_INPUT` (that one is `w-full sm:flex-1` with `px-3 py-2`).
 *
 * It exists because the alternative kept happening: `GlobalStandingCard`'s country input
 * hand-rolled `bg-secondary border border-border` and, having done so, carried NO FOCUS RING AT
 * ALL - the identical defect this file was written about, shipped again in a different component
 * on a screen that IS mounted. Sharing the skin is the point; the geometry is the only difference.
 */
export const FIELD_INPUT_COMPACT =
  `${FIELD_SKIN} px-1 py-0.5 text-center text-foreground ${FIELD_FOCUS}`;

/**
 * A native `<select>`. Same surface and focus ring as `FIELD_INPUT`, full width, and none of the
 * `sm:flex-1` that only makes sense for a text field sharing a row with its button. Added
 * 2026-09-23 with the leaderboard's country picker, and three Transactions selects moved onto it:
 * they carried this exact surface spelled by hand with NO focus ring.
 */
export const FIELD_SELECT = `w-full ${FIELD_SURFACE} text-xs text-foreground ${FIELD_FOCUS}`;

/** Every field and its adjacent button share the container radius. */
export const FIELD_RADIUS = { borderRadius: 'var(--radius)' } as const;
