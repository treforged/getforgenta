import { Capacitor } from '@capacitor/core';
import type { ForecastRow } from './exportPdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { type ForecastMonthDetail, collectLabelUnion, amountForLabel } from './forecast-export';

function escapeCell(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface ExportRow {
  date: string;
  type: string;
  amount: number | string;
  category: string;
  note?: string | null;
  payment_source?: string | null;
}

export async function exportTransactionsCsv(rows: ExportRow[], filename = 'transactions.csv'): Promise<void> {
  const headers = ['Date', 'Type', 'Amount', 'Category', 'Note', 'Payment Source'];

  const body = rows.map(r => [
    r.date ?? '',
    r.type ?? '',
    r.amount != null ? String(r.amount) : '',
    r.category ?? '',
    r.note ?? '',
    r.payment_source ?? '',
  ].map(escapeCell).join(','));

  const csv = [headers.join(','), ...body].join('\r\n');

  if (Capacitor.isNativePlatform()) {
    const base64 = btoa(unescape(encodeURIComponent(csv)));
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: 'Export Transactions CSV',
    });
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportForecastCsv(rows: ForecastRow[], details: ForecastMonthDetail[] = [], filename = 'forgenta-forecast.csv'): Promise<void> {
  const summaryHeaders = ['Month', 'Take-Home', 'Expenses', 'Debt Payment', 'Liquid Cash', 'Ending Cash', 'Net Worth', 'Debt Balance', 'Savings Balance'];

  // Goals/cards/accounts vary per user and can appear or disappear mid-projection (paid off,
  // goal completed, new account linked) — collect the union of every label actually seen across
  // the exported months so every month gets the same columns, 0.00 where it doesn't apply.
  const incomeLabels = collectLabelUnion(details, d => d.income);
  const expenseLabels = collectLabelUnion(details, d => d.expenses);
  const transferLabels = collectLabelUnion(details, d => d.internalTransfers);
  const retirementLabels = collectLabelUnion(details, d => d.retirementAccounts);
  const investmentLabels = collectLabelUnion(details, d => d.investmentAccounts);
  const savingsLabels = collectLabelUnion(details, d => d.savingsAccounts);
  const ccLabels = collectLabelUnion(details, d => d.creditCards);
  const otherLiabLabels = collectLabelUnion(details, d => d.otherLiabilities);
  const carLoanLabels = collectLabelUnion(details, d => d.carLoans);

  const headers = [
    ...summaryHeaders,
    ...incomeLabels.map(l => `Income: ${l}`),
    ...expenseLabels.map(l => `Expense: ${l}`),
    ...transferLabels.map(l => `Internal Transfer: ${l}`),
    'Cash Floor',
    ...retirementLabels.map(l => `Retirement: ${l}`),
    ...investmentLabels.map(l => `Investment: ${l}`),
    ...savingsLabels.map(l => `Savings: ${l}`),
    'Total Assets',
    ...ccLabels.map(l => `Credit Card: ${l}`),
    ...otherLiabLabels.map(l => `Liability: ${l}`),
    ...carLoanLabels.map(l => `Car Loan: ${l}`),
    'Total Liabilities',
  ];

  const body = rows.map((r, i) => {
    const d = details[i];
    const summaryCells = [
      r.month,
      r.takeHome.toFixed(2),
      r.totalExpenses.toFixed(2),
      r.debtPayment.toFixed(2),
      r.liquidCash.toFixed(2),
      r.endingCash.toFixed(2),
      r.netWorth.toFixed(2),
      r.debtBalance.toFixed(2),
      r.savingsBalance.toFixed(2),
    ];
    if (!d) return summaryCells.map(escapeCell).join(',');
    const detailCells = [
      ...incomeLabels.map(l => amountForLabel(d.income, l).toFixed(2)),
      ...expenseLabels.map(l => amountForLabel(d.expenses, l).toFixed(2)),
      ...transferLabels.map(l => amountForLabel(d.internalTransfers, l).toFixed(2)),
      d.cashFloor.toFixed(2),
      ...retirementLabels.map(l => amountForLabel(d.retirementAccounts, l).toFixed(2)),
      ...investmentLabels.map(l => amountForLabel(d.investmentAccounts, l).toFixed(2)),
      ...savingsLabels.map(l => amountForLabel(d.savingsAccounts, l).toFixed(2)),
      d.totalAssets.toFixed(2),
      ...ccLabels.map(l => amountForLabel(d.creditCards, l).toFixed(2)),
      ...otherLiabLabels.map(l => amountForLabel(d.otherLiabilities, l).toFixed(2)),
      ...carLoanLabels.map(l => amountForLabel(d.carLoans, l).toFixed(2)),
      d.totalLiabilities.toFixed(2),
    ];
    return [...summaryCells, ...detailCells].map(escapeCell).join(',');
  });

  const csv = [headers.join(','), ...body].join('\r\n');

  if (Capacitor.isNativePlatform()) {
    const base64 = btoa(unescape(encodeURIComponent(csv)));
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: result.uri,
      dialogTitle: 'Export Forecast CSV',
    });
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
