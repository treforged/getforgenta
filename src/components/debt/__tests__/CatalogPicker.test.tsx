// @vitest-environment jsdom
//
// THE CATALOG PICKER HANDS THE EDITOR ONLY WHAT THE RESOLVER WOULD STAND BEHIND (ask f9b0da16, slice 2).
// Each press asserts the rates passed to onApply, so a picker that ignored an answer, or applied a miles
// card with no cent value, fails here rather than in a user's rewards row.
//
// Would-fail checks: apply `with` for an unanswered question and case 1 fails; enable "Use these rates"
// with no cents-per-mile and case 3 fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import CatalogPicker from '../CatalogPicker';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const pick = (name: string) =>
  fireEvent.change(screen.getByLabelText('Fill from a public card'), { target: { value: name } });
const useRates = () => screen.getByRole('button', { name: 'Use these rates' });

describe('CatalogPicker', () => {
  it('Apple Card: applies 1% until the Apple Pay switch is on, then 2%', () => {
    const onApply = vi.fn();
    render(<CatalogPicker onApply={onApply} />);
    pick('apple-card');
    fireEvent.click(useRates());
    expect(onApply).toHaveBeenLastCalledWith({ base_pct: 1, categories: {} });
    fireEvent.click(screen.getByRole('switch', { name: 'Do you pay with Apple Pay?' }));
    fireEvent.click(useRates());
    expect(onApply).toHaveBeenLastCalledWith({ base_pct: 2, categories: {} });
  });

  it('Robinhood: nothing to apply until Gold is confirmed', () => {
    const onApply = vi.fn();
    render(<CatalogPicker onApply={onApply} />);
    pick('robinhood-gold-card');
    expect((useRates() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('catalog-unknown').textContent).toMatch(/Robinhood Gold/);
    fireEvent.click(screen.getByRole('switch', { name: 'Do you have Robinhood Gold?' }));
    fireEvent.click(useRates());
    expect(onApply).toHaveBeenLastCalledWith({ base_pct: 3, categories: {} });
  });

  it('Venture X: disabled with no cent value; 1.25 cents a mile applies 2.5%', () => {
    const onApply = vi.fn();
    render(<CatalogPicker onApply={onApply} />);
    pick('capital-one-venture-x');
    expect((useRates() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Cents per mile'), { target: { value: '1.25' } });
    fireEvent.click(useRates());
    expect(onApply).toHaveBeenLastCalledWith({ base_pct: 2.5, categories: {} });
  });

  // The clock is PINNED: the picker reads today's quarter, so a real-clock test flips the day a
  // quarter is read from the issuer (it did, on 2026-10-01).
  it('shows the issuer source and date, and Discover lists an unread quarter as unknown', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 0, 5, 12));
    try {
      render(<CatalogPicker onApply={vi.fn()} />);
      pick('discover-it-cash-back');
      expect(screen.getByRole('link', { name: "the issuer's page" }).getAttribute('href'))
        .toBe('https://www.discover.com/credit-cards/cash-back/it-card.html');
      expect(screen.getByText(/checked 2026-10-01/)).toBeTruthy();
      expect(screen.getByTestId('catalog-unknown').textContent).toMatch(/This quarter's 5% categories/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('in 2026-Q4 Discover has no unknown and names the categories it cannot rank', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    try {
      render(<CatalogPicker onApply={vi.fn()} />);
      pick('discover-it-cash-back');
      expect(screen.queryByTestId('catalog-unknown')).toBeNull();
      expect(screen.getByText(/also covers Entertainment and Utilities/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
