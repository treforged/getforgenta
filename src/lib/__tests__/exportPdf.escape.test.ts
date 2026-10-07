// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: {} }));
vi.mock('@capacitor/share', () => ({ Share: {} }));

import { escapeHtml, exportTransactionsPdf, exportForecastPdf, exportDashboardPdf } from '../exportPdf';
import type { ForecastMonthDetail } from '../forecast-export';

// db1d6813: user-named strings (category, account and card labels, notes) went into
// win.document.write unescaped, so a label like this ran script in the export window.
const PAYLOAD = '<img src=x onerror="alert(1)">';

let written = '';

beforeEach(() => {
  written = '';
  const fakeWin = {
    document: { write: (h: string) => { written += h; }, close: () => {} },
    addEventListener: () => {},
    focus: () => {},
    print: () => {},
  };
  vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window);
});

/** Parse what the export wrote, the way the browser window would. */
function render(): Document {
  return new DOMParser().parseFromString(written, 'text/html');
}

function expectInert(doc: Document) {
  // Positive control: the payload is present as visible TEXT, so the probe can see it.
  expect(doc.body.textContent).toContain(PAYLOAD);
  // And no element was created from it.
  expect(doc.querySelectorAll('img').length).toBe(0);
  expect(doc.querySelectorAll('[onerror]').length).toBe(0);
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
  it('renders null and undefined as empty text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('PDF exports render user strings as text (db1d6813)', () => {
  it('transactions: every field', async () => {
    await exportTransactionsPdf(
      [{ date: PAYLOAD, type: PAYLOAD, amount: 5, category: PAYLOAD, note: PAYLOAD, payment_source: PAYLOAD }],
      PAYLOAD,
    );
    const doc = render();
    expectInert(doc);
    // Five string fields (amount is a number) plus the period header carry it.
    expect(doc.body.textContent!.split(PAYLOAD).length - 1).toBe(6);
  });

  it('forecast: flow labels, group rows, account labels and month names', async () => {
    const line = { label: PAYLOAD, amount: 100 };
    const detail = {
      month: PAYLOAD, startingCash: 0, endingCash: 0, cashFloor: 0, netWorth: 0,
      totalAssets: 0, totalLiabilities: 0,
      income: [line], expenses: [line], internalTransfers: [line],
      retirementAccounts: [line], investmentAccounts: [], savingsAccounts: [], cashAccounts: [],
      creditCards: [line], otherLiabilities: [], carLoans: [],
    } as unknown as ForecastMonthDetail;
    const row = {
      month: PAYLOAD, takeHome: 0, totalExpenses: 0, debtPayment: 0, liquidCash: 0,
      endingCash: 0, netWorth: 0, debtBalance: 0, savingsBalance: 0,
    };
    await exportForecastPdf([row], PAYLOAD, [detail]);
    expectInert(render());
  });

  it('dashboard: month name', async () => {
    await exportDashboardPdf({
      month: PAYLOAD, liquidCash: 0, netWorth: 0, income: 0, expenses: 0,
      totalDebtPayments: 0, savingsRate: 0, totalSaved: 0, ccDebt: 0,
    });
    expectInert(render());
  });
});
