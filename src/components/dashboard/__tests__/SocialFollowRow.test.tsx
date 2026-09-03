// @vitest-environment jsdom
//
// The follow links, PRESSED — and the wording, which matters as much as the write.
//
// This badge cannot be verified: neither Instagram nor TikTok lets a consumer app ask whether a
// follow happened, so the client claims it and the RLS policy allows exactly these two ids. The
// consequence is that the UI must never say something the app did not observe. It observed a TAP.
//
// Would-fail checks: change the earned label to "Followed us" and the wording case fails; drop
// the noopener/noreferrer and the security case fails; let the claim write any other id and the
// allowed-ids case fails — that id list is the same one keeping `og_founder` out of a client's
// reach.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  rows: [] as { achievement_id: string }[],
  inserts: [] as Record<string, unknown>[],
  insertError: null as { code: string } | null,
  isDemo: false,
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'achievements') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: state.rows, error: null }),
          }),
        }),
        insert: async (payload: Record<string, unknown>) => {
          if (state.insertError) return { error: state.insertError };
          state.inserts.push(payload);
          state.rows = [...state.rows, { achievement_id: payload.achievement_id as string }];
          return { error: null };
        },
      };
    },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));

import SocialFollowRow from '../SocialFollowRow';
import { SOCIAL_LINKS } from '@/lib/social-links';

let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SocialFollowRow />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  state.rows = [];
  state.inserts.length = 0;
  state.insertError = null;
  state.isDemo = false;
  state.user = { id: 'user-1' };
});
afterEach(cleanup);

const instagram = () => screen.findByRole('link', { name: /instagram/i });

describe('SocialFollowRow', () => {
  it('links out to both networks', async () => {
    mount();
    const ig = await instagram();
    expect(ig.getAttribute('href')).toBe(SOCIAL_LINKS[0].url);
    expect(await screen.findByRole('link', { name: /tiktok/i })).toBeTruthy();
  });

  it('opens in a new tab WITHOUT handing that tab a handle on this one', async () => {
    mount();
    const ig = await instagram();
    expect(ig.getAttribute('target')).toBe('_blank');
    // target="_blank" without noopener leaves window.opener live on the opened page.
    expect(ig.getAttribute('rel')).toContain('noopener');
    expect(ig.getAttribute('rel')).toContain('noreferrer');
  });

  it('records the tap when pressed, using only an id the RLS policy allows', async () => {
    mount();
    fireEvent.click(await instagram());

    await waitFor(() => expect(state.inserts.length).toBe(1));
    expect(state.inserts[0]).toEqual({ user_id: 'user-1', achievement_id: 'follow_instagram' });
    // The id list is exactly what the policy permits. `og_founder` is not on it, which is what
    // stops a client granting itself a free year.
    expect(['follow_instagram', 'follow_tiktok']).toContain(state.inserts[0].achievement_id);
  });

  it('SAYS ONLY WHAT IT OBSERVED — a tap, never a follow', async () => {
    state.rows = [{ achievement_id: 'follow_instagram' }];
    mount();

    expect(await screen.findByText(/tapped through to instagram/i)).toBeTruthy();
    // The app cannot check whether anyone followed, so it must never say they did.
    expect(screen.queryByText(/followed us/i)).toBeNull();
    expect(screen.queryByText(/thanks for following/i)).toBeNull();
  });

  it('does not claim twice for the same network', async () => {
    state.rows = [{ achievement_id: 'follow_instagram' }];
    mount();
    fireEvent.click(await instagram());

    // Already earned — the link still opens, but nothing is written again.
    await waitFor(() => expect(state.inserts.length).toBe(0));
  });

  it('still opens the link for a demo reader, and writes nothing', async () => {
    state.isDemo = true;
    state.user = null;
    mount();

    const ig = await instagram();
    expect(ig.getAttribute('href')).toBe(SOCIAL_LINKS[0].url);
    fireEvent.click(ig);
    await waitFor(() => expect(state.inserts.length).toBe(0));
  });

  it('a failed badge write is silent — the tap was the point', async () => {
    state.insertError = { code: '42501' };
    mount();
    fireEvent.click(await instagram());
    // No toast, no thrown error, nothing on screen that interrupts someone mid-tap.
    await waitFor(() => expect(screen.queryByText(/could not/i)).toBeNull());
  });
});
