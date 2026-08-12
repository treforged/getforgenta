import { AnimatePresence, motion } from 'framer-motion';
import { MOTION_DURATION, EASE_OUT } from '@/lib/motion';

interface ContentTransitionProps {
  /** True while the real thing is still loading. */
  loading: boolean;
  /** The loading shape. Should already be the shape of what is coming. */
  skeleton: React.ReactNode;
  /**
   * The real content.
   *
   * ⚠️ **Pass a function whenever the content reads data that only exists once
   * loading has finished** — which on a page replacing an early
   * `if (loading) return <Skeleton />` is essentially always. JSX children are
   * constructed *eagerly* at the call site, so `<ContentTransition>{<div>{data.map(…)}</div>}</ContentTransition>`
   * evaluates `data.map` while `data` is still empty or undefined, and the
   * loading guard the early return was providing is silently gone. The function
   * form is only called on the branch that actually renders.
   */
  children: React.ReactNode | (() => React.ReactNode);
  /**
   * Distinguishes two transitions living in one tree. Only needed if a parent
   * renders more than one of these as siblings.
   */
  transitionKey?: string;
}

/**
 * Cross-fades a loading skeleton into the real content instead of swapping it.
 *
 * The skeletons in `PageSkeleton.tsx` already do the hard half of this job —
 * they are the *shape* of what is coming, so nothing jumps when data lands. But
 * they were being swapped out on a single frame, which throws away the
 * continuity they were built to create: the eye reads a hard cut as a new
 * screen and re-scans it, having just been told by the skeleton's shape that it
 * was looking at the right screen already.
 *
 * `mode="wait"` is deliberate over an overlapping cross-fade. Overlapping needs
 * both states stacked in the same box, which means absolute positioning, which
 * breaks the moment the real content is a different height from its skeleton —
 * and it always eventually is. Sequencing costs one short exit
 * (`MOTION_DURATION.fast`) and cannot mangle the layout.
 *
 * Under reduced motion the vertical offset is dropped automatically by the
 * app-level `<MotionConfig reducedMotion="user">`, leaving a plain opacity
 * cross-fade. That is the correct outcome rather than a shortcut: a fade
 * involves no motion, so it is not what the setting is protecting against, and
 * removing it entirely would put the hard cut back for exactly the users least
 * well served by it.
 */
export default function ContentTransition({
  loading,
  skeleton,
  children,
  transitionKey = 'content',
}: ContentTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {loading ? (
        <motion.div
          key={`${transitionKey}-skeleton`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: MOTION_DURATION.fast, ease: EASE_OUT } }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key={`${transitionKey}-content`}
          initial={{ opacity: 0, y: 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: MOTION_DURATION.slow, ease: EASE_OUT },
          }}
        >
          {typeof children === 'function' ? children() : children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
