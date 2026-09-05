// @vitest-environment jsdom
//
// A REVOKED CONNECTION IS NOT A CONNECTION — the duplicate-bank bug, pressed.
//
// Live on 2026-09-05: Tre re-linked Robinhood from his phone and then saw THREE Robinhood
// rows in Linked Banks, one of them telling him to re-link a bank he had linked ninety
// seconds earlier. Every layer underneath had worked. `planSupersededConnections` marked
// both older items `revoked`; their accounts were deactivated one second before the new
// rows were written; nothing was double-counted. The only defect was that this hook handed
// the UI every row it could find, retired ones included.
//
// The fixture below is his three real rows, by status and shape, with the ids and balances
// removed. It is deliberately the awkward case: TWO revoked rows for the SAME institution
// as the live one, which is what made the screen show three banks that are one bank.
//
// Would-fail checks: drop the filter in useFinancialConnections and the first two cases
// fail with 3 instead of 1; drop `allConnections` and the audit case fails; stop carrying
// `connection_status` through usePlaidItems and the last case fails. Each of those is a
// change someone could plausibly make while "tidying", and each puts a retired bank back
// on the user's screen.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'financial_connections') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.rows, error: null }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemo: false }),
}));

import { useFinancialConnections } from '@/hooks/useFinancialConnections';
import { usePlaidItems } from '@/hooks/usePlaidItems';

/** Robinhood, three times: two retired links and the one that actually works. */
const ROBINHOOD_ROWS = [
  {
    id: 'conn-old-april', provider: 'plaid', provider_item_id: 'item-april',
    institution_id: 'ins_54', institution_name: 'Robinhood',
    connection_status: 'revoked',
    last_synced_at: '2026-09-04T13:00:28.665Z', created_at: '2026-04-22T14:17:36.324Z',
  },
  {
    id: 'conn-old-august', provider: 'plaid', provider_item_id: 'item-august',
    institution_id: 'ins_54', institution_name: 'Robinhood',
    connection_status: 'revoked',
    last_synced_at: '2026-09-04T13:00:23.527Z', created_at: '2026-08-22T00:01:04.142Z',
  },
  {
    id: 'conn-live', provider: 'plaid', provider_item_id: 'item-live',
    institution_id: 'ins_54', institution_name: 'Robinhood',
    connection_status: 'active',
    last_synced_at: '2026-09-05T06:58:27.000Z', created_at: '2026-09-05T06:58:25.024Z',
  },
];

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('revoked financial connections never reach the user', () => {
  beforeEach(() => { state.rows = [...ROBINHOOD_ROWS]; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('lists ONE Robinhood, not three, when two links have been superseded', async () => {
    const { result } = renderHook(() => useFinancialConnections(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].id).toBe('conn-live');
  });

  it('shows the user no retired bank at all, whatever its status text says', async () => {
    const { result } = renderHook(() => useFinancialConnections(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.connections.map(c => c.connection_status)).not.toContain('revoked');
  });

  it('keeps every row on allConnections, because supersession never deletes', async () => {
    const { result } = renderHook(() => useFinancialConnections(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.allConnections).toHaveLength(3);
    expect(result.current.allConnections.filter(c => c.connection_status === 'revoked'))
      .toHaveLength(2);
  });

  it('leaves a link the user must FIX in the list — revoked is not the same as unhealthy', async () => {
    state.rows = [
      { ...ROBINHOOD_ROWS[2], id: 'conn-reauth', connection_status: 'reauth_required' },
      { ...ROBINHOOD_ROWS[0] },
    ];
    const { result } = renderHook(() => useFinancialConnections(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A bank that needs re-authenticating is exactly the row the user MUST see. Only the
    // retired one is hidden, or the fix would silently swallow a real call to action.
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0].connection_status).toBe('reauth_required');
  });

  it('carries the status through usePlaidItems so a caller can tell live from retired', async () => {
    const { result } = renderHook(() => usePlaidItems(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].connection_status).toBe('active');
    expect(result.current.items[0].plaid_item_id).toBe('item-live');
  });
});
