// What a charge may be linked TO. These were closures inside `BankActivity.tsx` until the Decision
// Deck needed pickers of its own; the tests exist so the two surfaces cannot end up offering
// different destinations for the same charge.

import { describe, it, expect } from 'vitest';
import {
  pickableRules, pickablePlans, nearestLedgerOptions, amountLabel, LEDGER_PICKER_LIMIT, daysApart,
} from '@/lib/review-link-options';

describe('pickableRules / pickablePlans', () => {
  const rows = [
    { id: 'c', name: 'Water', active: true },
    { id: 'a', name: 'Rent', active: true },
    { id: 'b', name: 'Old gym', active: false },
    { id: 'd', name: 'Internet', active: null },
  ];

  // An inactive rule describes nothing that still bills, so it cannot be what a charge settled.
  // Offering one would let a user record a link to an obligation that no longer exists.
  it('offers only ACTIVE rows', () => {
    expect(pickableRules(rows).map(r => r.id)).toEqual(['a', 'c']);
    expect(pickablePlans(rows).map(r => r.id)).toEqual(['a', 'c']);
  });

  it('sorts by name so the same charge lists its destinations in the same order everywhere', () => {
    expect(pickableRules(rows).map(r => r.name)).toEqual(['Rent', 'Water']);
  });

  it('does not mutate the caller list — a memoised array must survive being offered', () => {
    const original = [...rows];
    pickableRules(rows);
    expect(rows).toEqual(original);
  });
});

describe('amountLabel', () => {
  it('names the destination and what it bills, always positive', () => {
    expect(amountLabel('Rent', 1915)).toBe('Rent · $1,915');
    expect(amountLabel('Rent', -1915)).toBe('Rent · $1,915');
  });

  // A rule with no amount recorded still has to be pickable; NaN in a label is a broken row.
  it('never renders NaN for a missing or unparseable amount', () => {
    expect(amountLabel('Rent', null)).toBe('Rent · $0');
    expect(amountLabel('Rent', 'x')).toBe('Rent · $0');
  });
});

describe('nearestLedgerOptions', () => {
  const ledger = [
    { id: 'far', date: '2026-01-01', category: 'Dining', amount: 10 },
    { id: 'near', date: '2026-06-10', category: 'Car', amount: 219.99 },
    { id: 'mid', date: '2026-05-01', category: 'Bills', amount: 50 },
  ];

  // The entry a bank charge belongs to is almost always within days of it, and the ledger spans
  // months — unordered, the right answer is buried under everything else the user ever recorded.
  it('puts the entries nearest the charge date first', () => {
    expect(nearestLedgerOptions(ledger, '2026-06-11').map(o => o.value)).toEqual(['near', 'mid', 'far']);
  });

  it('labels an entry with its date, category and absolute amount', () => {
    expect(nearestLedgerOptions(ledger, '2026-06-11')[0].label).toBe('2026-06-10 · Car · $220');
  });

  // The cap keeps a <select> usable on a phone. It is a cap on the OFFER — never a claim that the
  // entries past it are wrong — so it must be applied AFTER the sort, or it would cut off the
  // nearest entries rather than the furthest.
  it('caps the offer after ordering, not before', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `d${i}`, date: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`, category: 'Other', amount: i,
    }));
    const out = nearestLedgerOptions(many, '2026-06-11');
    expect(out).toHaveLength(LEDGER_PICKER_LIMIT);
    expect(out[0].label).toContain('2026-06-11');
  });

  it('does not mutate the ledger it was handed', () => {
    const original = [...ledger];
    nearestLedgerOptions(ledger, '2026-06-11');
    expect(ledger).toEqual(original);
  });
});

describe('daysApart', () => {
  it('is symmetric and counts whole days', () => {
    expect(daysApart('2026-06-01', '2026-06-11')).toBe(10);
    expect(daysApart('2026-06-11', '2026-06-01')).toBe(10);
    expect(daysApart('2026-06-11', '2026-06-11')).toBe(0);
  });
});
