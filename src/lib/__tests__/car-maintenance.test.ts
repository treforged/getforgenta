import { describe, it, expect } from 'vitest';
import {
  addMonthsToDate,
  daysBetween,
  computeNextDue,
  currentOdometer,
  maintenanceStatus,
  sortByServiceDateDesc,
  upcomingMaintenance,
  totalMaintenanceCost,
  costLast12Months,
  DUE_SOON_DAYS,
  DUE_SOON_MILES,
} from '@/lib/car-maintenance';
import type { CarMaintenanceLog } from '@/lib/types';

function log(over: Partial<CarMaintenanceLog> = {}): CarMaintenanceLog {
  return {
    id: 'l1',
    build_id: 'b1',
    user_id: 'u1',
    service: 'Oil Change',
    service_date: '2026-01-10',
    odometer: 90000,
    cost: 80,
    vendor: null,
    notes: null,
    interval_months: 6,
    interval_miles: 5000,
    next_due_date: '2026-07-10',
    next_due_odometer: 95000,
    created_at: '2026-01-10T00:00:00Z',
    ...over,
  };
}

const TODAY = '2026-08-10';

describe('addMonthsToDate', () => {
  it('adds whole months', () => {
    expect(addMonthsToDate('2026-01-10', 6)).toBe('2026-07-10');
  });

  it('rolls the year over', () => {
    expect(addMonthsToDate('2026-11-05', 3)).toBe('2027-02-05');
  });

  it('clamps to the end of a shorter month rather than spilling into the next', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonthsToDate('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('subtracts months for a negative interval', () => {
    expect(addMonthsToDate('2026-08-10', -12)).toBe('2025-08-10');
    expect(addMonthsToDate('2026-02-10', -3)).toBe('2025-11-10');
  });

  it('does not shift a day in a negative-UTC-offset timezone (string maths, not Date parsing)', () => {
    // The bug this guards: new Date('2026-01-01') is UTC midnight, which is
    // 2025-12-31 local in every US timezone.
    expect(addMonthsToDate('2026-01-01', 0)).toBe('2026-01-01');
    expect(addMonthsToDate('2026-01-01', 1)).toBe('2026-02-01');
  });
});

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween('2026-08-10', '2026-08-20')).toBe(10);
    expect(daysBetween('2026-08-10', '2026-07-31')).toBe(-10);
    expect(daysBetween('2026-08-10', '2026-08-10')).toBe(0);
  });

  it('crosses a DST boundary without drifting', () => {
    // US DST ends 2026-11-01; a naive local-time diff yields 30.04 days here.
    expect(daysBetween('2026-10-25', '2026-11-24')).toBe(30);
  });
});

describe('computeNextDue', () => {
  it('projects both a date and an odometer', () => {
    expect(computeNextDue({
      serviceDate: '2026-01-10', odometer: 90000, intervalMonths: 6, intervalMiles: 5000,
    })).toEqual({ nextDueDate: '2026-07-10', nextDueOdometer: 95000 });
  });

  it('gives no mileage due when the odometer is unknown — an invented number is worse than none', () => {
    expect(computeNextDue({
      serviceDate: '2026-01-10', odometer: null, intervalMonths: 6, intervalMiles: 5000,
    })).toEqual({ nextDueDate: '2026-07-10', nextDueOdometer: null });
  });

  it('gives nothing at all when no interval is set', () => {
    expect(computeNextDue({
      serviceDate: '2026-01-10', odometer: 90000, intervalMonths: null, intervalMiles: null,
    })).toEqual({ nextDueDate: null, nextDueOdometer: null });
  });

  it('treats a zero interval as no interval', () => {
    expect(computeNextDue({
      serviceDate: '2026-01-10', odometer: 90000, intervalMonths: 0, intervalMiles: 0,
    })).toEqual({ nextDueDate: null, nextDueOdometer: null });
  });
});

describe('currentOdometer', () => {
  it('takes the highest reading, not the newest entry', () => {
    expect(currentOdometer([
      log({ id: 'a', service_date: '2026-06-01', odometer: 91000 }),
      log({ id: 'b', service_date: '2026-07-01', odometer: 90500 }),
    ])).toBe(91000);
  });

  it('is null when nothing has an odometer, rather than zero', () => {
    expect(currentOdometer([log({ odometer: null })])).toBeNull();
    expect(currentOdometer([])).toBeNull();
  });
});

describe('maintenanceStatus', () => {
  const ctx = { today: TODAY, odometerNow: 91000 };

  it('is overdue once the due date has passed', () => {
    expect(maintenanceStatus(
      { next_due_date: '2026-08-09', next_due_odometer: null }, ctx,
    )).toBe('overdue');
  });

  it('is due-soon inside the window and scheduled outside it', () => {
    const edge = addMonthsToDate(TODAY, 0);
    expect(daysBetween(edge, '2026-09-09')).toBe(DUE_SOON_DAYS);
    expect(maintenanceStatus({ next_due_date: '2026-09-09', next_due_odometer: null }, ctx)).toBe('due-soon');
    expect(maintenanceStatus({ next_due_date: '2026-09-10', next_due_odometer: null }, ctx)).toBe('scheduled');
  });

  it('is overdue on mileage even when the date is far off', () => {
    expect(maintenanceStatus(
      { next_due_date: '2027-01-01', next_due_odometer: 90500 }, ctx,
    )).toBe('overdue');
  });

  it('uses the mileage window', () => {
    expect(maintenanceStatus(
      { next_due_date: null, next_due_odometer: 91000 + DUE_SOON_MILES }, ctx,
    )).toBe('due-soon');
    expect(maintenanceStatus(
      { next_due_date: null, next_due_odometer: 91000 + DUE_SOON_MILES + 1 }, ctx,
    )).toBe('scheduled');
  });

  it('ignores mileage when the current odometer is unknown, and never downgrades the date', () => {
    expect(maintenanceStatus(
      { next_due_date: '2026-08-09', next_due_odometer: 200000 },
      { today: TODAY, odometerNow: null },
    )).toBe('overdue');
  });

  it('is none when nothing is scheduled', () => {
    expect(maintenanceStatus({ next_due_date: null, next_due_odometer: null }, ctx)).toBe('none');
  });
});

describe('sortByServiceDateDesc', () => {
  it('puts the newest first and does not mutate its input', () => {
    const input = [
      log({ id: 'old', service_date: '2026-01-01' }),
      log({ id: 'new', service_date: '2026-07-01' }),
    ];
    const sorted = sortByServiceDateDesc(input);
    expect(sorted.map(l => l.id)).toEqual(['new', 'old']);
    expect(input.map(l => l.id)).toEqual(['old', 'new']);
  });

  it('breaks same-day ties by created_at, newest first', () => {
    const sorted = sortByServiceDateDesc([
      log({ id: 'first', service_date: '2026-05-01', created_at: '2026-05-01T09:00:00Z' }),
      log({ id: 'second', service_date: '2026-05-01', created_at: '2026-05-01T17:00:00Z' }),
    ]);
    expect(sorted.map(l => l.id)).toEqual(['second', 'first']);
  });
});

describe('upcomingMaintenance', () => {
  const ctx = { today: TODAY, odometerNow: 91000 };

  it('only considers the latest entry per service — a replaced oil change is history, not a job', () => {
    const result = upcomingMaintenance([
      log({ id: 'old-oil', service: 'Oil Change', service_date: '2025-01-10', next_due_date: '2025-07-10', next_due_odometer: null }),
      log({ id: 'new-oil', service: 'Oil Change', service_date: '2026-07-10', next_due_date: '2027-01-10', next_due_odometer: null }),
    ], ctx);
    expect(result.map(e => e.log.id)).toEqual(['new-oil']);
    expect(result[0].status).toBe('scheduled');
  });

  it('matches service names case- and whitespace-insensitively', () => {
    const result = upcomingMaintenance([
      log({ id: 'a', service: 'Oil Change', service_date: '2025-01-10', next_due_date: '2025-07-10', next_due_odometer: null }),
      log({ id: 'b', service: '  oil change ', service_date: '2026-07-10', next_due_date: '2027-01-10', next_due_odometer: null }),
    ], ctx);
    expect(result.map(e => e.log.id)).toEqual(['b']);
  });

  it('drops entries with nothing due and sorts overdue before due-soon before scheduled', () => {
    const result = upcomingMaintenance([
      log({ id: 'nothing', service: 'Detail', next_due_date: null, next_due_odometer: null }),
      log({ id: 'later', service: 'Coolant', next_due_date: '2027-01-01', next_due_odometer: null }),
      log({ id: 'soon', service: 'Filter', next_due_date: '2026-08-20', next_due_odometer: null }),
      log({ id: 'late', service: 'Oil Change', next_due_date: '2026-06-01', next_due_odometer: null }),
    ], ctx);
    expect(result.map(e => e.log.id)).toEqual(['late', 'soon', 'later']);
    expect(result.map(e => e.status)).toEqual(['overdue', 'due-soon', 'scheduled']);
  });

  it('orders same-status entries by due date', () => {
    const result = upcomingMaintenance([
      log({ id: 'b', service: 'Brakes', next_due_date: '2026-05-01', next_due_odometer: null }),
      log({ id: 'a', service: 'Oil Change', next_due_date: '2026-03-01', next_due_odometer: null }),
    ], ctx);
    expect(result.map(e => e.log.id)).toEqual(['a', 'b']);
  });
});

describe('cost roll-ups', () => {
  it('totals cost and treats a missing cost as nothing, not as a guess', () => {
    expect(totalMaintenanceCost([
      log({ id: 'a', cost: 80 }),
      log({ id: 'b', cost: null }),
      log({ id: 'c', cost: 45.5 }),
    ])).toBe(125.5);
  });

  it('counts only the trailing 12 months', () => {
    const logs = [
      log({ id: 'in', service_date: '2026-03-01', cost: 100 }),
      log({ id: 'today', service_date: TODAY, cost: 10 }),
      log({ id: 'edge-out', service_date: '2025-08-10', cost: 999 }),
      log({ id: 'edge-in', service_date: '2025-08-11', cost: 1 }),
      log({ id: 'future', service_date: '2026-12-01', cost: 500 }),
    ];
    expect(costLast12Months(logs, TODAY)).toBe(111);
  });
});
