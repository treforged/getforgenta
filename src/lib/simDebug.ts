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
  monthlyCyclingOwed: Map<string, number[]>;
  monthlyCyclingInterest: Map<string, number[]>;
  monthlyCyclingBacklog: Map<string, number[]>;
  monthlyMandatoryCyclingPayment: Map<string, number[]>;
  perCardPaymentsScaled: { id: string; payments: number[] }[];
  allPaymentTotals: number[];
  debtPaymentTotals: number[];
  saveUpMonths: Set<number>;
  maxDebtPaymentByMonth: number[];
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

function fmtCap(cap: number | undefined): string {
  if (cap === undefined || !isFinite(cap)) return '';
  return fmt(cap);
}

export function buildDebugRows(sim: SimResult, months = 36) {
  // Determine which cards are cycling (have monthlyCyclingOwed data)
  const cyclingIds = new Set(
    sim.simCards
      .filter(c => (sim.monthlyCyclingOwed.get(c.id) ?? []).some(v => v > 0))
      .map(c => c.id),
  );

  const rows: Record<string, string | number>[] = [];
  for (let m = 0; m < months; m++) {
    const cap = sim.maxDebtPaymentByMonth[m];
    const row: Record<string, string | number> = {
      Month: monthLabel(m),
      saveUp: sim.saveUpMonths.has(m) ? 'Y' : '',
      debtCap: fmtCap(cap),
    };
    let totalBal = 0;
    for (const card of sim.simCards) {
      const isCycling = cyclingIds.has(card.id);
      const label = card.name.replace(/\s+/g, '_');

      if (isCycling) {
        // monthlyCyclingOwed = mandatory statement + existing backlog, before payment
        const owed = sim.monthlyCyclingOwed.get(card.id)?.[m] ?? 0;
        const mandatory = sim.monthlyMandatoryCyclingPayment.get(card.id)?.[m] ?? 0;
        const pay = sim.perCardPaymentsScaled.find(p => p.id === card.id)?.payments[m] ?? 0;
        const int = sim.monthlyCyclingInterest.get(card.id)?.[m] ?? 0;
        const backlog = sim.monthlyCyclingBacklog.get(card.id)?.[m] ?? 0;
        row[`${label}_owed`] = fmt(owed);
        row[`${label}_pay`] = fmt(pay);
        row[`${label}_mandatory`] = fmt(mandatory);
        if (int > 0) row[`${label}_int`] = fmt(int);
        if (backlog > 0) row[`${label}_backlog`] = fmt(backlog);
        totalBal += owed;
      } else {
        const bal = sim.monthlyRevolvingBalances.get(card.id)?.[m] ?? 0;
        const pay = sim.perCardPaymentsScaled.find(p => p.id === card.id)?.payments[m] ?? 0;
        const int = sim.monthlyInterest.get(card.id)?.[m] ?? 0;
        row[`${label}_bal`] = fmt(bal);
        row[`${label}_pay`] = fmt(pay);
        if (int > 0) row[`${label}_int`] = fmt(int);
        totalBal += bal;
      }
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
