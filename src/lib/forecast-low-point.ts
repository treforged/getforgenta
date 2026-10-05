// The Forecast's Simple view (ask 5b166e10): the lowest cash the projection reaches, and when.
// Drafted by the free tier (ollama qwen3:14b), reviewed and gated by Ada.
export interface LowPoint { month: string; endingCash: number }

/** The row with the lowest ending cash (earliest wins a tie); null when no row has a finite figure. */
export function forecastLowPoint(rows: ReadonlyArray<{ month: string; endingCash: number }>): LowPoint | null {
  const validRows = rows.filter(row => typeof row.endingCash === 'number' && isFinite(row.endingCash));
  if (validRows.length === 0) return null;

  let minIndex = 0;
  let minCash = validRows[0].endingCash;

  for (let i = 1; i < validRows.length; i++) {
    if (validRows[i].endingCash < minCash) {
      minIndex = i;
      minCash = validRows[i].endingCash;
    }
  }

  return { month: validRows[minIndex].month, endingCash: minCash };
}
