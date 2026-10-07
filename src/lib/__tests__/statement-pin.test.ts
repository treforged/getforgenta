// Drafted by groq gpt-oss-120b, reviewed by Ada 2026-10-07 (non-breaking spaces replaced).
// Assumption: the test file is placed at src/lib/__tests__/statement-pin.test.ts and uses Vitest globals.

import { describe, it, expect } from 'vitest';
import { hasPinnedStatement } from '../statement-pin';
import type { CardData } from '@/lib/credit-card-engine';

// Helper to create a CardData object with sensible defaults.
function card(o: Record<string, unknown>): CardData {
  return ({
    paymentPreference: 'statement',
    statementBalance: 500,
    balance: 800,
    startDate: null,
    ...o,
  } as unknown) as CardData;
}

// Fixed "now" date: local time October 7 2026.
const now = new Date(2026, 9, 7); // month index 9 = October

describe('hasPinnedStatement', () => {
  it('defaults to true when all eligibility criteria are met', () => {
    // Default card: paymentPreference='statement', statementBalance=500, balance=800, startDate=null
    expect(hasPinnedStatement(card({}), now)).toBe(true);
  });

  it('returns false when paymentPreference is not "statement"', () => {
    // Override paymentPreference to a non‑statement option.
    expect(hasPinnedStatement(card({ paymentPreference: 'minimum' }), now)).toBe(false);
  });

  it('returns false when statementBalance is null', () => {
    // Explicitly set statementBalance to null.
    expect(hasPinnedStatement(card({ statementBalance: null }), now)).toBe(false);
  });

  it('returns false when statementBalance is undefined', () => {
    // Explicitly set statementBalance to undefined (overwrites default).
    expect(hasPinnedStatement(card({ statementBalance: undefined }), now)).toBe(false);
  });

  it('returns true when statementBalance is zero (zero is not null)', () => {
    // Set statementBalance to 0; other checks still pass.
    expect(hasPinnedStatement(card({ statementBalance: 0 }), now)).toBe(true);
  });

  it('returns false when balance is zero', () => {
    // Balance must be > 0; setting to 0 should fail.
    expect(hasPinnedStatement(card({ balance: 0 }), now)).toBe(false);
  });

  it('returns false when balance is negative', () => {
    // Negative balance also fails the > 0 check.
    expect(hasPinnedStatement(card({ balance: -1 }), now)).toBe(false);
  });

  it('returns false when startDate is in the next month', () => {
    // startDate = 2026‑11‑01 (next month relative to now) should be ineligible.
    expect(hasPinnedStatement(card({ startDate: '2026-11-01' }), now)).toBe(false);
  });

  it('returns true when startDate is in the same month', () => {
    // startDate = 2026‑10‑31 (same month as now) should be eligible.
    expect(hasPinnedStatement(card({ startDate: '2026-10-31' }), now)).toBe(true);
  });

  it('returns true when startDate is in a past month', () => {
    // startDate = 2025‑01‑01 (past) should be eligible.
    expect(hasPinnedStatement(card({ startDate: '2025-01-01' }), now)).toBe(true);
  });

  it('returns false when startDate is in a future year', () => {
    // startDate = 2027‑01‑15 (future year) should be ineligible.
    expect(hasPinnedStatement(card({ startDate: '2027-01-15' }), now)).toBe(false);
  });
});
