import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PUBLIC_MAINTENANCE_COLUMNS,
  PRIVATE_MAINTENANCE_COLUMNS,
  shouldPublishMaintenance,
  toPublicMaintenance,
} from '../public-maintenance';

const EDGE_FN = resolve(
  __dirname,
  '../../../supabase/functions/public-build/index.ts',
);
const MIGRATION = resolve(
  __dirname,
  '../../../supabase/migrations/20260812_car_builds_maintenance_public.sql',
);

function edgeSource(): string {
  return readFileSync(EDGE_FN, 'utf8');
}

/**
 * The Edge Function's maintenance SELECT, parsed out of its own source.
 * Returns null if the call is not found, so a rename fails loudly rather than
 * silently passing an empty comparison.
 */
function edgeMaintenanceColumns(): string[] | null {
  const src = edgeSource();
  const block = src.match(
    /from\("car_maintenance_logs"\)\s*\.select\(\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*(?:,\s*)?\)/s,
  );
  if (!block) return null;
  return block[1]
    .slice(1, -1)
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);
}

describe('public maintenance projection', () => {
  it('publishes only the allowlisted columns', () => {
    expect([...PUBLIC_MAINTENANCE_COLUMNS]).toEqual([
      'id',
      'service',
      'service_date',
      'odometer',
      'next_due_date',
      'next_due_odometer',
    ]);
  });

  it('withholds cost, vendor and notes — the money and the personal detail', () => {
    for (const col of ['cost', 'vendor', 'notes'] as const) {
      expect(PRIVATE_MAINTENANCE_COLUMNS).toContain(col);
      expect(PUBLIC_MAINTENANCE_COLUMNS as readonly string[]).not.toContain(col);
    }
  });

  it('narrows a full row and drops every private field', () => {
    const row = {
      id: 'log-1',
      build_id: 'build-1',
      user_id: 'user-1',
      service: 'Oil change',
      service_date: '2026-03-04',
      odometer: 92400,
      cost: 184.32,
      vendor: "Bob's Garage",
      notes: 'Paid cash, ask for Dave next time',
      interval_months: 6,
      interval_miles: 5000,
      next_due_date: '2026-09-04',
      next_due_odometer: 97400,
      created_at: '2026-03-04T00:00:00Z',
    };

    const pub = toPublicMaintenance(row);

    expect(pub).toEqual({
      id: 'log-1',
      service: 'Oil change',
      service_date: '2026-03-04',
      odometer: 92400,
      next_due_date: '2026-09-04',
      next_due_odometer: 97400,
    });
    // Serialised, so a leak through an unexpected key is caught too.
    const wire = JSON.stringify(pub);
    expect(wire).not.toContain('184');
    expect(wire).not.toContain('Bob');
    expect(wire).not.toContain('Dave');
    expect(wire).not.toContain('user-1');
  });

  it('keeps a missing odometer null rather than inventing a zero', () => {
    const pub = toPublicMaintenance({
      id: 'x',
      service: 'Tire rotation',
      service_date: '2026-01-01',
      odometer: null,
      next_due_date: null,
      next_due_odometer: null,
    });
    expect(pub.odometer).toBeNull();
    expect(pub.next_due_date).toBeNull();
    expect(pub.next_due_odometer).toBeNull();
  });
});

describe('the share gate', () => {
  it('publishes only when the owner turned it on', () => {
    expect(shouldPublishMaintenance({ maintenance_public: true })).toBe(true);
    expect(shouldPublishMaintenance({ maintenance_public: false })).toBe(false);
  });

  it('reads a missing or null flag as private', () => {
    expect(shouldPublishMaintenance({})).toBe(false);
    expect(shouldPublishMaintenance({ maintenance_public: null })).toBe(false);
  });
});

/**
 * The allowlist is one rule written twice — here and in the Edge Function that
 * actually runs the query with the service role. No compiler spans a Deno
 * function and the React app, so this test spans them instead: it reads the
 * function's own source. Without it, adding `cost` to that SELECT would publish
 * what someone paid, and every unit test in this file would still be green.
 */
describe('Edge Function parity', () => {
  it('selects exactly the allowlisted maintenance columns', () => {
    const cols = edgeMaintenanceColumns();
    expect(cols, 'maintenance select not found in public-build/index.ts').not.toBeNull();
    expect(cols).toEqual([...PUBLIC_MAINTENANCE_COLUMNS]);
  });

  it('never selects a private column from car_maintenance_logs', () => {
    const cols = edgeMaintenanceColumns() ?? [];
    for (const priv of PRIVATE_MAINTENANCE_COLUMNS) {
      expect(cols).not.toContain(priv);
    }
  });

  it('gates the query on the per-build flag, and skips the fetch when off', () => {
    const src = edgeSource();
    expect(src).toMatch(/maintenancePublic\s*=\s*build\.maintenance_public === true/);
    // The query sits inside the conditional, not behind a post-hoc filter: a
    // private log's rows must never be fetched at all.
    const gate = src.match(/=\s*maintenancePublic\s*\?/);
    expect(gate, 'maintenance fetch is not gated by a maintenancePublic ternary').not.toBeNull();
    const queryIdx = src.indexOf('from("car_maintenance_logs")');
    expect(queryIdx).toBeGreaterThan(gate!.index!);
  });

  it('scopes the maintenance query to the resolved build', () => {
    const src = edgeSource();
    const after = src.slice(src.indexOf('from("car_maintenance_logs")'));
    expect(after.slice(0, 400)).toMatch(/\.eq\("build_id", build\.id\)/);
  });

  it('never sends the share_token', () => {
    expect(edgeSource()).not.toMatch(/select\([^)]*share_token/);
  });
});

/**
 * The migration must NOT grant anon a policy on car_maintenance_logs.
 * 20260615_fix_public_rls.sql dropped exactly that shape from the build tables
 * because `share_token is not null` policies allow full enumeration by anyone
 * holding the anon key. Re-adding one here would reopen it.
 */
describe('migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('adds the per-build flag defaulting to private', () => {
    expect(sql).toMatch(/add column if not exists maintenance_public boolean not null default false/i);
  });

  it('creates no policy on car_maintenance_logs', () => {
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/grant\s+select\s+on\s+public\.car_maintenance_logs/i);
  });
});
