// @vitest-environment jsdom
/**
 * This test suite verifies the core behavior of useUsernameSuggestions.
 * Arms 2, 5, and 6 are absence assertions; they would pass if the hook
 * performed no work at all. Therefore arm 1 (the positive control) runs
 * first to confirm that the hook does make the expected RPC call when
 * conditions are met, establishing a baseline for the subsequent
 * negative tests.
 */

import { createElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUsernameSuggestions } from '../useUsernameSuggestions';

const calls = vi.hoisted(() => ({
  rpc: [] as { name: string; args: unknown }[],
  fromCalls: [] as string[],
  rows: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      return Promise.resolve({ data: calls.rows, error: null });
    },
    from: (t: string) => {
      calls.fromCalls.push(t);
      throw new Error('the typeahead must not read profiles directly');
    },
  },
}));

const authState = vi.hoisted(() => ({ user: { id: 'user1' } as { id: string } | null }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

const demoState = vi.hoisted(() => ({ isDemo: false }));
vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => demoState,
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  );

beforeEach(() => {
  calls.rpc.length = 0;
  calls.fromCalls.length = 0;
  calls.rows.length = 0;
  authState.user = { id: 'user1' };
  demoState.isDemo = false;
});

describe('useUsernameSuggestions', () => {
  it('POSITIVE CONTROL: 2-char prefix triggers RPC once and returns suggestions', async () => {
    calls.rows = [
      { user_id: '1', username: 'abuser', display_name: 'AB User' },
    ];
    const { result } = renderHook(() => useUsernameSuggestions('ab'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1), { timeout: 2000 });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0]).toEqual({
      name: 'suggest_profiles_by_username',
      args: { p_prefix: 'ab' },
    });
    expect(result.current.suggestions[0].username).toBe('abuser');
  });

  it('1-char prefix does not call RPC and returns empty suggestions', async () => {
    const { result } = renderHook(() => useUsernameSuggestions('a'), {
      wrapper,
    });

    await new Promise((r) => setTimeout(r, 400));
    expect(calls.rpc.length).toBe(0);
    expect(result.current.suggestions).toEqual([]);
  });

  it('prefix is trimmed and lowercased before RPC', async () => {
    calls.rows = [];
    const { result } = renderHook(() => useUsernameSuggestions('  TrE  '), {
      wrapper,
    });

    await waitFor(() => expect(calls.rpc.length).toBe(1), { timeout: 2000 });
    expect(calls.rpc[0].args).toEqual({ p_prefix: 'tre' });
    expect(result.current.suggestions).toEqual([]);
  });

  it('never reads the profiles table directly - a client-side prefix select IS enumeration', async () => {
    renderHook(() => useUsernameSuggestions('ab'), { wrapper });

    await waitFor(() => expect(calls.rpc.length).toBe(1), { timeout: 2000 });
    expect(calls.fromCalls).toEqual([]);
  });

  it('demo mode skips RPC entirely', async () => {
    demoState.isDemo = true;
    const { result } = renderHook(() => useUsernameSuggestions('ab'), {
      wrapper,
    });

    await new Promise((r) => setTimeout(r, 400));
    expect(calls.rpc.length).toBe(0);
    expect(result.current.suggestions).toEqual([]);
  });

  it('signed-out session skips RPC entirely', async () => {
    authState.user = null;
    const { result } = renderHook(() => useUsernameSuggestions('ab'), {
      wrapper,
    });

    await new Promise((r) => setTimeout(r, 400));
    expect(calls.rpc.length).toBe(0);
    expect(result.current.suggestions).toEqual([]);
  });
});
