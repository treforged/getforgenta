/**
 * IS AN APPLIED ACTION STILL OFFERED AS AN UNDO? - the app's own rule, read from the app's own source.
 *
 * The app offers an undo only for `UNDO_OFFER_WINDOW_HOURS` after the action (src/lib/applied-actions.ts).
 * The walks used to count every row with `undone_at is null` as "live". On 2026-09-23 the walk account's
 * last action was 8 days old, so walk-deck-undo and walk-batch-undo both exited 1 - "the panel promises
 * a reversal it does not offer" - over an app that was correctly declining to offer an 8-day-old undo.
 * A spent fixture read as a product defect.
 *
 * The number is READ from the source rather than typed here, so the walks and the app cannot drift.
 * If it cannot be read, the caller gets `null` and must refuse (exit 2): guessing a window would put
 * back exactly the defect this module removes.
 */
import { readFileSync } from 'node:fs';

export function undoOfferWindowHours(path = 'src/lib/applied-actions.ts') {
  const src = readFileSync(path, 'utf8');
  const m = src.match(/export const UNDO_OFFER_WINDOW_HOURS\s*=\s*(\d+(?:\.\d+)?)\s*;/);
  return m ? Number(m[1]) : null;
}

/** Mirrors `offerableUndos`: not undone, and inside the window. An unparseable date is still offered. */
export function isOffered(row, hours, now = Date.now()) {
  if (row.undone_at !== null) return false;
  const at = Date.parse(row.created_at);
  return Number.isNaN(at) || at >= now - hours * 3600_000;
}
