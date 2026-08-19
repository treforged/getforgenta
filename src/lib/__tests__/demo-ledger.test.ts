// ⚠️ WHAT THIS PROTECTS. `demo-data.ts` is the sales surface (`design/DIRECTION.md`), and every
// fault it has ever had was invisible from the fixture and obvious with the app open. Each block
// below pins one of them against the app's OWN code rather than against a number written here:
//
//   1. The demo ledger raised "Possible duplicate payment — 4 months" across its own top, because
//      every recurring row restated a row `demoRecurringRules` already generates.
//   2. The Dashboard draws six months of cash flow from recorded rows; the fixture carried four,
//      so it opened on two empty bars.
//   3. Notes carried literal month names against relative dates ("Roommate – April" on 2026-08-01).
//   4. The bank feed served `pending: false` charges dated after today.
//   5. Net worth history was frozen in Jan–Apr 2026 and ended $26k away from the tile above it.
//   6. Three of the five `/debt` panels had nothing in them, and Other Debts read "$0 / $0 / $0".
import { describe, it, expect } from 'vitest';
import {
  demoTransactions, demoSyncedTransactions, demoNetWorthSnapshots,
  demoDebts, demoAccounts, demoRecurringRules, demoCarFunds, demoAssets, demoLiabilities,
} from '@/lib/demo-data';
import { scanForDuplicateTransactions } from '@/lib/duplicate-transaction-detection';
import type { RuleRow, AccountRow } from '@/hooks/useSupabaseData';
import type { CarFund } from '@/lib/types';

const withIds = demoTransactions.map((t, i) => ({ ...t, id: String(i) }));
const today = new Date().toISOString().split('T')[0];
const monthKey = (offset: number) => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

describe('the demo ledger does not accuse itself of double-charging', () => {
  it('produces no duplicate collisions against its own recurring rules', () => {
    const collisions = scanForDuplicateTransactions({
      transactions: withIds,
      rules: demoRecurringRules as unknown as RuleRow[],
      accounts: demoAccounts as unknown as AccountRow[],
      paymentPlans: [],
      carFunds: demoCarFunds as unknown as CarFund[],
    });
    expect(collisions).toEqual([]);
  });

  // The exemption is `origin: 'synced'`, and it has to stay TRUE rather than blanket: a row a
  // person typed must still be caught. Drop the marker and the warning comes straight back.
  it('would still catch a typed row that restates a rule', () => {
    const asTyped = withIds.map(t => ({ ...t, origin: 'manual' }));
    const collisions = scanForDuplicateTransactions({
      transactions: asTyped,
      rules: demoRecurringRules as unknown as RuleRow[],
      accounts: demoAccounts as unknown as AccountRow[],
      paymentPlans: [],
      carFunds: demoCarFunds as unknown as CarFund[],
    });
    expect(collisions.length).toBeGreaterThan(0);
  });
});

describe('the demo never ages into empty or impossible dates', () => {
  it('has recorded rows in each of the five months the cash flow chart draws behind today', () => {
    for (let back = 1; back <= 5; back++) {
      const key = monthKey(-back);
      expect(demoTransactions.some(t => t.date.startsWith(key)), `no rows in ${key}`).toBe(true);
    }
  });

  it('names no month in a note, because the dates move and the words would not', () => {
    const months = /January|February|March|April|May|June|July|August|September|October|November|December|\bJan\b|\bFeb\b|\bMar\b|\bApr\b|\bJun\b|\bJul\b|\bAug\b|\bSep\b|\bOct\b|\bNov\b|\bDec\b/;
    const offenders = demoTransactions.filter(t => months.test(t.note));
    expect(offenders.map(t => t.note)).toEqual([]);
  });

  it('serves no settled bank charge dated after today', () => {
    const future = demoSyncedTransactions.filter(c => c.date > today);
    expect(future.map(c => `${c.merchant_name} ${c.date}`)).toEqual([]);
  });
});

describe('net worth history ends where the tile above it says it does', () => {
  it('runs to within a week of today and starts about six months back', () => {
    const dates = demoNetWorthSnapshots.map(s => s.snapshot_date);
    const lastGap = (Date.parse(today) - Date.parse(dates[dates.length - 1])) / 86_400_000;
    const span = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
    expect(lastGap).toBeGreaterThanOrEqual(0);
    expect(lastGap).toBeLessThan(7);
    expect(span).toBeGreaterThan(150);
  });

  it('closes on the totals the rest of the fixture declares', () => {
    const last = demoNetWorthSnapshots[demoNetWorthSnapshots.length - 1];
    const accountAssets = demoAccounts
      .filter(a => a.account_type !== 'credit_card' && a.account_type !== 'student_loan')
      .reduce((s, a) => s + a.balance, 0);
    const manualAssets = demoAssets.reduce((s, a) => s + a.value, 0);
    const cards = demoAccounts.filter(a => a.account_type === 'credit_card').reduce((s, a) => s + a.balance, 0);
    const studentLoan = demoAccounts.filter(a => a.account_type === 'student_loan').reduce((s, a) => s + a.balance, 0);
    const manualLiabilities = demoLiabilities.reduce((s, l) => s + l.balance, 0);

    expect(last.total_assets).toBe(accountAssets + manualAssets);
    expect(last.total_liabilities).toBe(cards + studentLoan + manualLiabilities);
    expect(last.net_worth).toBe(last.total_assets - last.total_liabilities);
  });

  it('is monotonic in date and never repeats one', () => {
    const dates = demoNetWorthSnapshots.map(s => s.snapshot_date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe('every debt panel on /debt has something in it, except the one that would be a lie', () => {
  // `DebtPayoff.tsx` sorts a debt into a panel by matching its name against an account of that
  // type, so these assertions are that pairing, not a count.
  const nameSetFor = (type: string) =>
    new Set(demoAccounts.filter(a => a.account_type === type).map(a => a.name.toLowerCase()));

  it('pairs the student loan with a student_loan account', () => {
    const students = nameSetFor('student_loan');
    expect(demoDebts.filter(d => students.has(d.name.toLowerCase())).length).toBe(1);
  });

  it('leaves at least one debt matching no account, which is what Other Debts shows', () => {
    const claimed = new Set([
      ...nameSetFor('credit_card'), ...nameSetFor('mortgage'), ...nameSetFor('student_loan'),
    ]);
    expect(demoDebts.filter(d => !claimed.has(d.name.toLowerCase())).length).toBeGreaterThan(0);
  });

  it('keeps mortgage empty on purpose — Jordan rents, and rule r2 is the rent', () => {
    expect(nameSetFor('mortgage').size).toBe(0);
    expect(demoRecurringRules.some(r => r.name === 'Rent')).toBe(true);
  });
});
