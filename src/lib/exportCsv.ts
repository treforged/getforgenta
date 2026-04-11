/**
 * CSV export utility for Budget OS transaction data.
 * Escapes values that contain commas, quotes, or newlines per RFC 4180.
 */

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

export function exportTransactionsCsv(rows: ExportRow[], filename = 'transactions.csv'): void {
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
