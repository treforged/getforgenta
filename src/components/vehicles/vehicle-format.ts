/**
 * The two date helpers the vehicle-money cards share.
 *
 * Lifted VERBATIM out of `Vehicles.tsx` on 2026-08-27, when the saving and loan panels moved to
 * /debt's Auto Loans tab (Tre: "move saving for down payment and active loans to the auto loans
 * section inside the debt payoff tab"). Identical behaviour — `fmtDate` still returns `Aug 2026`
 * and still returns null for a missing date, which is what the cards render against.
 */

export function addMonthsStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
