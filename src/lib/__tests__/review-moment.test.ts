// WHEN the review prompt is asked for, and — more importantly — when it is not.
//
// This protects a resource that cannot be recovered. Both stores rate-limit `requestReview` and
// show nothing when the quota is gone, WITHOUT telling the app, so a prompt spent at the wrong
// moment is invisible in every log and looks exactly like a prompt that worked. The tests here
// are the only place that failure is visible.
//
// Would-fail checks: drop the `promptedAt` guard and "never asks twice" fails; drop the seen-event
// filter and "the same fact is not news twice" fails; reorder PRIORITY and the loudest-wins case
// fails; let a bad-news signal into the union and `detectValueEvents` has no case for it, which
// is deliberate — nothing that fires on bad news can be added without editing these files.

import { describe, it, expect } from 'vitest';
import {
  decideReviewPrompt, recordEvent, recordPrompt, parseReviewState,
} from '@/lib/review-moment';
import type { ReviewState, ValueEvent } from '@/lib/review-moment';
import { detectValueEvents } from '@/hooks/useValueMoments';

const NOW = new Date('2026-09-02T21:00:00');
const fresh = (): ReviewState => ({ promptedAt: null, seenEvents: [] });

describe('decideReviewPrompt', () => {
  it('asks at a real value moment', () => {
    const out = decideReviewPrompt(['debt_cleared'], fresh(), NOW);
    expect(out.shouldPrompt).toBe(true);
    expect(out.event).toBe('debt_cleared');
    expect(out.reason).toContain('debt_cleared');
  });

  it('NEVER asks twice — the store quota is spent and a second ask is invisible', () => {
    const spent: ReviewState = { promptedAt: NOW.toISOString(), seenEvents: [] };
    const out = decideReviewPrompt(['goal_reached'], spent, NOW);
    expect(out.shouldPrompt).toBe(false);
    expect(out.reason).toBe('already prompted');
  });

  it('does not treat the same fact as news twice', () => {
    const seen: ReviewState = { promptedAt: null, seenEvents: ['first_positive_projection'] };
    const out = decideReviewPrompt(['first_positive_projection'], seen, NOW);
    expect(out.shouldPrompt).toBe(false);
    expect(out.reason).toBe('no new value event');
  });

  it('asks nothing when nothing happened', () => {
    expect(decideReviewPrompt([], fresh(), NOW).shouldPrompt).toBe(false);
  });

  it('picks the loudest when several are true at once', () => {
    const out = decideReviewPrompt(
      ['first_positive_projection', 'debt_cleared', 'goal_reached'],
      fresh(),
      NOW,
    );
    // A goal reached is the one they will remember while the dialog is open.
    expect(out.event).toBe('goal_reached');
  });

  it('falls through to a fresh event when the loudest one is already seen', () => {
    const seen: ReviewState = { promptedAt: null, seenEvents: ['goal_reached'] };
    const out = decideReviewPrompt(['goal_reached', 'debt_cleared'], seen, NOW);
    expect(out.event).toBe('debt_cleared');
  });
});

describe('state transitions are immutable', () => {
  it('records an event without touching the input', () => {
    const before = fresh();
    const after = recordEvent(before, 'debt_cleared');
    expect(before.seenEvents).toEqual([]);
    expect(after.seenEvents).toEqual(['debt_cleared']);
  });

  it('does not record the same event twice', () => {
    const once = recordEvent(fresh(), 'debt_cleared');
    expect(recordEvent(once, 'debt_cleared').seenEvents).toEqual(['debt_cleared']);
  });

  it('stamps the prompt without losing the seen events', () => {
    const after = recordPrompt(recordEvent(fresh(), 'goal_reached'), NOW);
    expect(after.promptedAt).toBe(NOW.toISOString());
    expect(after.seenEvents).toEqual(['goal_reached']);
  });
});

describe('parseReviewState', () => {
  it('reads back what was written', () => {
    const state = recordPrompt(recordEvent(fresh(), 'goal_reached'), NOW);
    expect(parseReviewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('fails open on junk rather than locking the prompt out forever', () => {
    for (const junk of [null, undefined, 'nope', 42, [], { promptedAt: 5 }]) {
      expect(parseReviewState(junk)).toEqual({ promptedAt: null, seenEvents: [] });
    }
  });

  it('drops event names it does not recognise', () => {
    const parsed = parseReviewState({ promptedAt: null, seenEvents: ['goal_reached', 'made_up'] });
    expect(parsed.seenEvents).toEqual(['goal_reached']);
  });
});

describe('detectValueEvents — what actually counts as value received', () => {
  const base = {
    goals: [] as { current_amount?: number | null; target_amount?: number | null }[],
    debts: [] as { balance?: number | null }[],
    hasLinkedAccounts: true,
    projectedCash: 5000,
    cashFloor: 2500,
    enabled: true,
  };

  it('sees a goal that reached its target', () => {
    const out = detectValueEvents({ ...base, goals: [{ current_amount: 500, target_amount: 500 }] });
    expect(out).toContain('goal_reached');
  });

  it('does not celebrate a goal still short of its target', () => {
    const out = detectValueEvents({ ...base, goals: [{ current_amount: 499, target_amount: 500 }] });
    expect(out).not.toContain('goal_reached');
  });

  it('does not celebrate a zero-target row, which is not a goal', () => {
    const out = detectValueEvents({ ...base, goals: [{ current_amount: 0, target_amount: 0 }] });
    expect(out).not.toContain('goal_reached');
  });

  it('treats an unreadable figure as no event rather than as zero', () => {
    const out = detectValueEvents({ ...base, goals: [{ current_amount: null, target_amount: null }] });
    expect(out).not.toContain('goal_reached');
  });

  it('sees a debt at zero, but only when there was a debt', () => {
    expect(detectValueEvents({ ...base, debts: [{ balance: 0 }] })).toContain('debt_cleared');
    expect(detectValueEvents({ ...base, debts: [] })).not.toContain('debt_cleared');
    expect(detectValueEvents({ ...base, debts: [{ balance: 1200 }] })).not.toContain('debt_cleared');
  });

  it('sees the first complete positive picture', () => {
    expect(detectValueEvents(base)).toContain('first_positive_projection');
  });

  it('NEVER asks a user who is projected below their floor', () => {
    const out = detectValueEvents({ ...base, projectedCash: 100 });
    expect(out).not.toContain('first_positive_projection');
  });

  it('says nothing without a projection — absent is not zero, and zero is not broke', () => {
    const out = detectValueEvents({ ...base, projectedCash: null });
    expect(out).not.toContain('first_positive_projection');
  });

  it('says nothing before any account is linked', () => {
    const out = detectValueEvents({ ...base, hasLinkedAccounts: false });
    expect(out).not.toContain('first_positive_projection');
  });
});
