// @vitest-environment jsdom
//
// THE USERNAME TYPEAHEAD, PRESSED - the client half that `f8da9783` says in its own commit
// subject was NOT YET VERIFIED.
//
// The server half was measured separately on 2026-09-17 against the live database, inside a
// transaction that was rolled back and read back from outside it: seven arms, all pass, and the
// load-bearing one is the POSITIVE CONTROL - a PUBLIC profile IS suggested. Without it, "a
// private account is not suggested" is satisfied perfectly by a function that returns nothing at
// all, which is exactly what the shipped state looks like today (zero public profiles). That
// evidence lives in `supabase/probes/suggest-profiles-discriminating-pair.sql`.
//
// This file protects the half a database probe cannot see:
//  - below the minimum prefix the component renders NOTHING and the RPC is never called;
//  - above it with rows, the list RENDERS - the positive control, for the same reason as above;
//  - above it with NO rows, it renders the sentence explaining WHY it is empty, because a
//    silently blank dropdown is what invites somebody to "fix" it by widening the filter, and
//    widening the filter turns a typeahead into account enumeration;
//  - pressing a suggestion calls `onPick` WITH THE USERNAME - a change, not the absence of an
//    error;
//  - a demo reader never reaches the RPC at all.
//
// Would-fail checks: drop the `longEnough` guard and the minimum-prefix cases fail; replace the
// empty state with `null` and the explanation case fails; pass `s.display_name` to `onPick`
// instead of `s.username` and the press case fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  /** What the RPC returns for a long-enough prefix. */
  rows: [] as { user_id: string; username: string; display_name: string | null }[],
  /** Every prefix the RPC was actually asked for. Empty = the query never fired. */
  calls: [] as string[],
  isDemo: false,
  user: { id: 'me' } as { id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: async (fn: string, args: { p_prefix: string }) => {
      if (fn !== 'suggest_profiles_by_username') throw new Error(`unexpected rpc ${fn}`);
      state.calls.push(args.p_prefix);
      return { data: state.rows, error: null };
    },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));

import { UsernameSuggestions } from '../UsernameSuggestions';
import { MIN_PREFIX } from '@/hooks/useUsernameSuggestions';

function renderAt(prefix: string, onPick = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <UsernameSuggestions prefix={prefix} onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  state.rows = [];
  state.calls = [];
  state.isDemo = false;
  state.user = { id: 'me' };
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the minimum prefix is enforced on screen, not just in SQL', () => {
  it('MIN_PREFIX is 2 - one character would let 26 queries enumerate everybody', () => {
    expect(MIN_PREFIX).toBe(2);
  });

  it('one character renders nothing at all, and never asks the server', async () => {
    renderAt('w');
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByTestId('username-suggestions')).toBeNull();
    expect(screen.queryByTestId('username-suggestions-empty')).toBeNull();
    expect(state.calls).toEqual([]);
  });
});

describe('what the reader actually sees', () => {
  it('POSITIVE CONTROL - a returned profile IS rendered, as a pressable row', async () => {
    // Load-bearing. Every other assertion in this file is an absence, and a component that
    // renders nothing ever satisfies all of them.
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: 'Deck Walk' }];
    renderAt('wa');
    await waitFor(() => expect(screen.getByTestId('username-suggestions')).toBeTruthy());
    expect(screen.getByRole('button', { name: /walkprobe/ })).toBeTruthy();
    expect(screen.queryByTestId('username-suggestions-empty')).toBeNull();
    expect(state.calls).toContain('wa');
  });

  it('no matches SAYS WHY it is empty rather than being silently blank', async () => {
    // This sentence is the reason nobody "fixes" an empty dropdown by widening the filter - and
    // widening it is what would turn a typeahead into account enumeration.
    state.rows = [];
    renderAt('zz');
    await waitFor(() => expect(screen.getByTestId('username-suggestions-empty')).toBeTruthy());
    expect(screen.getByTestId('username-suggestions-empty').textContent)
      .toMatch(/only accounts set to public appear here/i);
  });

  it('a long display name does not push the username off the row', async () => {
    // The Account column is narrow and a display name is user-supplied. `truncate min-w-0` is
    // what keeps it in its box; the username carries `shrink-0` so it survives.
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: 'x'.repeat(200) }];
    renderAt('wa');
    await waitFor(() => expect(screen.getByTestId('username-suggestions')).toBeTruthy());
    const name = screen.getByText(/^x+$/);
    expect(name.className).toMatch(/truncate/);
    expect(name.className).toMatch(/min-w-0/);
  });
});

describe('pressing a suggestion', () => {
  it('hands back the USERNAME - asserting the change, not the absence of an error', async () => {
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: 'Deck Walk' }];
    const onPick = renderAt('wa');
    await waitFor(() => expect(screen.getByTestId('username-suggestions')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /walkprobe/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    // Not the display name, and not the user id. The field is a username field.
    expect(onPick).toHaveBeenCalledWith('walkprobe');
  });

  it('does not follow anybody by itself - it only fills the field', async () => {
    // Following is the irreversible-feeling action and stays one deliberate press away. The
    // component is given exactly one callback, so the guarantee is that nothing else can happen:
    // no rpc beyond the suggestion read fires on a press.
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: null }];
    renderAt('wa');
    await waitFor(() => expect(screen.getByTestId('username-suggestions')).toBeTruthy());
    const before = state.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /walkprobe/ }));
    expect(state.calls.length).toBe(before);
  });
});

describe('who never reaches the server', () => {
  it('a demo reader asks for nothing', async () => {
    state.isDemo = true;
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: null }];
    renderAt('wa');
    await vi.advanceTimersByTimeAsync(500);
    expect(state.calls).toEqual([]);
  });

  it('a signed-out reader asks for nothing', async () => {
    state.user = null;
    state.rows = [{ user_id: 'u1', username: 'walkprobe', display_name: null }];
    renderAt('wa');
    await vi.advanceTimersByTimeAsync(500);
    expect(state.calls).toEqual([]);
  });
});
