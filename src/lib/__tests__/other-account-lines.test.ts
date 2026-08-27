/**
 * The month popup's "Other Accounts" section — Tre, 2026-08-27: *"make a new section that shows the
 * change in other accounts when there is one."*
 */
import { describe, it, expect } from 'vitest';
import { buildOtherAccountLines } from '@/lib/other-account-lines';

const fmt = (n: number) => `$${n.toFixed(2)}`;
const money = (n: number, _cents: boolean) => fmt(n);

describe('buildOtherAccountLines', () => {
  it('renders NOTHING when no other account moved — "when there is one"', () => {
    expect(buildOtherAccountLines({}, money)).toEqual([]);
    expect(buildOtherAccountLines({
      nonCashTransferItems: [], otherAccountExpenseItems: [], otherAccountOneTimeItems: [],
    }, money)).toEqual([]);
  });

  it('groups by account and closes each group with its own net', () => {
    const lines = buildOtherAccountLines({
      otherAccountOneTimeItems: [
        { name: 'Lease break fee', fromAcctId: 'sav-1', fromAcctName: 'Savings Account', amount: 3_830 },
      ],
      otherAccountExpenseItems: [
        { name: 'Storage unit', fromAcctId: 'sav-1', fromAcctName: 'Savings Account', amount: 200 },
      ],
    }, money);
    expect(lines.map(l => l.label.trim())).toEqual([
      'Other Accounts (not the account above)',
      'Savings Account',
      'Storage unit',
      'Lease break fee',
      'Net change from these',
      '',
    ]);
    expect(lines.filter(l => l.op === '−').map(l => l.value)).toEqual(['$200.00', '$3830.00']);
    expect(lines.find(l => l.op === '=')!.value).toBe('−$4030.00');
  });

  it('shows BOTH ENDS of a transfer between two non-cash accounts', () => {
    // ⚠️ Without the receiving end this reads as money that simply left the plan.
    const lines = buildOtherAccountLines({
      nonCashTransferItems: [{
        name: 'Monthly invest', fromAcctId: 'sav-1', fromAcctName: 'Savings Account',
        toAcctId: 'brk-1', toAcctName: 'Brokerage', amount: 500,
      }],
    }, money);
    const sav = lines.findIndex(l => l.label.trim() === 'Savings Account');
    const brk = lines.findIndex(l => l.label.trim() === 'Brokerage');
    expect(sav).toBeGreaterThan(-1);
    expect(brk).toBeGreaterThan(sav);
    const nets = lines.filter(l => l.op === '=').map(l => l.value);
    expect(nets).toEqual(['−$500.00', '+$500.00']);
  });

  it('still lists a transfer with no recorded destination, as one side only', () => {
    const lines = buildOtherAccountLines({
      nonCashTransferItems: [{
        name: 'C5 Down Payment', fromAcctId: '', fromAcctName: 'Savings Account',
        toAcctId: null, toAcctName: '', amount: 7_700,
      }],
    }, money);
    expect(lines.filter(l => l.op === '=').map(l => l.value)).toEqual(['−$7700.00']);
  });

  it('drops a sub-cent movement rather than printing a $0.00 line', () => {
    expect(buildOtherAccountLines({
      otherAccountOneTimeItems: [
        { name: 'Dust', fromAcctId: 'sav-1', fromAcctName: 'Savings Account', amount: 0.001 },
      ],
    }, money)).toEqual([]);
  });
});
