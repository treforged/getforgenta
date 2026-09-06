import { describe, it, expect } from 'vitest';
import { buildAutoExtraLedgerRows } from '../auto-extra-ledger-rows';

// Tre, 2026-09-02: AUTO EXTRA PAYMENTS and TRANSFERS must show in Transactions.
//
// The ranked surplus the engine diverts to a goal, car fund or loan is real money leaving checking.
// The Forecast month drawer itemised it and the CSV export listed it; the ledger showed none of it.
// These rows come off the engine's OWN named list, so the three surfaces cannot disagree.

const row = (items: { id: string; name: string; kind: 'car_fund' | 'goal' | 'loan' | 'liability'; amount: number }[]) =>
  ({ autoExtraItems: items });

const GOAL = { id: 'goal-move', name: 'Move Fund', kind: 'goal' as const, amount: 250 };
const LOAN = { id: 'loan-1', name: 'Student Loan', kind: 'loan' as const, amount: 100 };

describe('buildAutoExtraLedgerRows', () => {
  it('turns a month’s reserve into a dated ledger row, named as the drawer names it', () => {
    const [r] = buildAutoExtraLedgerRows([row([GOAL])], new Date(2026, 8, 6), 12);
    expect(r.amount).toBe(250);
    expect(r.label).toBe('Move Fund — Extra Contribution');
    expect(r.targetId).toBe('goal-move');
    expect(r.monthIndex).toBe(0);
  });

  // 'loan' and 'liability' retire debt; the label must say Payment, not Contribution.
  it('names a liability reserve a payment', () => {
    const [r] = buildAutoExtraLedgerRows([row([LOAN])], new Date(2026, 8, 6), 12);
    expect(r.label).toBe('Student Loan — Extra Payment');
  });

  // Index 0 is the CURRENT month, and the date is the last day of it — a ranked extra is what is
  // left after that month's obligations, not a payment on a day anybody chose.
  it('dates each row to the last day of its own month, index 0 being now', () => {
    const rows = buildAutoExtraLedgerRows([row([GOAL]), row([GOAL]), row([GOAL])], new Date(2026, 8, 6), 12);
    expect(rows.map(r => r.date)).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
  });

  // February is the case a hand-rolled "day 31" gets wrong, and a leap year is the case a
  // hand-rolled "day 28" gets wrong. Both come out of the same Date arithmetic.
  it('clamps February correctly, leap year included', () => {
    expect(buildAutoExtraLedgerRows([row([GOAL])], new Date(2026, 1, 3), 1)[0].date).toBe('2026-02-28');
    expect(buildAutoExtraLedgerRows([row([GOAL])], new Date(2028, 1, 3), 1)[0].date).toBe('2028-02-29');
  });

  // The id must differ per month or React keys collide and the later rows vanish.
  it('gives every month its own id', () => {
    const rows = buildAutoExtraLedgerRows([row([GOAL]), row([GOAL])], new Date(2026, 8, 6), 12);
    expect(new Set(rows.map(r => r.id)).size).toBe(2);
  });

  it('renders nothing for a zero or absent reserve rather than a sourceless figure', () => {
    expect(buildAutoExtraLedgerRows([row([{ ...GOAL, amount: 0 }])], new Date(2026, 8, 6), 12)).toHaveLength(0);
    expect(buildAutoExtraLedgerRows([row([{ ...GOAL, amount: Number.NaN }])], new Date(2026, 8, 6), 12)).toHaveLength(0);
    expect(buildAutoExtraLedgerRows([{}], new Date(2026, 8, 6), 12)).toHaveLength(0);
  });

  it('stops at the shorter of the horizon and the rows it was given', () => {
    expect(buildAutoExtraLedgerRows([row([GOAL]), row([GOAL]), row([GOAL])], new Date(2026, 8, 6), 2)).toHaveLength(2);
    expect(buildAutoExtraLedgerRows([row([GOAL])], new Date(2026, 8, 6), 60)).toHaveLength(1);
  });

  it('emits one row per target in a month', () => {
    expect(buildAutoExtraLedgerRows([row([GOAL, LOAN])], new Date(2026, 8, 6), 1)).toHaveLength(2);
  });
});
