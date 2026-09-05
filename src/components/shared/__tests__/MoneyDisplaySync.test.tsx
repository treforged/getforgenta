// @vitest-environment jsdom
//
// THE CURRENCY PICKER HAS TO CHANGE A NUMBER ON SCREEN.
//
// `docs/international-release-plan.md`: "a user in Dublin sets EUR, and every balance, every
// projection and every payoff figure still renders in dollars… a control that was built,
// described, and never pressed." It was worse than that — `setMoneyDisplay()` existed, exported
// and documented, and NOTHING outside the tests had ever called it.
//
// So these tests do not assert that the component renders (it renders null). They assert that
// after it has rendered, `formatCurrency` — the function all 446 money call sites go through —
// produces a different string. Anything less would pass against the bug.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({ currency: null as string | null }));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: state.currency === null ? null : { currency: state.currency } }),
}));

import MoneyDisplaySync from '../MoneyDisplaySync';
import { formatCurrency, getMoneyDisplay, resetMoneyDisplay } from '@/lib/calculations';

/** jsdom reports en-US, so the locale half is pinned by overriding `navigator.language`. */
function withLocale(tag: string | undefined, run: () => void) {
  const langs = Object.getOwnPropertyDescriptor(navigator, 'languages');
  const lang = Object.getOwnPropertyDescriptor(navigator, 'language');
  Object.defineProperty(navigator, 'languages', { value: tag ? [tag] : undefined, configurable: true });
  Object.defineProperty(navigator, 'language', { value: tag, configurable: true });
  try { run(); } finally {
    if (langs) Object.defineProperty(navigator, 'languages', langs);
    if (lang) Object.defineProperty(navigator, 'language', lang);
  }
}

beforeEach(() => { state.currency = null; resetMoneyDisplay(); });
afterEach(() => { cleanup(); resetMoneyDisplay(); });

describe('MoneyDisplaySync', () => {
  it('leaves the US default alone before a profile has loaded', () => {
    render(<MoneyDisplaySync />);
    expect(getMoneyDisplay()).toEqual({ locale: 'en-US', currency: 'USD' });
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('a profile with no currency set keeps dollars — it does NOT guess from the locale', () => {
    // Somebody in Berlin who has never opened Settings is far likelier to hold the USD account
    // they signed up with than to want every balance silently restated as euros.
    state.currency = '';
    withLocale('de-DE', () => {
      render(<MoneyDisplaySync />);
      expect(getMoneyDisplay().currency).toBe('USD');
    });
  });

  it('⚠️ THE ACTUAL FIX: picking EUR changes what formatCurrency prints', () => {
    state.currency = 'EUR';
    render(<MoneyDisplaySync />);
    // Before this component existed, this returned "$1,234.56" no matter what the profile said.
    expect(formatCurrency(1234.56)).not.toContain('$');
    expect(formatCurrency(1234.56)).toContain('€');
  });

  it('takes the LOCALE from the browser and the CURRENCY from the profile — different knobs', () => {
    // The plan is explicit: en-US renders "€1,234.56" where the eurozone writes "1.234,56 €".
    // Symbol, grouping, separator and symbol POSITION all come from the locale.
    state.currency = 'EUR';
    withLocale('de-DE', () => {
      render(<MoneyDisplaySync />);
      expect(getMoneyDisplay()).toEqual({ locale: 'de-DE', currency: 'EUR' });
      const out = formatCurrency(1234.56);
      // German grouping and separator, and the symbol AFTER the number.
      expect(out).toContain('1.234,56');
      expect(out.trim().endsWith('€')).toBe(true);
    });
  });

  it('a German locale holding USD writes the dollar the German way, not the American way', () => {
    state.currency = 'USD';
    withLocale('de-DE', () => {
      render(<MoneyDisplaySync />);
      expect(formatCurrency(1234.56)).toContain('1.234,56');
    });
  });

  it('survives a browser that reports no language at all', () => {
    state.currency = 'GBP';
    withLocale(undefined, () => {
      render(<MoneyDisplaySync />);
      expect(getMoneyDisplay().locale).toBe('en-US');
      expect(formatCurrency(1234.56)).toContain('£');
    });
  });

  it('survives a MALFORMED language tag instead of blanking every figure in the app', () => {
    // An invalid tag makes Intl.NumberFormat throw. Unguarded that is a crash on every money
    // render — a blank app rather than a wrong separator.
    state.currency = 'USD';
    withLocale('not a real tag', () => {
      expect(() => render(<MoneyDisplaySync />)).not.toThrow();
      expect(getMoneyDisplay().locale).toBe('en-US');
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });
  });

  it('is idempotent — re-rendering writes the same value, never accumulating', () => {
    state.currency = 'JPY';
    const { rerender } = render(<MoneyDisplaySync />);
    const once = getMoneyDisplay();
    rerender(<MoneyDisplaySync />);
    rerender(<MoneyDisplaySync />);
    expect(getMoneyDisplay()).toEqual(once);
  });

  it('DOES NOT CONVERT — the amount is untouched, only how it is written', () => {
    state.currency = 'EUR';
    render(<MoneyDisplaySync />);
    // 1234.56 stays 1234.56. Calling €100 "$100" would be worse than useless in a finance app.
    expect(formatCurrency(1234.56)).toMatch(/1[.,]234[.,]56/);
  });
});
