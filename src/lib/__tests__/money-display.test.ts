// Money renders in ONE configured currency and locale, set in one place.
//
// formatCurrency has 391 call sites; none of them may need changing for a user in Dublin to see
// euros. These pin that, and pin the part that is easy to get half right: the LOCALE decides
// grouping, decimal separator and symbol position, so setting the currency alone still renders
// European money in American shape.
//
// Would-fail check: make formatCurrency read 'en-US' literally again and "renders in the
// configured locale" fails while "renders the configured currency" still passes — which is
// exactly the half-fix this guards against.

import { describe, it, expect, afterEach } from 'vitest';
import { formatCurrency, setMoneyDisplay, getMoneyDisplay, resetMoneyDisplay } from '../calculations';

afterEach(() => resetMoneyDisplay());

describe('money display', () => {
  it('defaults to US dollars, because that is what every existing figure assumed', () => {
    expect(getMoneyDisplay()).toEqual({ locale: 'en-US', currency: 'USD' });
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('renders the configured CURRENCY without touching any call site', () => {
    setMoneyDisplay({ currency: 'GBP', locale: 'en-GB' });
    expect(formatCurrency(1234.56)).toBe('£1,234.56');
  });

  it('renders in the configured LOCALE — grouping and symbol position, not just the symbol', () => {
    // The half-fix this exists to prevent: en-US would give "€1,234.56".
    setMoneyDisplay({ currency: 'EUR', locale: 'de-DE' });
    const out = formatCurrency(1234.56);
    expect(out).toContain('€');
    expect(out).toContain('1.234,56');   // dot groups, comma decimals
    expect(out).not.toContain('1,234.56');
    expect(out.trim().startsWith('€')).toBe(false); // symbol trails in de-DE
  });

  it('NEVER CONVERTS — the amount is untouched', () => {
    // Calling €100 "$100" would be worse than useless. This formats, it does not convert.
    setMoneyDisplay({ currency: 'EUR', locale: 'en-IE' });
    expect(formatCurrency(100, false)).toContain('100');
  });

  it('still honours an explicit per-call currency, for a mixed-currency screen later', () => {
    setMoneyDisplay({ currency: 'EUR', locale: 'en-IE' });
    expect(formatCurrency(50, true, 'USD')).toContain('$');
  });

  it('merges partial updates instead of wiping the other field', () => {
    setMoneyDisplay({ locale: 'en-GB' });
    expect(getMoneyDisplay()).toEqual({ locale: 'en-GB', currency: 'USD' });
  });

  it('resets, so one test cannot leak into the next', () => {
    setMoneyDisplay({ currency: 'JPY', locale: 'ja-JP' });
    resetMoneyDisplay();
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
});
