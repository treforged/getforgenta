// ROLLING SPEND UP TO GROUPS MUST NOT LOSE A PENNY.
//
// Tre, 2026-09-15: *"generalize the categories, make the dashboard a quick look, push detail to
// where it belongs."* The rollup is the generalising half. It changes nothing about what a
// category IS and rewrites no rows — but it does decide what a money figure on the dashboard
// says, which is why the total is asserted rather than assumed.
//
// ⚠️ THE DEFECT THIS WAS WRITTEN AGAINST IS REAL AND WAS MEASURED, NOT IMAGINED. The obvious
// implementation walks `CATEGORY_GROUPS` and sums each group's categories. On /demo the
// breakdown carries `Auto Loan Interest`, which is in no `CATEGORIES` entry — the model mints it
// itself — so that implementation would have dropped it from the dashboard total while every
// test about "groups cover categories" stayed green. The key exists; it is simply not a category.

import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_GROUPS,
  UNGROUPED_LABEL,
  categoryGroupOf,
  rollUpByGroup,
} from '../types';

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('categoryGroupOf', () => {
  it('has a positive control: there are categories and groups to map between', () => {
    // Without this, "every category maps" is satisfied by an empty list.
    expect(CATEGORIES.length).toBeGreaterThan(0);
    expect(CATEGORY_GROUPS.length).toBeGreaterThan(0);
  });

  it('maps every declared category to a declared group', () => {
    const labels = new Set(CATEGORY_GROUPS.map(g => g.label));
    const unmapped = CATEGORIES.filter(c => !labels.has(categoryGroupOf(c)));
    expect(unmapped).toEqual([]);
  });

  it('maps the model’s own synthetic key rather than dropping it', () => {
    // Measured on /demo: this key is in the breakdown and in no CATEGORIES entry.
    expect((CATEGORIES as readonly string[]).includes('Auto Loan Interest')).toBe(false);
    expect(categoryGroupOf('Auto Loan Interest')).toBe('Transport');
  });

  it('gives an unrecognised key a real home instead of losing it', () => {
    expect(categoryGroupOf('Something Nobody Declared')).toBe(UNGROUPED_LABEL);
  });
});

describe('rollUpByGroup', () => {
  it('preserves the total exactly, including keys that are not categories', () => {
    const breakdown = {
      Groceries: 412.55, Dining: 88.2, Car: 260, Gas: 74.31,
      'Auto Loan Interest': 91.07, Bills: 310, 'Something Nobody Declared': 19.99,
    };
    const rolled = rollUpByGroup(breakdown);
    const rolledTotal = rolled.reduce((s, g) => s + g.value, 0);
    expect(rolledTotal).toBeCloseTo(sum(breakdown), 10);
  });

  it('puts every input key in exactly one group', () => {
    const breakdown = { Groceries: 1, Dining: 2, Car: 3, 'Auto Loan Interest': 4, Zzz: 5 };
    const rolled = rollUpByGroup(breakdown);
    const parts = rolled.flatMap(g => g.parts.map(p => p.name));
    expect(parts.slice().sort()).toEqual(Object.keys(breakdown).slice().sort());
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('orders groups and their parts largest first', () => {
    const rolled = rollUpByGroup({ Groceries: 10, Dining: 50, Car: 300, Gas: 5 });
    expect(rolled.map(g => g.label)).toEqual(['Transport', 'Everyday']);
    expect(rolled[0].parts.map(p => p.name)).toEqual(['Car', 'Gas']);
    expect(rolled[1].parts.map(p => p.name)).toEqual(['Dining', 'Groceries']);
  });

  it('returns nothing for an empty breakdown rather than inventing empty groups', () => {
    // A dashboard with no spend must show no rows, not six rows of zero.
    expect(rollUpByGroup({})).toEqual([]);
  });
});
