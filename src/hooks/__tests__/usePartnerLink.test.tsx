// @vitest-environment jsdom
/**
 * The link lifecycle from the client's side (docs/partner-linking-design.md §1, §5).
 *
 * What matters here:
 *  - REVOKE is a direct RLS-scoped UPDATE (never the Edge Function — leaving must work
 *    when functions are down), and on success it resets the lens to self and REMOVES the
 *    ex-partner's cached queries so nothing of theirs survives on this device.
 *  - A revoke the database silently ignored (zero rows) is a FAILURE, not a success.
 *  - The Edge Function being unreachable (not deployed / network down) is a first-class
 *    state: the mutation settles with a clear error instead of hanging or lying.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const switchBackSpy = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  updateResult: { data: [{ id: 'link-1' }] as unknown, error: null as unknown },
  updatePayloads: [] as Record<string, unknown>[],
  selectRows: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'partner_links') throw new Error(`unexpected table ${table}`);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'or', 'eq', 'is', 'order', 'limit']) {
        b[m] = () => b;
      }
      b.update = (payload: Record<string, unknown>) => {
        state.updatePayloads.push(payload);
        const u: Record<string, unknown> = {};
        for (const m of ['eq', 'is']) u[m] = () => u;
        u.select = async () => state.updateResult;
        return u;
      };
      (b as { then?: unknown }).then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => Promise.resolve({ data: state.selectRows, error: null }).then(onFulfilled, onRejected);
      return b;
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' }, loading: false }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/ViewedProfileContext', () => ({
  useViewedProfile: () => ({
    viewedUserId: 'partner-2',
    isPartnerView: true,
    switchTo: vi.fn(),
    switchBack: switchBackSpy,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const tracedInvokeMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tracer', () => ({ tracedInvoke: tracedInvokeMock }));

import { usePartnerLink } from '../usePartnerLink';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updateResult = { data: [{ id: 'link-1' }], error: null };
  state.updatePayloads = [];
  state.selectRows = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('revoke — leaving always works, and leaves nothing behind', () => {
  it('resets the lens to self and drops every cached query under the ex-partner\'s id', async () => {
    client.setQueryData(['accounts', 'partner-2'], []);
    client.setQueryData(['transactions', 'partner-2'], []);
    client.setQueryData(['accounts', 'owner-1'], []);

    const { result } = renderHook(() => usePartnerLink(), { wrapper });
    await result.current.revoke.mutateAsync({ id: 'link-1', exPartnerUserId: 'partner-2', kind: 'link' });

    expect(switchBackSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(client.getQueryCache().find({ queryKey: ['accounts', 'partner-2'] })).toBeUndefined();
      expect(client.getQueryCache().find({ queryKey: ['transactions', 'partner-2'] })).toBeUndefined();
    });
    // The owner's own cache survives — only the ex-partner's keys are purged.
    expect(client.getQueryCache().find({ queryKey: ['accounts', 'owner-1'] })).toBeTruthy();
    // The write is the direct RLS update, stamped with who revoked.
    expect(state.updatePayloads[0]).toMatchObject({ revoked_by: 'owner-1' });
    expect(state.updatePayloads[0].revoked_at).toEqual(expect.any(String));
    // And the Edge Function was never involved.
    expect(tracedInvokeMock).not.toHaveBeenCalled();
  });

  it('a zero-row update is a failure, not a silent success', async () => {
    state.updateResult = { data: [], error: null };
    const { result } = renderHook(() => usePartnerLink(), { wrapper });
    await expect(
      result.current.revoke.mutateAsync({ id: 'link-1', exPartnerUserId: 'partner-2', kind: 'link' }),
    ).rejects.toThrow();
    expect(switchBackSpy).not.toHaveBeenCalled();
  });
});

describe('invite / accept — the Edge Function being down is a first-class state', () => {
  it('an unreachable function surfaces a clear error and the mutation settles', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: null,
      error: new Error('Failed to send a request to the Edge Function'),
    });
    const { result } = renderHook(() => usePartnerLink(), { wrapper });
    await expect(result.current.invite.mutateAsync('partner@example.com'))
      .rejects.toThrow(/unavailable/i);
    expect(toastError).toHaveBeenCalled();
  });

  it('a JSON error body from the function is shown verbatim (the server\'s words, not ours)', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('http error'), {
        context: { json: async () => ({ error: 'Partner linking is a premium feature.' }) },
      }),
    });
    const { result } = renderHook(() => usePartnerLink(), { wrapper });
    await expect(result.current.invite.mutateAsync('partner@example.com'))
      .rejects.toThrow('Partner linking is a premium feature.');
  });

  it('accept passes the code through and succeeds on an ok response', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: { ok: true, link_id: 'link-9', partner: { user_id: 'partner-9', display_name: 'Sam' } },
      error: null,
    });
    const { result } = renderHook(() => usePartnerLink(), { wrapper });
    await result.current.accept.mutateAsync('SOME-CODE');
    expect(tracedInvokeMock).toHaveBeenCalledWith(
      expect.anything(), 'partner-link',
      expect.objectContaining({ body: { action: 'accept', code: 'SOME-CODE' } }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });
});
