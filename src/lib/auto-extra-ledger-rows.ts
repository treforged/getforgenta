import { autoExtraFlowLabel } from './forecast-export';

/** One month's ranked automatic extra, as a row the ledger can render. */
export interface AutoExtraLedgerRow {
  id: string;
  date: string;
  amount: number;
  label: string;
  targetId: string;
  kind: 'car_fund' | 'goal' | 'loan' | 'liability';
  monthIndex: number;
}

/** The engine's own per-month named list — the only thing this function reads. */
interface AutoExtraSourceRow {
  autoExtraItems?: { id: string; name: string; kind: AutoExtraLedgerRow['kind']; amount: number }[];
}

/**
 * The ranked automatic extra, turned into ledger rows.
 *
 * These are the SAME dollars the engine already reserved, read straight off its own named list
 * (`ForecastMonthRow.autoExtraItems`), so the ledger cannot disagree with the Forecast month drawer
 * or the CSV export — both of which read that same field. There is no second allocation here and no
 * second total, which is the whole reason this reads the named list instead of re-deriving it.
 *
 * ⚠️ THERE IS DELIBERATELY NO `card` KIND. `AutoExtraReserveKind` is `car_fund | goal | loan |
 * liability`, so a credit card's ranked surplus is NOT in this list: it reaches the ledger through
 * the month-0 debt payment rows, which are built from `perCardAdjusted` and already include it.
 * Emitting it here as well would show the same money leaving twice. If a `card` kind is ever added
 * to the engine, this function must exclude it explicitly or the ledger starts double-counting.
 *
 * The date is the LAST DAY of its month on purpose. A ranked extra is what is left over after that
 * month's other obligations are met — it is not a payment on a day anybody chose — so pinning it to
 * a specific earlier day would print a date the user never set and imply a schedule that does not
 * exist. Built from local date parts, never `toISOString`, which shifts the day across a timezone
 * boundary; index 0 is the current month, which is what the engine's rows mean.
 */
export function buildAutoExtraLedgerRows(
  rows: ReadonlyArray<AutoExtraSourceRow>,
  today: Date,
  monthsAhead: number,
): AutoExtraLedgerRow[] {
  const result: AutoExtraLedgerRow[] = [];
  const maxIndex = Math.min(monthsAhead, rows.length);

  for (let i = 0; i < maxIndex; i++) {
    // Day 0 of the NEXT month is the last day of this one, and it clamps February correctly.
    const d = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    for (const item of rows[i].autoExtraItems ?? []) {
      // A zero or non-finite reserve renders nothing rather than a figure nobody can source.
      if (!Number.isFinite(item.amount) || item.amount <= 0) continue;
      result.push({
        id: `autoextra:${item.id}:${date}`,
        date,
        amount: item.amount,
        label: autoExtraFlowLabel(item),
        targetId: item.id,
        kind: item.kind,
        monthIndex: i,
      });
    }
  }

  return result;
}
