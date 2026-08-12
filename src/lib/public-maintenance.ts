/**
 * What a shared build publishes from its maintenance log — and what it never does.
 *
 * The switch is per build (`car_builds.maintenance_public`), not per entry. One
 * switch travels with the share link, which is what Tre asked for, and it is the
 * one a person can reason about: a per-entry switch fails silently the first time
 * someone forgets to mark a row private.
 *
 * The projection below is a COLUMN ALLOWLIST. A maintenance entry carries `cost`,
 * `vendor` and free-text `notes`; publishing those is a different feature from
 * showing that the oil was changed. "Serviced at 92,400 miles" is a build log.
 * "$184 at Bob's Garage" is what someone paid, plus the name of their local shop,
 * and it is not going out over a link that gets forwarded.
 *
 * The Edge Function runs the real query with the service role, so this module and
 * `supabase/functions/public-build/index.ts` state the same rule twice. A parity
 * test reads the function's own source and fails if the two ever disagree — the
 * drift is otherwise invisible until a cost shows up on a stranger's screen.
 */

/** Columns a public share page may see. Anything absent here stays private. */
export const PUBLIC_MAINTENANCE_COLUMNS = [
  'id',
  'service',
  'service_date',
  'odometer',
  'next_due_date',
  'next_due_odometer',
] as const;

/** Columns that are deliberately withheld even when the log is public. */
export const PRIVATE_MAINTENANCE_COLUMNS = [
  'cost',
  'vendor',
  'notes',
  'user_id',
  'build_id',
  'interval_months',
  'interval_miles',
  'created_at',
] as const;

export type PublicMaintenanceEntry = {
  id: string;
  service: string;
  service_date: string;
  odometer: number | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
};

/**
 * Narrow a full maintenance row to the publishable shape.
 *
 * Used on the client for demo mode and for tests; the live public page is served
 * the already-narrowed rows by the Edge Function, so a cost never crosses the
 * network at all rather than being hidden in the browser.
 */
export function toPublicMaintenance(
  row: Record<string, unknown>,
): PublicMaintenanceEntry {
  return {
    id: String(row.id),
    service: String(row.service),
    service_date: String(row.service_date),
    odometer: row.odometer === null || row.odometer === undefined ? null : Number(row.odometer),
    next_due_date: row.next_due_date == null ? null : String(row.next_due_date),
    next_due_odometer:
      row.next_due_odometer === null || row.next_due_odometer === undefined
        ? null
        : Number(row.next_due_odometer),
  };
}

/**
 * The share gate: rows are published only when the owner turned the log public.
 *
 * Reaching a build at all already required a valid share token — the Edge
 * Function 404s otherwise — so this is the second half of the gate, not the
 * whole of it. A null/undefined flag reads as private, which is the safe
 * direction for a row written before the column existed.
 */
export function shouldPublishMaintenance(build: {
  maintenance_public?: boolean | null;
}): boolean {
  return build.maintenance_public === true;
}
