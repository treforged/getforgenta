import type { Transition, Variants } from 'framer-motion';

/**
 * The app's motion vocabulary.
 *
 * One library, one set of numbers. Every animation in the app spends from this
 * file so the whole thing moves like one product rather than like six people's
 * separate taste. If a component needs a duration or an easing curve that is
 * not here, add it here rather than inlining it.
 *
 * The library is **framer-motion** (the package name Motion still ships under).
 * It was already a dependency, already in the entry bundle, and already used by
 * the landing page — so adopting it across the app costs no new download. See
 * `handoff/2026-08-12-animation-library.md` for why no second library was added.
 *
 * ⚠️ Nothing in this file decides whether an animation runs at all. That is
 * `usePrefersReducedMotion()` plus the app-level `<MotionConfig reducedMotion="user">`.
 */

/**
 * Durations, in seconds.
 *
 * Deliberately short. These are interface animations, not effects: their job is
 * to say "this became that" and get out of the way. Anything past ~0.3s for a
 * state change reads as the app being slow rather than the app being smooth.
 * `count` and `draw` are the two exceptions, because they carry information —
 * the eye is meant to follow the number and the line.
 */
export const MOTION_DURATION = {
  /** Micro-feedback: a badge, a colour change. */
  fast: 0.18,
  /** The default for an element entering or leaving. */
  base: 0.28,
  /** Cross-fading a whole region, e.g. skeleton to content. */
  slow: 0.4,
  /** A figure counting to its new value. */
  count: 0.7,
  /** The forecast chart drawing itself in. */
  draw: 0.9,
} as const;

/**
 * Standard ease-out. Fast at the start, settling at the end — the curve that
 * reads as "responsive", because the motion has already mostly happened by the
 * time the eye arrives.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** The default transition for an element entering or leaving. */
export const TRANSITION_BASE: Transition = {
  duration: MOTION_DURATION.base,
  ease: EASE_OUT,
};

/**
 * Enter by fading up a few pixels.
 *
 * The offset is small on purpose: 6px reads as the row settling into place,
 * where 30px reads as the row flying in from somewhere, which is a different
 * and much more tiring claim to make several times per screen.
 */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: TRANSITION_BASE },
  exit: { opacity: 0, y: -4, transition: { duration: MOTION_DURATION.fast, ease: EASE_OUT } },
};

/** A plain cross-fade, for swapping one whole region for another. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: MOTION_DURATION.slow, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: MOTION_DURATION.base, ease: EASE_OUT } },
};

/**
 * Stagger children by this much, in seconds.
 *
 * Capped hard by `staggerFor` below — a per-child delay is fine for five rows
 * and absurd for eighty, where the last row would arrive most of a minute late.
 */
export const STAGGER_STEP = 0.04;

/** The longest a staggered list is allowed to take to finish arriving. */
export const STAGGER_MAX_TOTAL = 0.35;

/**
 * The delay for child `index` of a staggered list of `count`.
 *
 * Compresses the step so the whole list always lands inside
 * `STAGGER_MAX_TOTAL`, however long it is. A list is not more legible for
 * taking longer to appear.
 */
export function staggerFor(index: number, count: number): number {
  if (count <= 1) return 0;
  const step = Math.min(STAGGER_STEP, STAGGER_MAX_TOTAL / (count - 1));
  return index * step;
}
