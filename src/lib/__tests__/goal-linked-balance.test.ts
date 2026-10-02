import { describe, expect, it } from 'vitest';
import { computeGoalCompletionIdx, goalLinkedBalance } from '@/lib/goal-linkage';

// Tre's real shape (ask 4674b24a): one Brokerage goal over four non-retirement investment accounts.
const BAL: Record<string, number> = { rh1: 1293.04, crypto: 541.09, fid: 173, rh2: 115.195, roth: 991 };
const balanceOf = (id: string) => (id in BAL ? BAL[id] : null);

describe('goalLinkedBalance (ask 4674b24a)', () => {
  it('sums the primary and every extra account', () => {
    const g = { linked_account: 'rh1', also_linked_accounts: ['crypto', 'fid', 'rh2'] };
    expect(goalLinkedBalance(g, balanceOf)).toBeCloseTo(2122.325, 6);
  });

  it('with no extras it is exactly the primary balance (unchanged behaviour)', () => {
    expect(goalLinkedBalance({ linked_account: 'rh1' }, balanceOf)).toBe(1293.04);
    expect(goalLinkedBalance({ linked_account: 'rh1', also_linked_accounts: [] }, balanceOf)).toBe(1293.04);
  });

  it('is null when the primary does not resolve, so callers keep current_amount', () => {
    expect(goalLinkedBalance({ linked_account: 'deleted', also_linked_accounts: ['fid'] }, balanceOf)).toBeNull();
    expect(goalLinkedBalance({ linked_account: null, also_linked_accounts: ['fid'] }, balanceOf)).toBeNull();
  });

  it('counts a repeated id and the primary listed again only once, and skips a deleted extra', () => {
    const g = { linked_account: 'rh1', also_linked_accounts: ['rh1', 'fid', 'fid', 'gone'] };
    expect(goalLinkedBalance(g, balanceOf)).toBeCloseTo(1466.04, 6);
  });

  it('feeds the completion projection: a target the sum has reached completes at month 0', () => {
    const goal = { id: 'g', target_amount: 2000, current_amount: 1.63, monthly_contribution: 0, linked_account: 'rh1', also_linked_accounts: ['crypto', 'fid', 'rh2'] };
    const accounts = Object.entries(BAL).map(([id, balance]) => ({ id, balance }));
    const today = new Date(2026, 9, 1);
    expect(computeGoalCompletionIdx(goal, [], accounts, today)).toBe(0);
    expect(computeGoalCompletionIdx({ ...goal, also_linked_accounts: [] }, [], accounts, today)).not.toBe(0);
  });
});
