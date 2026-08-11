// Pure helpers for the build maintenance log — next-due math, due status and
// cost roll-ups. Kept free of React and Supabase so the rules that decide
// "is this overdue" are testable on their own.
import type { CarMaintenanceLog } from '@/lib/types';

/** Days before a due date at which an entry starts reading as "due soon". */
export const DUE_SOON_DAYS = 30;
/** Miles before a due odometer at which an entry starts reading as "due soon". */
export const DUE_SOON_MILES = 500;

export type MaintenanceStatus = 'overdue' | 'due-soon' | 'scheduled' | 'none';

export type ServicePreset = {
  name: string;
  intervalMonths: number | null;
  intervalMiles: number | null;
};

/**
 * Common enthusiast intervals, used only to pre-fill the form. Every value stays
 * editable — a track car on 3k oil changes is as real as a garage queen on 10k.
 */
export const SERVICE_PRESETS: ServicePreset[] = [
  { name: 'Oil Change', intervalMonths: 6, intervalMiles: 5000 },
  { name: 'Tire Rotation', intervalMonths: 6, intervalMiles: 6000 },
  { name: 'Wheel Alignment', intervalMonths: 12, intervalMiles: 12000 },
  { name: 'Brake Pads', intervalMonths: null, intervalMiles: 30000 },
  { name: 'Brake Fluid', intervalMonths: 24, intervalMiles: null },
  { name: 'Engine Air Filter', intervalMonths: 12, intervalMiles: 15000 },
  { name: 'Cabin Air Filter', intervalMonths: 12, intervalMiles: 15000 },
  { name: 'Spark Plugs', intervalMonths: null, intervalMiles: 60000 },
  { name: 'Coolant Flush', intervalMonths: 60, intervalMiles: 50000 },
  { name: 'Transmission Fluid', intervalMonths: null, intervalMiles: 60000 },
  { name: 'Differential Fluid', intervalMonths: null, intervalMiles: 50000 },
  { name: 'Battery', intervalMonths: 48, intervalMiles: null },
  { name: 'Tires', intervalMonths: null, intervalMiles: 40000 },
  { name: 'Detail / Ceramic Coat', intervalMonths: 12, intervalMiles: null },
  { name: 'State Inspection', intervalMonths: 12, intervalMiles: null },
];

/**
 * Adds whole months to a `YYYY-MM-DD` date, clamping the day to the end of the
 * target month (31 Jan + 1 month is 28/29 Feb, not 2/3 March). Date-only maths is
 * done on the string parts on purpose: `new Date('2026-01-31')` is UTC midnight and
 * shifts a day in any negative-offset timezone, which is every US one.
 */
export function addMonthsToDate(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return dateISO;
  const totalMonths = (y * 12) + (m - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export type NextDueInput = {
  serviceDate: string;
  odometer: number | null;
  intervalMonths: number | null;
  intervalMiles: number | null;
};

export type NextDue = {
  nextDueDate: string | null;
  nextDueOdometer: number | null;
};

/**
 * Projects the next service from the one just logged. A mileage interval with no
 * odometer reading yields no mileage due — an invented number would be worse than
 * an empty field.
 */
export function computeNextDue(input: NextDueInput): NextDue {
  const { serviceDate, odometer, intervalMonths, intervalMiles } = input;
  return {
    nextDueDate: intervalMonths && intervalMonths > 0 && serviceDate
      ? addMonthsToDate(serviceDate, intervalMonths)
      : null,
    nextDueOdometer: intervalMiles && intervalMiles > 0 && odometer !== null
      ? odometer + intervalMiles
      : null,
  };
}

/**
 * The highest odometer reading recorded across a build's log — the app's best
 * estimate of where the car is now. Null when nothing has been recorded, which the
 * callers treat as "mileage is unknown" rather than zero.
 */
export function currentOdometer(logs: readonly CarMaintenanceLog[]): number | null {
  const readings = logs
    .map(l => l.odometer)
    .filter((o): o is number => typeof o === 'number');
  return readings.length > 0 ? Math.max(...readings) : null;
}

export type StatusContext = {
  today: string;
  odometerNow: number | null;
};

/**
 * Due status of one entry. Date and mileage are evaluated independently and the
 * more urgent of the two wins, because either one coming due means the service is
 * due. Unknown mileage simply does not contribute — it never downgrades a date.
 */
export function maintenanceStatus(
  log: Pick<CarMaintenanceLog, 'next_due_date' | 'next_due_odometer'>,
  ctx: StatusContext,
): MaintenanceStatus {
  const byDate: MaintenanceStatus = log.next_due_date
    ? (() => {
        const days = daysBetween(ctx.today, log.next_due_date);
        if (days < 0) return 'overdue';
        return days <= DUE_SOON_DAYS ? 'due-soon' : 'scheduled';
      })()
    : 'none';

  const byMiles: MaintenanceStatus = log.next_due_odometer !== null && ctx.odometerNow !== null
    ? (() => {
        const miles = log.next_due_odometer! - ctx.odometerNow!;
        if (miles < 0) return 'overdue';
        return miles <= DUE_SOON_MILES ? 'due-soon' : 'scheduled';
      })()
    : 'none';

  const rank: Record<MaintenanceStatus, number> = { overdue: 3, 'due-soon': 2, scheduled: 1, none: 0 };
  return rank[byDate] >= rank[byMiles] ? byDate : byMiles;
}

/** Newest service first; ties broken by created_at so same-day entries stay stable. */
export function sortByServiceDateDesc(logs: readonly CarMaintenanceLog[]): CarMaintenanceLog[] {
  return [...logs].sort((a, b) => {
    if (a.service_date !== b.service_date) return a.service_date < b.service_date ? 1 : -1;
    return (a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1;
  });
}

export type UpcomingEntry = {
  log: CarMaintenanceLog;
  status: MaintenanceStatus;
};

/**
 * Entries that still have something due, most urgent first. Only the LATEST entry
 * per service is considered: once the oil is changed again, last year's oil change
 * is history, not a pending job.
 */
export function upcomingMaintenance(
  logs: readonly CarMaintenanceLog[],
  ctx: StatusContext,
): UpcomingEntry[] {
  const latestByService = new Map<string, CarMaintenanceLog>();
  for (const log of sortByServiceDateDesc(logs)) {
    const key = log.service.trim().toLowerCase();
    if (!latestByService.has(key)) latestByService.set(key, log);
  }

  const rank: Record<MaintenanceStatus, number> = { overdue: 3, 'due-soon': 2, scheduled: 1, none: 0 };
  return [...latestByService.values()]
    .map(log => ({ log, status: maintenanceStatus(log, ctx) }))
    .filter(e => e.status !== 'none')
    .sort((a, b) => {
      if (a.status !== b.status) return rank[b.status] - rank[a.status];
      const aDate = a.log.next_due_date ?? '9999-12-31';
      const bDate = b.log.next_due_date ?? '9999-12-31';
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });
}

/** Total recorded maintenance spend. Entries with no cost contribute nothing. */
export function totalMaintenanceCost(logs: readonly CarMaintenanceLog[]): number {
  return logs.reduce((sum, l) => sum + (l.cost ?? 0), 0);
}

/** Spend within the trailing 12 months ending at `today`, for the "last 12 mo" stat. */
export function costLast12Months(logs: readonly CarMaintenanceLog[], today: string): number {
  const cutoff = addMonthsToDate(today, -12);
  return logs
    .filter(l => l.service_date > cutoff && l.service_date <= today)
    .reduce((sum, l) => sum + (l.cost ?? 0), 0);
}

/** Human label for a due status, or null when there is nothing scheduled. */
export function statusLabel(status: MaintenanceStatus): string | null {
  switch (status) {
    case 'overdue': return 'Overdue';
    case 'due-soon': return 'Due soon';
    case 'scheduled': return 'Scheduled';
    default: return null;
  }
}
