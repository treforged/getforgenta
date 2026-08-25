// @vitest-environment jsdom
/**
 * Partner view against the data layer (docs/partner-linking-design.md §2, Phase 1).
 *
 * The two halves of the lens contract, asserted at the query-builder boundary:
 *
 *  1. READS key and filter on `viewedUserId` — so pointing the lens at the partner
 *     re-runs every read over the partner's id with cache isolation for free — and
 *     fall back to `user.id` when no lens value exists (fails CLOSED: a missing
 *     provider shows you your own data, never someone else's).
 *  2. MUTATIONS stay pinned to `user.id` and REFUSE outright in partner view, the
 *     same way the demo-mode guard refuses — nothing may write while the app is
 *     rendering somebody else's money.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let VIEWED_USER_ID: string | undefined = 'owner-1';
let IS_PARTNER_VIEW = false;

// ── Chain-capturing supabase stub ────────────────────────────────────────────
type Call = { m: string; args: unknown[] };
type Captured = { table: string; calls: Call[] };
let captured: Captured[] = [];

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'delete', 'upsert',
  'eq', 'or', 'is', 'not', 'order', 'gte', 'lte', 'range', 'limit',
  'maybeSingle', 'single',
] as const;

function makeBuilder(table: string) {
  const rec: Captured = { table, calls: [] };
  captured.push(rec);
  const b: Record<string, unknown> = {};
  for (const m of CHAIN_METHODS) {
    b[m] = (...args: unknown[]) => {
      rec.calls.push({ m, args });
      return b;
    };
  }
  (b as { then?: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected: (e: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
  return b;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' }, loading: false }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/ViewedProfileContext', () => ({
  useViewedProfile: () => ({
    viewedUserId: VIEWED_USER_ID,
    isPartnerView: IS_PARTNER_VIEW,
    switchTo: vi.fn(),
    switchBack: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCrowdCategories', () => ({ useRecordCrowdVote: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  useAccounts, useTransactions, useNetWorthSnapshots, useSyncedTransactionReviews,
} from '../useSupabaseData';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Every `.eq('user_id', …)` value recorded against a table, across select chains. */
const userIdFilters = (table: string, chain: 'select' | 'insert' | 'update' | 'delete') =>
  captured
    .filter(c => c.table === table && c.calls.some(k => k.m === chain))
    .flatMap(c => c.calls.filter(k => k.m === 'eq' && k.args[0] === 'user_id').map(k => k.args[1]));

const writesTo = (table: string) =>
  captured.filter(c =>
    c.table === table && c.calls.some(k => ['insert', 'update', 'delete', 'upsert'].includes(k.m)));

beforeEach(() => {
  captured = [];
  VIEWED_USER_ID = 'owner-1';
  IS_PARTNER_VIEW = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('reads follow the lens', () => {
  it('default lens: reads key and filter on the OWN user id', async () => {
    renderHook(() => useAccounts(), { wrapper });
    await waitFor(() => expect(userIdFilters('accounts', 'select')).toContain('owner-1'));
    expect(client.getQueryCache().find({ queryKey: ['accounts', 'owner-1'] })).toBeTruthy();
  });

  it('partner lens: reads key and filter on the PARTNER id', async () => {
    VIEWED_USER_ID = 'partner-2';
    IS_PARTNER_VIEW = true;
    renderHook(() => useTransactions(), { wrapper });
    await waitFor(() => expect(userIdFilters('transactions', 'select')).toContain('partner-2'));
    expect(userIdFilters('transactions', 'select')).not.toContain('owner-1');
    expect(client.getQueryCache().find({ queryKey: ['transactions', 'partner-2'] })).toBeTruthy();
  });

  it('FAILS CLOSED: no lens value at all falls back to the own user id', async () => {
    VIEWED_USER_ID = undefined; // no provider mounted — the default context
    renderHook(() => useAccounts(), { wrapper });
    await waitFor(() => expect(userIdFilters('accounts', 'select')).toContain('owner-1'));
  });
});

describe('mutations refuse in partner view', () => {
  beforeEach(() => {
    VIEWED_USER_ID = 'partner-2';
    IS_PARTNER_VIEW = true;
  });

  it('add / update / remove on accounts all throw and never reach the database', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper });
    await expect(
      result.current.add.mutateAsync({ name: 'x', account_type: 'checking', balance: 0, active: true }),
    ).rejects.toThrow(/read only/i);
    await expect(
      result.current.update.mutateAsync({ id: 'a1', balance: 5 }),
    ).rejects.toThrow(/read only/i);
    await expect(result.current.remove.mutateAsync('a1')).rejects.toThrow(/read only/i);
    expect(writesTo('accounts')).toHaveLength(0);
  });

  it('transactions add throws and never reaches the database', async () => {
    const { result } = renderHook(() => useTransactions(), { wrapper });
    await expect(
      result.current.add.mutateAsync({ date: '2026-08-25', type: 'expense', amount: 1, category: 'Misc' }),
    ).rejects.toThrow(/read only/i);
    expect(writesTo('transactions')).toHaveLength(0);
  });

  it('review decisions throw and never reach the database', async () => {
    const { result } = renderHook(() => useSyncedTransactionReviews(), { wrapper });
    await expect(
      result.current.save.mutateAsync({
        synced_transaction_id: 's1', status: 'ignored',
        rule_id: null, transaction_id: null, payment_plan_id: null, car_fund_id: null,
        car_charge_kind: null, occurrence_month: null, occurrence_date: null, category_override: null,
      }),
    ).rejects.toThrow(/read only/i);
    expect(writesTo('synced_transaction_reviews')).toHaveLength(0);
  });

  it('net-worth snapshot upsert SILENTLY SKIPS — partner totals must never be recorded as the owner\'s history', async () => {
    const { result } = renderHook(() => useNetWorthSnapshots(), { wrapper });
    // Mirrors the demo-mode behaviour: resolve without writing (the recorder is fire-and-forget).
    await result.current.upsert.mutateAsync({
      snapshot_date: '2026-08-25', total_assets: 1, total_liabilities: 1, net_worth: 0,
    });
    expect(writesTo('net_worth_snapshots')).toHaveLength(0);
  });
});
