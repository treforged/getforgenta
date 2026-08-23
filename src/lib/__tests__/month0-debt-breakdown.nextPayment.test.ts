import { describe, it, expect } from 'vitest';
import { buildCardRecRows } from '../month0-debt-breakdown';
import type { CardData } from '../credit-card-engine';

/**
 * The shared card-row builder both "Recommended This Month" surfaces consume — /debt's panel
 * (CreditCardEngine.month0Recs) and the Dashboard widget (buildMonth0DebtBreakdown). One
 * derivation is the whole point: these pin the A.2 rules — the calendar decides the month, a
 * missing month-1 figure stays null (never a confident zero), and the badge/reason is judged
 * against the SAME figure the row leads with.
 */

const card = (over: Partial<CardData> & { id: string; name: string }): CardData => ({
  balance: 1000,
  apr: 20,
  creditLimit: 5000,
  minPayment: 35,
  targetPayment: 0,
  monthlyNewPurchases: 0,
  monthlyRepayments: 0,
  color: '#123456',
  paymentPreference: null,
  autopayFullBalance: false,
  dueDay: 20,
  statementBalancePhase: false,
  statementBalance: null,
  ...over,
});

// Fixed clock: Aug 4, 2026 — due day 20 is upcoming, due day 1 has passed.
const NOW = new Date(2026, 7, 4);

describe('buildCardRecRows — the calendar decides the month', () => {
  it('leads with this month when the due day has not passed', () => {
    const [row] = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Sapphire', payment: 450, maxPayment: 450 }],
      cards: [card({ id: 'a', name: 'Sapphire', dueDay: 20 })],
      strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [450, 999] }],
      now: NOW,
    });
    expect(row).toMatchObject({ nextPayMonth: 0, nextPayment: 450, pastDue: false });
    expect(row.nextDueDate?.getMonth()).toBe(7); // Aug 20
    expect(row.nextDueDate?.getDate()).toBe(20);
  });

  it("leads with the month-1 series figure once the due day has passed, and flags the save", () => {
    const [row] = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Sapphire', payment: 0, maxPayment: 0 }],
      cards: [card({ id: 'a', name: 'Sapphire', dueDay: 1 })],
      strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [0, 620] }],
      now: NOW,
    });
    expect(row).toMatchObject({ nextPayMonth: 1, nextPayment: 620, pastDue: true });
    expect(row.nextDueDate?.getMonth()).toBe(8); // Sep 1
    expect(row.nextDueDate?.getDate()).toBe(1);
  });
});

describe('buildCardRecRows — a missing month-1 figure is null, never zero', () => {
  it('returns null nextPayment and an empty reason when there is no series at all', () => {
    const [row] = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Sapphire', payment: 0, maxPayment: 0 }],
      cards: [card({ id: 'a', name: 'Sapphire', dueDay: 1 })],
      strategy: 'avalanche',
      nextMonthSource: null,
      now: NOW,
    });
    expect(row.nextPayment).toBeNull();
    // No classification of an amount that does not exist — "Not modelled" must never sit
    // beside a confident "Avalanche priority" on the same line.
    expect(row.reason).toBe('');
    expect(row.isMinimumOnly).toBe(false);
  });

  it('returns null when the series exists but has no month-1 entry', () => {
    const [row] = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Sapphire', payment: 0, maxPayment: 0 }],
      cards: [card({ id: 'a', name: 'Sapphire', dueDay: 1 })],
      strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [0] }],
      now: NOW,
    });
    expect(row.nextPayment).toBeNull();
  });
});

describe('buildCardRecRows — the reason is judged against the headline figure', () => {
  it('classifies min-only against next month, not this month', () => {
    // This month's pinned payment is $600 (would read "priority"), but the headline is next
    // month's $35 minimum — the badge must describe the figure the row leads with.
    const [row] = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Sapphire', payment: 600, maxPayment: 600 }],
      cards: [card({ id: 'a', name: 'Sapphire', dueDay: 1, minPayment: 35 })],
      strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [600, 35] }],
      now: NOW,
    });
    expect(row).toMatchObject({ nextPayment: 35, reason: 'Minimum payment', isMinimumOnly: true });
  });

  it('tests pinned-statement COVERAGE, not just eligibility', () => {
    const pinned = card({
      id: 'a', name: 'Prime Visa', dueDay: 20, paymentPreference: 'statement', statementBalance: 500,
    });
    const covered = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Prime Visa', payment: 500, maxPayment: 500 }],
      cards: [pinned], strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [500, 0] }], now: NOW,
    })[0];
    const partial = buildCardRecRows({
      perCardAdjusted: [{ id: 'a', name: 'Prime Visa', payment: 300, maxPayment: 300 }],
      cards: [pinned], strategy: 'avalanche',
      nextMonthSource: [{ id: 'a', payments: [300, 0] }], now: NOW,
    })[0];
    expect(covered.reason).toBe('Statement balance');
    expect(partial.reason).toBe('Partial statement');
  });
});
