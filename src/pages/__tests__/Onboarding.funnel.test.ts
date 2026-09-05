// @vitest-environment jsdom
//
// jsdom purely so importing the page does not blow up on `localStorage` in the Supabase client at
// module load. Nothing here renders anything: the rule under test is pure.
import { describe, it, expect } from 'vitest';
import { furthestStepPatch } from '../Onboarding';

/**
 * WHERE PEOPLE STOP IN ONBOARDING — Tre, 2026-09-02: "conversion is the metric".
 *
 * `onboarding_completed` is a boolean, so it can only ever answer "how many finished". The
 * actionable question is WHICH STEP loses them, and the only thing that can get that wrong in an
 * interesting way is the monotonic rule. Everything below is about that rule.
 *
 * The premium and free flows differ at the SECOND step (`bank` vs `premium`), which is why
 * position is compared inside the user's own sequence rather than against one global list.
 */

const FREE = ['welcome', 'premium', 'income', 'expenses', 'debts', 'savings', 'goals', 'finish'] as const;
const PREMIUM = ['welcome', 'bank', 'income', 'expenses', 'debts', 'savings', 'goals', 'finish'] as const;
const AT = () => '2026-09-05T12:00:00.000Z';

describe('furthestStepPatch', () => {
  it('records the first step, and stamps a start time, for a brand-new user', () => {
    expect(furthestStepPatch(null, null, 'welcome', FREE, AT)).toEqual({
      onboarding_furthest_step: 'welcome',
      onboarding_started_at: '2026-09-05T12:00:00.000Z',
    });
  });

  it('moves forward as the user advances', () => {
    expect(furthestStepPatch('welcome', AT(), 'income', FREE, AT))
      .toEqual({ onboarding_furthest_step: 'income' });
  });

  it('⚠️ NEVER GOES BACKWARDS — pressing Back must not rewrite how far they got', () => {
    // The whole point. A last-position field would say someone who reached Goals and stepped back
    // to check their income "stopped at income" — the opposite of true, and it would aim the next
    // redesign at the wrong screen.
    expect(furthestStepPatch('goals', AT(), 'income', FREE, AT)).toBeNull();
    expect(furthestStepPatch('goals', AT(), 'welcome', FREE, AT)).toBeNull();
  });

  it('writes nothing at all when there is nothing new to say', () => {
    expect(furthestStepPatch('income', AT(), 'income', FREE, AT)).toBeNull();
  });

  it('stamps the start time ONCE — a returning user does not reset their own clock', () => {
    const first = furthestStepPatch(null, null, 'welcome', FREE, AT);
    expect(first?.onboarding_started_at).toBe('2026-09-05T12:00:00.000Z');
    // Same user, later, further along: the step moves and the start time is left alone.
    const later = furthestStepPatch('welcome', '2026-09-05T12:00:00.000Z', 'goals', FREE, AT);
    expect(later).toEqual({ onboarding_furthest_step: 'goals' });
    expect(later && 'onboarding_started_at' in later).toBe(false);
  });

  it('backfills a start time for a user who began before this was recorded', () => {
    // NULL means "predates the column", not "stopped at the first step". Such a user gets a start
    // time the moment they are seen again, so they stop being invisible to the funnel.
    expect(furthestStepPatch('debts', null, 'debts', FREE, AT))
      .toEqual({ onboarding_started_at: '2026-09-05T12:00:00.000Z' });
  });

  it('compares position INSIDE the user\'s own flow — premium and free differ at step two', () => {
    // `bank` is index 1 of the premium flow and absent from the free one. Judged against the free
    // list it would be index -1 and every later step would look like progress from nothing.
    expect(furthestStepPatch('bank', AT(), 'income', PREMIUM, AT))
      .toEqual({ onboarding_furthest_step: 'income' });
    expect(furthestStepPatch('income', AT(), 'bank', PREMIUM, AT)).toBeNull();
  });

  it('lets a recognised step overwrite an unrecognised stored value', () => {
    // A value this flow does not contain is not a position within it, so it must not pin the
    // funnel forever. The direction is deliberate: forward.
    expect(furthestStepPatch('bank', AT(), 'income', FREE, AT))
      .toEqual({ onboarding_furthest_step: 'income' });
  });

  it('refuses to record a step that is not in the flow at all', () => {
    expect(furthestStepPatch('income', AT(), 'not_a_step' as never, FREE, AT)).toBeNull();
  });
});
