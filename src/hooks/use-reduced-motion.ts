import { useReducedMotion } from 'framer-motion';

/**
 * True when the operating system is set to reduce motion.
 *
 * **Read this before animating anything.** "Reduce motion" is an accessibility
 * setting people turn on because animation makes them ill — vestibular
 * disorders, migraine, motion sensitivity — not a preference about taste. An
 * animation library that ignores it ships an accessibility regression dressed
 * as polish, so every animated surface in this app is gated on this hook or on
 * the app-level `<MotionConfig reducedMotion="user">` in `App.tsx`.
 *
 * ## Why this wraps the library's hook rather than the codebase's `useMediaQuery`
 *
 * `use-mobile.tsx` has a perfectly good `useMediaQuery`, and an earlier draft of
 * this used it. It was changed deliberately: `<MotionConfig reducedMotion="user">`
 * keys off framer-motion's *own* reduced-motion state, so reading the media
 * query independently would give the app two sources of truth for one setting —
 * exactly the shape of bug where the automatic layer and the manual layer
 * disagree and half a screen animates. This returns the same value the library
 * itself is acting on.
 *
 * ## What MotionConfig does and does not cover
 *
 * `reducedMotion="user"` automatically neutralises **transform and layout**
 * animations, which is most of them. It deliberately leaves opacity and colour
 * alone, since a cross-fade does not cause motion sickness.
 *
 * It does **not** know about animation that is not a motion value at all — a
 * number counting up, or recharts drawing its own line. Those must ask this
 * hook and skip to the final state themselves. `CountUp` and the Forecast chart
 * both do.
 *
 * @returns `true` when motion should be suppressed. Never `null`: the library
 *   returns `null` before it has a `window` to ask, which for our purposes is
 *   the same answer as "no preference expressed".
 */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}
