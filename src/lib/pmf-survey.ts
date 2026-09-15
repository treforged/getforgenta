/**
 * The Sean Ellis product-market-fit survey.
 *
 * Tre, 2026-09-15 (reel DdMa7-zRSoA, brand thread): ask users how they would feel if they could
 * no longer use the product.
 *
 * ⚠️ THE 40% BENCHMARK IS THE CREATOR'S CITATION OF A KNOWN FIGURE, NOT A RESULT MEASURED HERE,
 * and nothing in this app may render it as though it were. This product has tens of users; a
 * proportion from a sample that size is not a verdict about product-market fit, and putting a
 * bar on screen invites reading it as one. The number is deliberately absent from this file.
 *
 * ⚠️ THE SECOND QUESTION IS THE VALUABLE ONE. The sentiment is a number that moves slowly and
 * says little on its own. `PMF_FOLLOW_UP`, asked only of the people who answer "very
 * disappointed", names the real value proposition in their own words - and that is the output
 * worth having from a survey this small.
 */
import { toLocalDateStr } from '@/lib/scheduling';
import { daysBetween } from '@/lib/transaction-matching';

/** Bump when the WORDING changes, never for a cosmetic edit. See the migration header: a reworded
 *  question is a different population, and pooling the two answers invents a trend. */
export const PMF_SURVEY_VERSION = 'v1';

/** The `profiles.tour_flags` key recording that this account has been ASKED - the same mechanism
 *  the what's-new record and `useDerivedCountry` already use. It records being SHOWN the survey;
 *  what they SAID lives in `public.pmf_responses`, because an answer is not a boolean. */
export const PMF_SEEN_FLAG = 'pmf_survey_v1';

export type PmfSentiment = 'very_disappointed' | 'somewhat_disappointed' | 'not_disappointed';

export const PMF_QUESTION = 'How would you feel if you could no longer use Forgenta?';

/** ⚠️ THE ORDER AND THE WORDING ARE THE INSTRUMENT. These are Sean Ellis's three answers; a
 *  fourth option, a neutral middle, or a reworded label makes the result incomparable with every
 *  other run of this survey, which is the only thing that makes the answer interpretable at all. */
export const PMF_OPTIONS: ReadonlyArray<{ id: PmfSentiment; label: string }> = [
  { id: 'very_disappointed', label: 'Very disappointed' },
  { id: 'somewhat_disappointed', label: 'Somewhat disappointed' },
  { id: 'not_disappointed', label: 'Not disappointed' },
];

export const PMF_FOLLOW_UP = 'What would you miss most?';

/**
 * How long an account must have existed before its opinion means anything.
 *
 * Somebody who signed up yesterday cannot answer this question - they have nothing to lose yet -
 * and including them does not merely add noise, it drags the proportion down in a direction that
 * looks like a product problem. Seven days is a judgement call, not a measurement, and it is
 * written here as one number so it can be changed in one place.
 */
export const MIN_DAYS = 7;

/**
 * Whether this account should be asked.
 *
 * ⚠️ `onboardingCompleted` IS A WEAKER FILTER THAN ITS NAME SUGGESTS, measured 2026-09-15 a few
 * hours after this file shipped. Of 33 accounts, 7 carry `onboarding_completed`, and FIVE of those
 * seven have no `onboarding_furthest_step` at all; exactly ONE account has ever reached `finish`.
 * `Onboarding.tsx` marks the flag complete for anyone arriving with a `display_name`, so the
 * column largely records HAVING A NAME rather than having been onboarded. This gate is therefore
 * not harmful - the 7-day bar still excludes the newest accounts, which is the part that protects
 * the answer - but it does not mean what it reads like. Tracked as ask `ac098dec`; when the flag
 * becomes trustworthy this check gets stronger for free, and no code here needs to change.
 *
 * ⚠️ THE ELAPSED DAYS GO THROUGH `daysBetween`, NOT THROUGH MILLISECOND DIVISION, and this repo
 * has a standing rule about exactly that. `(now - created) / 86_400_000` is 6.958 across a spring
 * DST transition, so an account created on 2026-03-05 and asked on 2026-03-12 reads as SIX days
 * and is silently skipped in every US timezone. `daysBetween` is built from date parts in local
 * time and rounds, which is why it is reused here rather than reimplemented - a second
 * implementation is a second chance to reintroduce the bug. There is a test for that exact pair.
 */
export function isEligibleForPmf(args: {
  onboardingCompleted: boolean;
  accountCreatedAt: string | null;
  alreadySeen: boolean;
  now?: Date;
}): boolean {
  if (args.alreadySeen) return false;
  if (!args.onboardingCompleted) return false;
  if (!args.accountCreatedAt) return false;

  const created = new Date(args.accountCreatedAt);
  if (Number.isNaN(created.getTime())) return false;

  const now = args.now ?? new Date();
  return daysBetween(toLocalDateStr(created), toLocalDateStr(now)) >= MIN_DAYS;
}
