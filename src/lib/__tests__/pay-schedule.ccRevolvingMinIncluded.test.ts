import { describe, it, expect } from 'vitest';
import { getAugmentedMinSafeCash, buildPayConfig } from '../pay-schedule';

// getAugmentedMinSafeCash now also reports how much of its own floor is attributable to
// revolving cards' minimum payments specifically (ccRevolvingMinIncluded) — used by
// simulateVariablePayoff to avoid reserving the same dollars a second time via its own
// reservedForRevolving once the floor has already accounted for them.
//
// Also covers the cycling/backlog extension: once a cycling card carries backlog (unpaid
// statement debt — see credit-card-engine.ts's cyclingBacklog), simulateVariablePayoff's
// reservedForRevolving ALSO reserves its minimum (so Step 5's avalanche cascade guarantee for it
// isn't starved by the mandatory pool) — ccRevolvingMinIncluded must count that overlap too, or
// the exact double-reservation bug this mechanism exists to prevent reappears for backlog cards.

const now = new Date(2026, 5, 20);
const config = buildPayConfig({});

function run(
  simCards: any[], monthlyRevolvingBalances: Map<string, number[]>, perCardMinPayments: Map<string, number[]>,
  monthlyCyclingBacklog?: Map<string, number[]>,
) {
  return getAugmentedMinSafeCash([], config, 1000, null, now, [], { simCards, monthlyRevolvingBalances, perCardMinPayments, monthlyCyclingBacklog }, 0);
}

describe('getAugmentedMinSafeCash — ccRevolvingMinIncluded', () => {
  it('counts a revolving card with a dueDay toward ccRevolvingMinIncluded', () => {
    const card = { id: 'card-a', name: 'Card A', dueDay: 1, paymentPreference: 'statement' as const, autopayFullBalance: false, minPayment: 150 };
    const revBal = new Map([['card-a', [4000]]]);
    const minPay = new Map([['card-a', [150]]]);
    const { ccRevolvingMinIncluded } = run([card], revBal, minPay);
    expect(ccRevolvingMinIncluded).toBe(150);
  });

  it('does not count a cycling/paid-off card toward ccRevolvingMinIncluded, even though its floor item shares the "<name> min" naming', () => {
    const card = { id: 'card-b', name: 'Card B', dueDay: 15, paymentPreference: 'full' as const, autopayFullBalance: true, minPayment: 0 };
    const revBal = new Map([['card-b', [0]]]); // revBal <= 0 -> the cycling/"else" branch
    const minPay = new Map([['card-b', [0]]]);
    const { ccRevolvingMinIncluded, floorItems } = run([card], revBal, minPay);
    // The cycling branch still adds its own floor item (a separate, unrelated reservation)...
    expect(floorItems.find(i => i.name === 'Card B min')).toBeUndefined(); // minPayment 0 here, so no item either way
    // ...but regardless, it must never contribute to ccRevolvingMinIncluded.
    expect(ccRevolvingMinIncluded).toBe(0);
  });

  it('does not count a revolving card missing a dueDay — matches the existing gate, so the floor genuinely has a gap for it', () => {
    const card = { id: 'card-c', name: 'Card C', dueDay: null, paymentPreference: 'statement' as const, autopayFullBalance: false, minPayment: 200 };
    const revBal = new Map([['card-c', [3000]]]);
    const minPay = new Map([['card-c', [200]]]);
    const { ccRevolvingMinIncluded } = run([card], revBal, minPay);
    expect(ccRevolvingMinIncluded).toBe(0);
  });

  it('sums across multiple revolving cards', () => {
    const cardA = { id: 'card-a', name: 'Card A', dueDay: 1, paymentPreference: 'statement' as const, autopayFullBalance: false, minPayment: 150 };
    const cardB = { id: 'card-d', name: 'Card D', dueDay: 11, paymentPreference: 'statement' as const, autopayFullBalance: false, minPayment: 99 };
    const revBal = new Map([['card-a', [4000]], ['card-d', [2000]]]);
    const minPay = new Map([['card-a', [150]], ['card-d', [99]]]);
    const { ccRevolvingMinIncluded } = run([cardA, cardB], revBal, minPay);
    expect(ccRevolvingMinIncluded).toBe(249);
  });

  it('counts a cycling card toward ccRevolvingMinIncluded once it carries backlog', () => {
    const card = { id: 'card-e', name: 'Card E', dueDay: 7, paymentPreference: 'statement' as const, autopayFullBalance: true, minPayment: 25 };
    const revBal = new Map([['card-e', [0]]]); // cycling — revBal <= 0
    const minPay = new Map([['card-e', [0]]]);
    const backlog = new Map([['card-e', [350]]]); // carries backlog this month
    const { ccRevolvingMinIncluded, floorItems } = run([card], revBal, minPay, backlog);
    // The cycling branch's own floor item is unaffected — still reserved, same as always.
    expect(floorItems.find(i => i.name === 'Card E min')?.amount).toBe(25);
    // But NOW it also counts toward ccRevolvingMinIncluded, since reservedForRevolving will
    // ALSO reserve this card's minimum once it has backlog.
    expect(ccRevolvingMinIncluded).toBe(25);
  });

  it('does not count a cycling card with NO backlog toward ccRevolvingMinIncluded, even when monthlyCyclingBacklog is supplied', () => {
    const card = { id: 'card-f', name: 'Card F', dueDay: 7, paymentPreference: 'statement' as const, autopayFullBalance: true, minPayment: 25 };
    const revBal = new Map([['card-f', [0]]]);
    const minPay = new Map([['card-f', [0]]]);
    const backlog = new Map([['card-f', [0]]]); // no backlog this month
    const { ccRevolvingMinIncluded } = run([card], revBal, minPay, backlog);
    expect(ccRevolvingMinIncluded).toBe(0);
  });

  it('omitting monthlyCyclingBacklog entirely behaves exactly like the no-backlog case — backward compatible', () => {
    const card = { id: 'card-g', name: 'Card G', dueDay: 7, paymentPreference: 'statement' as const, autopayFullBalance: true, minPayment: 25 };
    const revBal = new Map([['card-g', [0]]]);
    const minPay = new Map([['card-g', [0]]]);
    const { ccRevolvingMinIncluded } = run([card], revBal, minPay); // no 4th arg at all
    expect(ccRevolvingMinIncluded).toBe(0);
  });
});
