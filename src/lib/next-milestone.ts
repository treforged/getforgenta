/**
 * Which milestone the Forecast leads with, and how it should sound.
 *
 * `calculateForecast` already emits `milestones` in chronological order — a single forward
 * pass over the 60 months pushes them as they fire — so "soonest" is "first in the array".
 * This module adds nothing to that: it only decides which one the hero shows and whether the
 * hero says it in a good voice or a bad one.
 *
 * The rule that matters (DIRECTION.md rule 3, house honesty): **the soonest milestone wins
 * even when it is bad news.** A hero that skipped a floor breach to announce a payoff two
 * years later would be a lie told by omission, and it is exactly the failure this selector
 * exists to make impossible.
 *
 * The engine emits five event strings today. Anything it grows later classifies as `neutral`
 * rather than `positive`, because dressing an unrecognised event up as a win is the same
 * mistake as a confident zero.
 */

/** One entry of `calculateForecast(...).milestones` — the shape is owned by forecast-engine. */
export interface ForecastMilestone {
  month: string;
  event: string;
}

export type MilestoneTone = 'positive' | 'negative' | 'neutral';

export interface NextMilestoneSelection {
  /** The milestone the hero shows. */
  milestone: ForecastMilestone;
  tone: MilestoneTone;
  /** Every other milestone, in the engine's original order. Nothing is dropped. */
  rest: ForecastMilestone[];
}

/**
 * Substrings that identify the engine's bad-news milestones (forecast-engine.ts ~:1434-1438).
 * Matched on the warning glyphs the engine prefixes them with rather than on full copy, so a
 * wording tweak there does not silently reclassify a warning as neutral.
 */
const NEGATIVE_MARKERS = ['⚠️', '💸'] as const;

/** Substrings that identify the engine's good-news milestones (~:1424-1430). */
const POSITIVE_MARKERS = ['🎉', '🎯'] as const;

export function classifyMilestoneTone(event: string): MilestoneTone {
  if (NEGATIVE_MARKERS.some((m) => event.includes(m))) return 'negative';
  if (POSITIVE_MARKERS.some((m) => event.includes(m))) return 'positive';
  return 'neutral';
}

/**
 * The soonest milestone, or `null` when there are none.
 *
 * Within the soonest MONTH the engine can emit several milestones (a payoff and a floor
 * breach can land together); when it does, the negative one leads. That is the same rule
 * pointing the same way — the hero never shows the nicer of two things happening at once.
 */
export function selectNextMilestone(
  milestones: readonly ForecastMilestone[] | undefined | null,
): NextMilestoneSelection | null {
  if (!milestones || milestones.length === 0) return null;

  const soonestMonth = milestones[0].month;
  let chosenIdx = 0;
  for (let i = 0; i < milestones.length && milestones[i].month === soonestMonth; i++) {
    if (classifyMilestoneTone(milestones[i].event) === 'negative') {
      chosenIdx = i;
      break;
    }
  }

  const milestone = milestones[chosenIdx];
  return {
    milestone,
    tone: classifyMilestoneTone(milestone.event),
    rest: milestones.filter((_, i) => i !== chosenIdx),
  };
}
