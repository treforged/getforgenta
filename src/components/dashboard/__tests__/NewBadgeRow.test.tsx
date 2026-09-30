// @vitest-environment jsdom
// The dashboard line for a just-earned badge: shows once, offers Share, and Dismiss sticks.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({ rows: [] as unknown[], demo: false }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.demo }) }));
vi.mock('@/hooks/useMilestoneAchievements', () => ({ useMilestoneAchievements: () => ({ data: state.rows, loading: false }) }));

import NewBadgeRow from '../NewBadgeRow';
import { lookupMilestone } from '@/lib/milestone-achievements';

// A REAL milestone id, taken from the definitions, so `known` is true through the real lookup.
const GOAL_ID = ['milestone:goal_reached', 'milestone:first_goal_reached', 'milestone:goal'].find((id) => lookupMilestone(id));
const anyKnown = GOAL_ID ?? null;

const fresh = () => [{ id: anyKnown, name: lookupMilestone(anyKnown as string)?.name, description: '', threshold: 1, progress: 1, earned: true, earnedAt: new Date(Date.now() - 3600_000).toISOString() }];

beforeEach(() => { localStorage.clear(); state.demo = false; state.rows = fresh(); });
afterEach(() => cleanup());

describe('NewBadgeRow', () => {
  it('has a real milestone id to test with', () => { expect(anyKnown).not.toBeNull(); });

  it('shows a just-earned badge with a Share control', () => {
    render(<NewBadgeRow />);
    expect(screen.getByTestId('new-badge-row').textContent).toContain(lookupMilestone(anyKnown as string)?.name as string);
    expect(screen.getByTestId(`share-new-badge-${anyKnown}`)).toBeTruthy();
  });

  it('Dismiss hides it and it stays hidden on the next mount', () => {
    render(<NewBadgeRow />);
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss the / }));
    expect(screen.queryByTestId('new-badge-row')).toBeNull();
    cleanup();
    render(<NewBadgeRow />);
    expect(screen.queryByTestId('new-badge-row')).toBeNull();
  });

  it('shows nothing for a badge earned weeks ago, or in demo', () => {
    state.rows = [{ ...(fresh()[0] as object), earnedAt: '2026-01-01T00:00:00Z' }];
    render(<NewBadgeRow />);
    expect(screen.queryByTestId('new-badge-row')).toBeNull();
    cleanup();
    state.rows = fresh(); state.demo = true;
    render(<NewBadgeRow />);
    expect(screen.queryByTestId('new-badge-row')).toBeNull();
  });
});
