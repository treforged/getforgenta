import { Capacitor } from '@capacitor/core';
import type { ForecastRow } from './exportPdf';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

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
  note: string;
  payment_source?: string;
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

export async function exportForecastCsv(rows: ForecastRow[], filename = 'forgenta-forecast.csv'): Promise<void> {
  const headers = ['Month', 'Take-Home', 'Expenses', 'Debt Payment', 'Liquid Cash', 'Ending Cash', 'Net Worth', 'Debt Balance', 'Savings Balance'];

  const body = rows.map(r => [
    r.month,
    r.takeHome.toFixed(2),
    r.totalExpenses.toFixed(2),
    r.debtPayment.toFixed(2),
    r.liquidCash.toFixed(2),
    r.endingCash.toFixed(2),
    r.netWorth.toFixed(2),
    r.debtBalance.toFixed(2),
    r.savingsBalance.toFixed(2),
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
