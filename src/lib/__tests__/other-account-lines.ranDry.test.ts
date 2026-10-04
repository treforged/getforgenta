/**
 * 951af777: a transfer whose source ran dry must show what MOVED, and say the source ran dry.
 * The drawer used to print the REQUESTED $65 in a month the source gave $35.
 */
import { describe, it, expect } from 'vitest';
import { buildOtherAccountLines } from '@/lib/other-account-lines';

const money = (n: number, _cents: boolean) => `$${n.toFixed(2)}`;
const t = (amount: number, requestedAmount?: number) => ({
  name: 'To brokerage', fromAcctId: 'sav-1', fromAcctName: 'Savings', toAcctId: 'brk-1', toAcctName: 'Brokerage',
  amount, ...(requestedAmount != null ? { requestedAmount } : {}),
});

describe('buildOtherAccountLines - a source that ran dry (951af777)', () => {
  it('prints the moved amount on both ends and names the shortfall', () => {
    const lines = buildOtherAccountLines({ nonCashTransferItems: [t(35, 65)] }, money);
    const items = lines.filter(l => l.op === '−' || l.op === '+');
    expect(items.map(l => l.value)).toEqual(['$35.00', '$35.00']);
    expect(items[0].label).toContain('asked $65.00');
    expect(items[0].label).toContain('ran dry');
    expect(lines.filter(l => l.op === '=').map(l => l.value)).toEqual(['−$35.00', '+$35.00']);
  });

  it('still shows a transfer that moved NOTHING, rather than dropping it', () => {
    const lines = buildOtherAccountLines({ nonCashTransferItems: [t(0, 65)] }, money);
    const src = lines.find(l => l.label.includes('To brokerage'));
    expect(src?.value).toBe('$0.00');
    expect(src?.label).toContain('asked $65.00');
  });

  it('a fully funded transfer reads exactly as before', () => {
    const lines = buildOtherAccountLines({ nonCashTransferItems: [t(65)] }, money);
    expect(lines.some(l => /asked|ran dry/.test(l.label))).toBe(false);
  });
});
