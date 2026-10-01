// @vitest-environment jsdom
//
// A CARD THAT HAS NOT OPENED YET IS NOT IN THE WALLET (Tre, 2026-10-01: "cards that have not started
// yet/are not active should not show in 'your cards' of 'which card' tab"). Venture X opens 2027-06,
// so recommending it, or listing it beside open cards, tells him to swipe a card he does not hold.
//
// Would-fail check: drop `isCardOpenAsOf` from the panel's filter and the first case fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

type Row = { id: string; name: string; account_type: string; active: boolean; balance: number;
  apr: number | null; credit_limit: number | null; card_start_date: string | null;
  card_rewards: null; welcome_offer: null };
let mockAccounts: Row[] = [];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: mockAccounts, update: { mutate: vi.fn() } }),
}));

import CardAdvisorPanel from '../CardAdvisorPanel';

const card = (name: string, start: string | null, active = true): Row => ({
  id: name, name, account_type: 'credit_card', active, balance: 100, apr: 24.99,
  credit_limit: 5000, card_start_date: start, card_rewards: null, welcome_offer: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CardAdvisorPanel - cards not open yet', () => {
  it('lists open cards and leaves out a card whose start date is ahead', () => {
    mockAccounts = [card('Prime Visa', '2025-03-01'), card('Discover it', null), card('Venture X', '2027-06-01')];
    render(<CardAdvisorPanel />);
    expect(screen.getAllByText('Prime Visa').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Discover it').length).toBeGreaterThan(0);
    expect(screen.queryByText('Venture X')).toBeNull();
  });

  it('leaves out an inactive card', () => {
    mockAccounts = [card('Prime Visa', null), card('Old Card', null, false)];
    render(<CardAdvisorPanel />);
    expect(screen.queryByText('Old Card')).toBeNull();
  });

  it('shows the no-cards state when the only card has not opened', () => {
    mockAccounts = [card('Venture X', '2027-06-01')];
    render(<CardAdvisorPanel />);
    expect(screen.getByText('No cards yet')).toBeTruthy();
  });
});
