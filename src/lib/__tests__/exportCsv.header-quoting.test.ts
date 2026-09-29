import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: {} }));
vi.mock('@capacitor/share', () => ({ Share: {} }));

import { buildForecastCsv } from '../exportCsv';
import type { ForecastRow } from '../exportPdf';
import type { ForecastMonthDetail } from '../forecast-export';

/** RFC 4180 split of one line: commas inside double quotes do not separate cells. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const row: ForecastRow = {
  month: 'Mar 2027', takeHome: 5044.63, totalExpenses: 4605.95, debtPayment: 1040, liquidCash: -260,
  endingCash: -260, netWorth: -20330, debtBalance: 19502, savingsBalance: 537,
};

const detail: ForecastMonthDetail = {
  month: 'Mar 2027', startingCash: 3157, endingCash: -260, cashFloor: 150, netWorth: -20330,
  totalAssets: 1000, totalLiabilities: 2000,
  income: [{ label: 'Paycheck', amount: 3892.63 }],
  // The real goal name that split the header on Tre's account, 2026-09-29.
  expenses: [{ label: 'Goal: Move fund, then emergency fund', amount: 321.35 }, { label: 'One-Time Expense', amount: 3855.75 }],
  internalTransfers: [], retirementAccounts: [], investmentAccounts: [], savingsAccounts: [],
  cashAccounts: [], creditCards: [], otherLiabilities: [], carLoans: [],
} as unknown as ForecastMonthDetail;

describe('buildForecastCsv header quoting', () => {
  it('keeps a header name that contains a comma in ONE column, aligned with its value', () => {
    const [header, body] = buildForecastCsv([row], [detail]).split('\r\n');
    const h = splitCsvLine(header);
    const b = splitCsvLine(body);
    expect(h.length).toBe(b.length);
    const goal = h.indexOf('Expense: Goal: Move fund, then emergency fund');
    expect(goal).toBeGreaterThan(-1);
    expect(b[goal]).toBe('321.35');
    expect(b[h.indexOf('Cash Floor')]).toBe('150.00');
    expect(b[h.indexOf('Expense: One-Time Expense')]).toBe('3855.75');
  });

  it('positive control: a plain header stays unquoted', () => {
    const [header] = buildForecastCsv([row], [detail]).split('\r\n');
    expect(header.startsWith('Month,Take-Home,')).toBe(true);
  });
});
