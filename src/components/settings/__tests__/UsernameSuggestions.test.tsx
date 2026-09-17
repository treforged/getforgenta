// @vitest-environment jsdom
//
// PRESSING A SUGGESTION MUST CHANGE SOMETHING, AND THE EMPTY STATE MUST SAY WHY IT IS EMPTY.
//
// Two arms carry this file. The first is a positive control: with rows, the list renders and a
// press calls `onPick` with that row's username - not "it did not throw". The second is the empty
// state, which exists because `visibility` defaults to `'private'` and (measured 2026-09-17) no
// profile is public, so for now this renders nothing for everybody. A silently blank dropdown
// reads as a broken feature and invites somebody to "fix" it by widening the server filter, which
// would turn a typeahead into account enumeration. Asserting the sentence is asserting that guard.
//
// WHAT THIS DOES NOT COVER: the real RPC (see useUsernameSuggestions.query.test.tsx for the
// request shape, and the migration header for the server rule), and anything geometric - jsdom
// has no layout.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const hookState = vi.hoisted(() => ({
  suggestions: [] as { user_id: string; username: string; display_name: string | null }[],
  loading: false,
}));

vi.mock('@/hooks/useUsernameSuggestions', () => ({
  MIN_PREFIX: 2,
  useUsernameSuggestions: () => hookState,
}));

import { UsernameSuggestions } from '../UsernameSuggestions';

beforeEach(() => {
  hookState.suggestions = [];
  hookState.loading = false;
});

describe('the suggestion list', () => {
  it('POSITIVE CONTROL: renders a row and a press hands the username back', () => {
    hookState.suggestions = [
      { user_id: 'u1', username: 'walkprobe', display_name: 'Deck Walk' },
      { user_id: 'u2', username: 'walker', display_name: null },
    ];
    const onPick = vi.fn();
    render(<UsernameSuggestions prefix="wa" onPick={onPick} />);

    expect(screen.getByTestId('username-suggestions')).toBeTruthy();
    expect(screen.getByText('@walkprobe')).toBeTruthy();
    expect(screen.getByText('Deck Walk')).toBeTruthy();

    fireEvent.click(screen.getByText('@walkprobe'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('walkprobe');
  });

  it('says WHY it is empty rather than rendering a blank space', () => {
    render(<UsernameSuggestions prefix="wa" onPick={vi.fn()} />);
    const empty = screen.getByTestId('username-suggestions-empty');
    expect(empty.textContent).toContain('Only accounts set to public appear here');
    expect(screen.queryByTestId('username-suggestions')).toBeNull();
  });

  it('renders nothing at all below the minimum prefix', () => {
    hookState.suggestions = [{ user_id: 'u1', username: 'walkprobe', display_name: null }];
    const { container } = render(<UsernameSuggestions prefix="w" onPick={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the query is in flight - no flash of the empty sentence', () => {
    hookState.loading = true;
    const { container } = render(<UsernameSuggestions prefix="wa" onPick={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
