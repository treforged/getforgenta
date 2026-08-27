// THE FORM'S HALF OF THE N-STAGE GOAL: drafts in, `savings_goals.stages` out, and back again.
//
// Pinned separately from the engine because this is the layer that can silently LOSE a user's plan.
// The engine reading an empty array is a goal with no stops, which is indistinguishable from a goal
// whose stops the form failed to serialise — so the round trip is the thing worth asserting.

import { describe, it, expect } from 'vitest';
import { newStopDraft, stopDraftsFrom, stopsToStages } from '../GoalStopsEditor';
import { goalStages } from '@/lib/ranked-extra-payment-targets';

describe('stopsToStages', () => {
  it('writes exactly one sizing key per stop, which is what the database constraint demands', () => {
    const out = stopsToStages([
      newStopDraft({ name: 'Move fund', mode: 'amount', amount: '5730', months: '9' }),
      newStopDraft({ name: 'Runway', mode: 'months', months: '3', amount: '999' }),
    ]);
    expect(out[0]).toMatchObject({ name: 'Move fund', amount: 5_730 });
    expect(out[0]).not.toHaveProperty('months');
    expect(out[1]).toMatchObject({ name: 'Runway', months: 3 });
    expect(out[1]).not.toHaveProperty('amount');
  });

  it('DROPS a stop with no usable size rather than storing a zero — a zero-size stop reads as '
    + 'already filled the moment it is created', () => {
    expect(stopsToStages([
      newStopDraft({ mode: 'amount', amount: '' }),
      newStopDraft({ mode: 'amount', amount: '0' }),
      newStopDraft({ mode: 'amount', amount: 'abc' }),
      newStopDraft({ mode: 'months', months: '-2' }),
      newStopDraft({ mode: 'amount', amount: '100' }),
    ])).toEqual([expect.objectContaining({ amount: 100 })]);
  });

  it('omits the optional keys entirely instead of writing nulls, so an untouched stop stays small', () => {
    const [only] = stopsToStages([newStopDraft({ mode: 'amount', amount: '100' })]);
    expect(Object.keys(only).sort()).toEqual(['amount', 'id']);
  });

  it('keeps the date and the waiting flag when they are set', () => {
    const [only] = stopsToStages([
      newStopDraft({ mode: 'months', months: '3', targetDate: '2028-01-31', afterCards: true }),
    ]);
    expect(only).toMatchObject({ months: 3, target_date: '2028-01-31', after_cards: true });
  });
});

describe('stopDraftsFrom', () => {
  it('round-trips a stored plan back into drafts the engine resolves identically', () => {
    const stored = [
      { id: 'a', name: 'Move fund', amount: 5_730, target_date: '2027-07-03' },
      { id: 'b', name: 'Runway', months: 3 },
      { id: 'c', name: 'Full runway', months: 3, after_cards: true },
    ];
    const before = goalStages({ target_amount: 0, stages: stored }, 1_000);
    const after = goalStages({ target_amount: 0, stages: stopsToStages(stopDraftsFrom(stored)) }, 1_000);
    expect(after.stops.map(s => [s.name, s.size, s.threshold, s.afterCards, s.targetDate]))
      .toEqual(before.stops.map(s => [s.name, s.size, s.threshold, s.afterCards, s.targetDate]));
  });

  it('reads a months stop as months and a dollar stop as dollars, so an edit does not silently '
    + 'change how a stop is sized', () => {
    const drafts = stopDraftsFrom([{ id: 'a', amount: 500 }, { id: 'b', months: 4 }]);
    expect(drafts.map(d => d.mode)).toEqual(['amount', 'months']);
    expect(drafts[0].amount).toBe('500');
    expect(drafts[1].months).toBe('4');
  });

  it('is empty for a goal that has never been staged, and for anything that is not an array', () => {
    expect(stopDraftsFrom([])).toEqual([]);
    expect(stopDraftsFrom(null)).toEqual([]);
    expect(stopDraftsFrom('nonsense')).toEqual([]);
    expect(stopDraftsFrom([null, 3, 'x'])).toEqual([]);
  });

  it('mints FRESH local ids, which is what stops a duplicated goal sharing stop ids with the '
    + 'original it was copied from', () => {
    const stored = [{ id: 'a', amount: 100 }];
    expect(stopDraftsFrom(stored)[0].uid).not.toBe(stopDraftsFrom(stored)[0].uid);
  });
});
