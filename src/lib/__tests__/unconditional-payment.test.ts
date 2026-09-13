import { describe, it, expect } from 'vitest';
import { settleUnconditional, unconditionalDesired, unconditionalShortfallLabel } from '../unconditional-payment';
import type { CardData } from '../credit-card-engine';

/**
 * THE STARVED MONTH THE ENGINE FIXTURE COULD NOT BUILD.
 *
 * `credit-card-engine.unconditionalPayment.test.ts` says so in its own header: with no rules and
 * no transactions, `getMonthlyDebtBreakdown` reports $2,000 of available cash against a $300
 * checking balance, so `remaining` is never smaller than `desired` there. It records the
 * consequence honestly — restoring the silent clamp
 * (`Math.min(desired, Math.max(0, remaining))`) leaves all four of those tests GREEN, because the
 * clamp never binds on that fixture. **They prove the shape and not the behaviour.**
 *
 * This file exists to prove the behaviour, and it can, because the helper takes the pool as an
 * argument: a starved month is one number.
 */

function card(over: Partial<CardData> & { id: string }): CardData {
  return {
    name: over.name ?? over.id,
    balance: 0,
    minPayment: 0,
    apr: 0,
    color: '#000',
    monthlyNewPurchases: 0,
    dueDay: 15,
    autopayFullBalance: false,
    ...over,
  } as CardData;
}

describe('unconditionalDesired — what "always pay this" means', () => {
  it('is 0 for a card the setting is off for, however big the balance', () => {
    expect(unconditionalDesired(card({ id: 'a', balance: 5000 }))).toBe(0);
    expect(unconditionalDesired(card({ id: 'a', balance: 5000, paymentUnconditional: false }))).toBe(0);
  });

  it('statement wants the balance; full also wants the purchases still to land', () => {
    const base = { id: 'a', balance: 2000, monthlyNewPurchases: 350, paymentUnconditional: true } as const;
    expect(unconditionalDesired(card({ ...base, paymentPreference: 'statement' }))).toBe(2000);
    expect(unconditionalDesired(card({ ...base, paymentPreference: 'full' }))).toBe(2350);
  });

  it('never returns a negative want from a credit (negative) balance', () => {
    expect(unconditionalDesired(card({ id: 'a', balance: -120, paymentUnconditional: true, paymentPreference: 'statement' }))).toBe(0);
  });
});

describe('settleUnconditional — the payment does NOT shrink, and the gap is a number', () => {
  it('pays the FULL amount out of a pool that cannot cover it, and reports the exact gap', () => {
    // THE CENTRAL CLAIM. $2,000 wanted, $600 available.
    const c = card({ id: 'chase', balance: 2000, paymentUnconditional: true, paymentPreference: 'statement' });
    const { byCard, remaining } = settleUnconditional([c], 600);

    // Not 600. A clamp here is the app quietly deciding to send less than it promised.
    expect(byCard.get('chase')!.payment).toBe(2000);
    expect(byCard.get('chase')!.shortfall).toBe(1400);
    // The overdraw never becomes a negative pool for the cards that come after.
    expect(remaining).toBe(0);
  });

  it('reports NO shortfall when the money genuinely fits', () => {
    const c = card({ id: 'chase', balance: 2000, paymentUnconditional: true, paymentPreference: 'statement' });
    const { byCard, remaining } = settleUnconditional([c], 3200);
    expect(byCard.get('chase')!.payment).toBe(2000);
    expect(byCard.get('chase')!.shortfall).toBe(0);
    // And the rest of the plan flexes around it — this is what "adjust around that" means.
    expect(remaining).toBe(1200);
  });

  it('settles several cards in order; the second one absorbs what the first left', () => {
    const a = card({ id: 'a', balance: 1000, paymentUnconditional: true, paymentPreference: 'statement' });
    const b = card({ id: 'b', balance: 800, paymentUnconditional: true, paymentPreference: 'statement' });
    const { byCard, remaining } = settleUnconditional([a, b], 1200);
    expect(byCard.get('a')!.payment).toBe(1000);
    expect(byCard.get('a')!.shortfall).toBe(0);
    expect(byCard.get('b')!.payment).toBe(800);
    // 1200 − 1000 = 200 was left when b was settled, so b is 600 short.
    expect(byCard.get('b')!.shortfall).toBe(600);
    expect(remaining).toBe(0);
  });

  it('leaves ordinary cards out of the map entirely — absent is not zero', () => {
    const on = card({ id: 'on', balance: 500, paymentUnconditional: true, paymentPreference: 'statement' });
    const off = card({ id: 'off', balance: 900 });
    const { byCard } = settleUnconditional([on, off], 100);
    expect(byCard.has('on')).toBe(true);
    expect(byCard.has('off')).toBe(false);
  });

  it('treats an UNKNOWN pool as no cash, never as a broken number', () => {
    // Measured 2026-09-13 on the engine path: a sparse call made `remaining` NaN, which made the
    // shortfall NaN and serialised as `null`. A shortfall is money shown to a person.
    const c = card({ id: 'a', balance: 750, paymentUnconditional: true, paymentPreference: 'statement' });
    const { byCard, remaining } = settleUnconditional([c], Number.NaN);
    expect(byCard.get('a')!.shortfall).toBe(750);
    expect(Number.isFinite(byCard.get('a')!.shortfall)).toBe(true);
    expect(Number.isFinite(remaining)).toBe(true);
  });

  it('rounds the gap to cents rather than carrying float noise onto a screen', () => {
    const c = card({ id: 'a', balance: 100.555, paymentUnconditional: true, paymentPreference: 'statement' });
    const { byCard } = settleUnconditional([c], 0);
    expect(byCard.get('a')!.shortfall).toBe(100.56);
  });
});

describe('unconditionalShortfallLabel — names the amount, not a feeling', () => {
  it('contains the figure, so both surfaces show an actionable number', () => {
    expect(unconditionalShortfallLabel(1400)).toContain('1,400');
    expect(unconditionalShortfallLabel(1400)).toContain('short this month');
  });
});
