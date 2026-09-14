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

/** The surface, border and radius shared by every text field. Pair with `FIELD_RADIUS`. */
const FIELD_SURFACE = 'bg-secondary border border-border px-3 py-2';

/** A ring that is visible on both themes, and never `outline-none` with nothing after it. */
const FIELD_FOCUS = 'focus:outline-hidden focus:ring-1 focus:ring-ring';

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

/** Every field and its adjacent button share the container radius. */
export const FIELD_RADIUS = { borderRadius: 'var(--radius)' } as const;
