import { describe, it, expect } from 'vitest';
import { cardPayHint } from '@/lib/card-pay-hint';
import type { PayBehavior } from '@/lib/card-pay-behavior';

describe('cardPayHint', () => {
  it('returns null when sampleSize is 0', () => {
    const b: PayBehavior = {
      autopay: false,
      kind: 'minimum',
      dayOfMonth: null,
      sampleSize: 0,
      lastAmount: null,
    };
    expect(cardPayHint(b, null)).toBeNull();
  });

  it('handles manual payment with last amount', () => {
    const b: PayBehavior = {
      autopay: false,
      kind: 'minimum',
      dayOfMonth: null,
      sampleSize: 10,
      lastAmount: 50,
    };
    expect(cardPayHint(b, null)).toEqual({
      text: 'Last payment $50.00.',
      mismatch: false,
    });
  });

  it('autopay minimum with day and full preference (mismatch)', () => {
    const b: PayBehavior = {
      autopay: true,
      kind: 'minimum',
      dayOfMonth: 1,
      sampleSize: 5,
      lastAmount: 198.17,
    };
    expect(cardPayHint(b, 'full')).toEqual({
      text: 'Your bank autopays the minimum on the 1st (last $198.17). The plan assumes the full balance is paid.',
      mismatch: true,
    });
  });

  it('autopay minimum with day and null preference (no mismatch)', () => {
    const b: PayBehavior = {
      autopay: true,
      kind: 'minimum',
      dayOfMonth: 1,
      sampleSize: 5,
      lastAmount: 198.17,
    };
    expect(cardPayHint(b, null)).toEqual({
      text: 'Your bank autopays the minimum on the 1st (last $198.17).',
      mismatch: false,
    });
  });

  it('autopay statement_or_more with day, null preference (mismatch)', () => {
    const b: PayBehavior = {
      autopay: true,
      kind: 'statement_or_more',
      dayOfMonth: 15,
      sampleSize: 8,
      lastAmount: 900,
    };
    expect(cardPayHint(b, null)).toEqual({
      text: 'Your bank autopays on the 15th (last $900.00). The plan assumes only the minimum is paid.',
      mismatch: true,
    });
  });

  it('autopay statement_or_more with day, statement preference (no mismatch)', () => {
    const b: PayBehavior = {
      autopay: true,
      kind: 'statement_or_more',
      dayOfMonth: 15,
      sampleSize: 8,
      lastAmount: 900,
    };
    expect(cardPayHint(b, 'statement')).toEqual({
      text: 'Your bank autopays on the 15th (last $900.00).',
      mismatch: false,
    });
  });

  it('autopay minimum with null dayOfMonth', () => {
    const b: PayBehavior = {
      autopay: true,
      kind: 'minimum',
      dayOfMonth: null,
      sampleSize: 3,
      lastAmount: 25,
    };
    expect(cardPayHint(b, null)).toEqual({
      text: 'Your bank autopays the minimum (last $25.00).',
      mismatch: false,
    });
  });

  // Decision 2d104bc7 (Tre, 2026-10-03): Discover stays Full Balance, but a card ranked below an
  // unmet goal pays only its minimum. Then a minimum autopay AGREES with the plan. The pair is the
  // point: the same behaviour with a plan that pays in full must still be a mismatch.
  it('a Full Balance card whose plan pays the minimum this month is not a mismatch', () => {
    const b: PayBehavior = { autopay: true, kind: 'minimum', dayOfMonth: 1, sampleSize: 3, lastAmount: 198.17 };
    expect(cardPayHint(b, 'full', true)).toEqual({
      text: 'Your bank autopays the minimum on the 1st (last $198.17). The plan pays the minimum too for now: goals ranked above your cards come first.',
      mismatch: false,
    });
    expect(cardPayHint(b, 'full', false)?.mismatch).toBe(true);
    expect(cardPayHint(b, 'full')?.text).toContain('The plan assumes the full balance is paid.');
  });
});
