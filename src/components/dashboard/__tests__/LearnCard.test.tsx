// @vitest-environment jsdom
//
// The Learn card, PRESSED. Every case here opens a lesson and clicks the button a reader clicks;
// none of them assert on what the card merely says. Same discipline as the notification toggle
// beside it, and for the same reason — a control checked by reading its label ships broken.
//
// What is being protected:
//  - "Mark as read" actually WRITES a namespaced `achievements` row for this user and lesson;
//  - the badge and the counter move afterwards, from the row rather than from local state;
//  - a second press cannot mint a second badge (the unique index is treated as success);
//  - a demo/signed-out reader is TOLD the button would do nothing, rather than shown a dead one.
//
// Would-fail checks: drop the insert and "writes a progress row" fails; treat 23505 as an error
// and "a second press is not a failure" fails; remove the readOnly branch and the demo case fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  rows: [] as { achievement_id: string; earned_at: string }[],
  inserts: [] as Record<string, unknown>[],
  /** Set to emulate the unique index firing on a second press. */
  insertError: null as { code: string } | null,
  isDemo: false,
  user: { id: 'user-1' } as { id: string } | null,
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'achievements') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            // `.like()` namespaces the read to lesson rows; the mock mirrors the real chain so a
            // dropped filter would show up here rather than as a Learn ring counting OG badges.
            like: () => ({
              order: async () => ({ data: state.rows, error: null }),
            }),
          }),
        }),
        insert: async (payload: Record<string, unknown>) => {
          if (state.insertError) return { error: state.insertError };
          state.inserts.push(payload);
          state.rows = [
            { achievement_id: payload.achievement_id as string, earned_at: new Date().toISOString() },
            ...state.rows,
          ];
          return { error: null };
        },
      };
    },
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import LearnCard from '../LearnCard';
import { LEARN_LESSONS } from '@/lib/learn-lessons';

const FIRST = LEARN_LESSONS[0];

let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LearnCard />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  state.rows = [];
  state.inserts.length = 0;
  state.insertError = null;
  state.isDemo = false;
  state.user = { id: 'user-1' };
  toastSuccess.mockClear();
  toastError.mockClear();
});
afterEach(cleanup);

/** Open the first lesson from the "next up" row, and hand back its Mark-as-read button. */
async function openFirstLesson() {
  const row = await screen.findAllByRole('button', { name: new RegExp(FIRST.title, 'i') });
  fireEvent.click(row[0]);
  return screen.findByRole('button', { name: /mark as read/i });
}

describe('LearnCard', () => {
  it('offers the first unread lesson and can open it', async () => {
    mount();
    await openFirstLesson();
    // The lesson body is on screen, not just its title.
    expect(screen.getByText(new RegExp(FIRST.body[0].slice(0, 30), 'i'))).toBeTruthy();
    expect(screen.getByText(new RegExp(FIRST.takeaway.slice(0, 25), 'i'))).toBeTruthy();
  });

  it('WRITES a progress row when Mark as read is pressed, and names the badge', async () => {
    mount();
    const button = await openFirstLesson();

    fireEvent.click(button);

    await waitFor(() => expect(state.inserts.length).toBe(1));
    // NAMESPACED. A bare lesson id would be refused by the RLS policy, which only allows
    // `lesson:%` and the two social follows — that is what stops a client minting `og_founder`.
    expect(state.inserts[0]).toEqual({ user_id: 'user-1', achievement_id: `lesson:${FIRST.id}` });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining(FIRST.achievement.name)),
    );
  });

  it('moves the counter afterwards, from the stored row', async () => {
    mount();
    expect(await screen.findByText(`/${LEARN_LESSONS.length}`)).toBeTruthy();

    const button = await openFirstLesson();
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('1')).toBeTruthy());
    // And the next lesson offered is the SECOND one, not the one just read.
    await waitFor(() => expect(screen.getAllByText(LEARN_LESSONS[1].summary).length).toBeGreaterThan(0));
  });

  it('a second press is not a failure, and does not mint a second badge', async () => {
    mount();
    const button = await openFirstLesson();

    state.insertError = { code: '23505' };
    fireEvent.click(button);

    await waitFor(() => expect(toastError).not.toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(state.inserts.length).toBe(0);
  });

  it('surfaces a real write failure instead of pretending it saved', async () => {
    mount();
    const button = await openFirstLesson();

    state.insertError = { code: '42501' };
    fireEvent.click(button);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('tells a demo reader the button would do nothing, rather than showing a dead one', async () => {
    state.isDemo = true;
    state.user = null;
    mount();

    const row = await screen.findAllByRole('button', { name: new RegExp(FIRST.title, 'i') });
    fireEvent.click(row[0]);

    expect(await screen.findByText(/sign in to earn achievements/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mark as read/i })).toBeNull();
  });

  it('does not list the lesson it is already offering', async () => {
    // Found by pressing it in the live app on 2026-09-02: the next lesson had its own row AND
    // appeared again at the top of the list below, reading as two lessons with one name.
    mount();
    await screen.findAllByRole('button', { name: new RegExp(FIRST.title, 'i') });
    expect(screen.getAllByRole('button', { name: new RegExp(FIRST.title, 'i') })).toHaveLength(1);

    // And once it is read, it rejoins the list — the offer has moved on to the next one.
    const button = await openFirstLesson();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: new RegExp(LEARN_LESSONS[1].title, 'i') })).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: new RegExp(FIRST.title, 'i') })).toHaveLength(1),
    );
  });

  it('shows a streak only when there is one, never a zero dressed as a stat', async () => {
    mount();
    await screen.findAllByRole('button', { name: new RegExp(FIRST.title, 'i') });
    expect(screen.queryByText(/day streak/i)).toBeNull();

    cleanup();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    state.rows = [
      { achievement_id: `lesson:${LEARN_LESSONS[0].id}`, earned_at: today.toISOString() },
      { achievement_id: `lesson:${LEARN_LESSONS[1].id}`, earned_at: yesterday.toISOString() },
    ];
    mount();
    expect(await screen.findByText(/2-day streak/i)).toBeTruthy();
  });
});
