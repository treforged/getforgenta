/**
 * simDebug — dev-only utility for exporting useCardProjection output as a
 * human-readable table that can be copy-pasted into a support conversation.
 *
 * Usage (browser DevTools console while Debt Payoff tab is open):
 *   copy(__simDebug.table())        // copies Markdown table to clipboard
 *   copy(__simDebug.csv())          // copies CSV to clipboard
 *   console.table(__simDebug.rows())  // renders an interactive table in DevTools
 */

type SimResult = {
  simCards: { id: string; name: string; apr: number }[];
  monthlyRevolvingBalances: Map<string, number[]>;
  monthlyBalances: Map<string, number[]>;
  monthlyInterest: Map<string, number[]>;
  monthlyCyclingBacklog: Map<string, number[]>;
  perCardPaymentsScaled: { id: string; payments: number[] }[];
  allPaymentTotals: number[];
  debtPaymentTotals: number[];
};

function monthLabel(offsetFromNow: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetFromNow);
  return d.toLocaleString('en', { month: 'short', year: 'numeric' });
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export function buildDebugRows(sim: SimResult, months = 36) {
  const rows: Record<string, string | number>[] = [];
  for (let m = 0; m < months; m++) {
    const row: Record<string, string | number> = { Month: monthLabel(m) };
    let totalBal = 0;
    for (const card of sim.simCards) {
      const bal = sim.monthlyRevolvingBalances.get(card.id)?.[m] ?? 0;
      const pay = sim.perCardPaymentsScaled.find(p => p.id === card.id)?.payments[m] ?? 0;
      const int = sim.monthlyInterest.get(card.id)?.[m] ?? 0;
      const backlog = sim.monthlyCyclingBacklog.get(card.id)?.[m] ?? 0;
      const label = card.name.replace(/\s+/g, '_');
      row[`${label}_bal`] = fmt(bal);
      row[`${label}_pay`] = fmt(pay);
      if (int > 0) row[`${label}_int`] = fmt(int);
      if (backlog > 0) row[`${label}_backlog`] = fmt(backlog);
      totalBal += bal;
    }
    row['total_liabilities'] = fmt(totalBal);
    row['total_payment'] = fmt(sim.allPaymentTotals[m] ?? 0);
    rows.push(row);
  }
  return rows;
}

export function buildDebugTable(sim: SimResult, months = 36): string {
  const rows = buildDebugRows(sim, months);
  if (rows.length === 0) return '(no data)';
  const cols = Object.keys(rows[0]);
  const header = '| ' + cols.join(' | ') + ' |';
  const divider = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = rows.map(r => '| ' + cols.map(c => r[c] ?? '').join(' | ') + ' |').join('\n');
  return [header, divider, body].join('\n');
}

export function buildDebugCsv(sim: SimResult, months = 36): string {
  const rows = buildDebugRows(sim, months);
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(','), ...rows.map(r => cols.map(c => r[c] ?? '').join(','))];
  return lines.join('\n');
}

/** Attach formatted helpers to window.__simDebug (DEV only). */
export function attachSimDebug(sim: SimResult | null) {
  if (!sim) return;
  (window as unknown as Record<string, unknown>).__simDebug = {
    rows: (months = 36) => buildDebugRows(sim, months),
    table: (months = 36) => buildDebugTable(sim, months),
    csv: (months = 36) => buildDebugCsv(sim, months),
    raw: sim,
  };
}
