import { describe, it, expect } from 'vitest';
import { totalInterestLabel, interestSavingsBullet, NO_PAYOFF_LABEL } from '../card-interest-display';
import { projectCardVariable, type CardData } from '../credit-card-engine';

// $19,007,108 OF TOTAL INTEREST ON A $4,318 CARD, ON THE PUBLIC DEMO.
//
// Found by Ruby on 2026-09-08 while capturing `getforgenta.com/demo`: the expanded Cobalt Rewards
// Card showed that figure beside MIN PAYMENT $25 and PURCHASES/MO $743. It is arithmetically
// honest — `projectCardVariable` walks `Math.max(months, 360)` months looking for a payoff, and a
// card whose purchases outrun its payment compounds for thirty years — and it is useless as
// information. Nobody reads nineteen million dollars as "this card is growing".
//
// ⚠️ NOT the same bug as the $132k one in `credit-card-engine.revolvingDustPayoff.test.ts`. That
// card DID pay off and $0.04 of dust defeated the detection, so the total was a PHANTOM and the fix
// was better detection. Here the divergence is REAL — the balance never reaches zero — so there is
// no better number to find and the only honest output is to say so.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'revolving', autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('the engine really does diverge — the premise, established rather than assumed', () => {
  it('a card whose purchases outrun its payment never pays off, and its total interest is absurd', () => {
    // The demo card's shape: $4,318 at 24.74%, $25 minimum, $743/mo of new purchases.
    const proj = projectCardVariable(
      makeCard({ balance: 4318, apr: 24.74, creditLimit: 12000, minPayment: 25, targetPayment: 25, monthlyNewPurchases: 743 }),
      new Array(60).fill(25),
      60,
      false,
    );

    // This is the condition the display guard keys on. If it ever stops being null for a card that
    // genuinely never clears, the tile silently starts printing the divergent figure again.
    expect(proj.payoffMonth).toBeNull();
    // Not a precise pin — the point is the ORDER OF MAGNITUDE, which is what makes it unshowable.
    expect(proj.totalInterest).toBeGreaterThan(1_000_000);
  });

  it('an ordinary card that DOES pay off still reports a real, showable total', () => {
    const proj = projectCardVariable(
      makeCard({ balance: 2000, apr: 18, creditLimit: 10000, minPayment: 300, targetPayment: 300, monthlyNewPurchases: 0 }),
      new Array(60).fill(300),
      60,
      false,
    );
    expect(proj.payoffMonth).not.toBeNull();
    expect(proj.totalInterest).toBeLessThan(1000);
  });
});

describe('totalInterestLabel', () => {
  it('refuses to show a total for a card that never pays off', () => {
    expect(totalInterestLabel(null)).toBe(NO_PAYOFF_LABEL);
    expect(totalInterestLabel(undefined)).toBe(NO_PAYOFF_LABEL);
  });

  it('returns null for a real payoff, so the caller formats the actual figure', () => {
    expect(totalInterestLabel(12)).toBeNull();
    // Month 0 is a real payoff month and must NOT be swallowed by a falsy check — the bug this
    // assertion exists to prevent is `!payoffMonth`, which treats 0 as "never".
    expect(totalInterestLabel(0)).toBeNull();
  });
});

describe('interestSavingsBullet — the same divergence attached to a SALES claim', () => {
  it('never promises savings that do not exist', () => {
    // "Save $19,007,108 in total interest" beside a price is not a benefit, it is a false promise.
    expect(interestSavingsBullet(null, '$19,007,108')).not.toContain('19,007,108');
    expect(interestSavingsBullet(null, '$19,007,108')).not.toContain('Save');
  });

  it('still makes the real offer when there IS a real total', () => {
    expect(interestSavingsBullet(24, '$1,240')).toBe('Save $1,240 in total interest');
  });
});
