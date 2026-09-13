// @vitest-environment jsdom
//
// THE TOUR STOPS MAKING ITS OWN REQUESTS FOR A ROW THE PAGE ALREADY HAS.
//
// `/rest/v1/profiles` is BIMODAL on this project — measured over 85 timed requests: median 347ms,
// p95 5082ms, five pinned at the ~5s gateway ceiling, 2 of 33 calls returning 504. The table holds
// 49 rows with two indexes, so query cost cannot be the cause; it is "fast, or stuck until the
// gateway gives up". That makes every DUPLICATE request another independent draw against a
// five-second tail, and the Dashboard waits on the slowest of the ones it fires.
//
// This component used to make TWO of its own — one at mount, one in dismiss — both for the same
// `tour_flags` on the same single row `useProfile` already caches.
//
// ⚠️ THE ASSERTION IS THAT IT NEVER TOUCHES THE CLIENT DIRECTLY: the supabase mock THROWS. A test
// that merely counted requests would pass against a version that made them through some other
// path, and the point here is the absence of the request, not its number.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  loading: false,
  updateAsync: vi.fn(),
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: mocks.profile,
    loading: mocks.loading,
    update: { mutateAsync: mocks.updateAsync },
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => { throw new Error('AppTour must not query profiles itself'); },
    auth: { getUser: () => { throw new Error('AppTour must not call auth.getUser'); } },
  },
}));

import AppTour from '../AppTour';

const LOCAL_KEY = 'forged:tour_done_new_user';

/** "Let's go" only exists on the LAST step, so walk there the way a user would. */
function finishTour() {
  for (let i = 0; i < 20; i++) {
    const next = screen.queryByText('Next');
    if (!next) break;
    fireEvent.click(next);
  }
  fireEvent.click(screen.getByText("Let's go"));
}

beforeEach(() => {
  localStorage.clear();
  mocks.profile = { tour_flags: {} };
  mocks.loading = false;
  mocks.updateAsync = vi.fn().mockResolvedValue({});
});
afterEach(cleanup);

describe('when the tour shows', () => {
  it('shows for an account that has not seen it, without any request of its own', () => {
    render(<AppTour variant="new-user" />);
    expect(screen.getByText(/Getting Started/)).toBeTruthy();
  });

  it('⚠️ STAYS HIDDEN WHILE THE PROFILE IS STILL LOADING', () => {
    // The old code only set visible once its own read returned, so an unanswered read never showed
    // the tour. Losing that would flash the tour at everybody on every open — for as long as the
    // slow tail lasts, which is the very thing being fixed.
    mocks.loading = true;
    mocks.profile = null;
    const { container } = render(<AppTour variant="new-user" />);
    expect(container.textContent).toBe('');
  });

  it('stays hidden when the ACCOUNT says it is done', () => {
    mocks.profile = { tour_flags: { new_user_done: true } };
    const { container } = render(<AppTour variant="new-user" />);
    expect(container.textContent).toBe('');
  });

  it('stays hidden when the DEVICE cache says it is done, without consulting the account', () => {
    localStorage.setItem(LOCAL_KEY, '1');
    mocks.profile = { tour_flags: {} };
    const { container } = render(<AppTour variant="new-user" />);
    expect(container.textContent).toBe('');
  });

  it('back-fills the device cache when the account already said done', () => {
    // So the NEXT open takes the fast path and never consults the slow endpoint at all.
    mocks.profile = { tour_flags: { new_user_done: true } };
    render(<AppTour variant="new-user" />);
    expect(localStorage.getItem(LOCAL_KEY)).toBe('1');
  });

  it('⚠️ KEEPS THE VARIANTS SEPARATE — the control', () => {
    // Without this, reading one flag for both variants would pass every case above while hiding
    // the premium tour from everybody who had seen the new-user one.
    mocks.profile = { tour_flags: { new_user_done: true } };
    render(<AppTour variant="premium" />);
    expect(screen.getByText(/Premium Tour/)).toBeTruthy();
  });
});

describe('dismissing', () => {
  it('writes the flag through the shared profile mutation, not a fresh read-then-update', async () => {
    render(<AppTour variant="new-user" />);
    finishTour();
    await waitFor(() => expect(mocks.updateAsync).toHaveBeenCalled());
    expect(mocks.updateAsync).toHaveBeenCalledWith({ tour_flags: { new_user_done: true } });
  });

  it('⚠️ PRESERVES THE OTHER ONE-TIME FLAGS — `tour_flags` is a map, not a field', async () => {
    // Writing only this key would clear the checklist flags and the what is new marker, silently
    // replaying one-time UI the user has already dealt with.
    mocks.profile = { tour_flags: { checklist_accounts: true, 'whats_new_2026-09-13': true } };
    render(<AppTour variant="new-user" />);
    finishTour();
    await waitFor(() => expect(mocks.updateAsync).toHaveBeenCalled());
    expect(mocks.updateAsync).toHaveBeenCalledWith({
      tour_flags: {
        checklist_accounts: true,
        'whats_new_2026-09-13': true,
        new_user_done: true,
      },
    });
  });

  it('still closes when the write fails — a slow endpoint must not trap the user in a modal', async () => {
    mocks.updateAsync = vi.fn().mockRejectedValue(new Error('timeout'));
    const onDone = vi.fn();
    render(<AppTour variant="new-user" onDone={onDone} />);
    finishTour();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(localStorage.getItem(LOCAL_KEY)).toBe('1');
  });
});
