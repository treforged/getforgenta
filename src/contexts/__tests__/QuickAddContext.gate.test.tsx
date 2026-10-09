// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QuickAddProvider, useQuickAdd } from '../QuickAddContext';

/**
 * Quick add is FREE ON WEB and gated in the native app (Tre, 2026-10-09). Would-fail checks: drop the
 * web exemption and "a free web user gets the sheet" fails; apply it everywhere and "a free native user
 * goes to /premium" fails, which would change native pricing nobody approved.
 */

const state = { isPremium: false, isDemo: false, native: false };
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: state.isPremium }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native } }));
vi.mock('@/components/shared/QuickAddSheet', () => ({ default: () => <div data-testid="sheet" /> }));

function Door() {
  const { openQuickAdd, canQuickAdd } = useQuickAdd();
  return <button onClick={openQuickAdd}>{canQuickAdd ? 'add' : 'add (premium)'}</button>;
}

function renderDoor() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <QuickAddProvider>
        <Routes>
          <Route path="/dashboard" element={<Door />} />
          <Route path="/premium" element={<p>premium page</p>} />
        </Routes>
      </QuickAddProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { Object.assign(state, { isPremium: false, isDemo: false, native: false }); });

describe('quick add gate', () => {
  it('a free web user gets the sheet', async () => {
    renderDoor();
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(await screen.findByTestId('sheet')).toBeTruthy();
    expect(screen.queryByText('premium page')).toBeNull();
  });

  it('a free native user goes to /premium', () => {
    state.native = true;
    renderDoor();
    fireEvent.click(screen.getByRole('button', { name: 'add (premium)' }));
    expect(screen.getByText('premium page')).toBeTruthy();
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('a premium native user gets the sheet', async () => {
    Object.assign(state, { native: true, isPremium: true });
    renderDoor();
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(await screen.findByTestId('sheet')).toBeTruthy();
  });
});
