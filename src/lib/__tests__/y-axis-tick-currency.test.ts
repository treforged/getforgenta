/**
 * `formatYAxisTick` must obey the user's currency, exactly as `formatCurrency` does.
 *
 * ⚠️ WHY THIS FILE EXISTS. The function hardcoded `$` on all three of its branches and
 * had NO test at all. It was found in a BROWSER on 2026-09-13: the reviewer account is
 * set to EUR, and `/debt` → Credit Card Payoff drew `$0 … $6.0k` up the axis while all
 * 23 money figures on the same screen read `€`.
 *
 * The lesson worth keeping is about the ASSERTION, not the symbol: a test on a money
 * string almost always pins the NUMBER, and the currency symbol rides along unchecked.
 * So every case below asserts the SYMBOL, and the en-US cases assert the whole string
 * so the house style cannot drift either.
 *
 * One function feeds SEVEN charts (Dashboard, Forecast, Savings Goals, Net Worth,
 * vehicle loans, and both debt charts), which is why a one-line defect was app-wide.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { formatYAxisTick, setMoneyDisplay, resetMoneyDisplay } from '../calculations';

afterEach(() => {
  // Without this one test leaks its currency into the next — the module holds state.
  resetMoneyDisplay();
});

describe('formatYAxisTick — the default US rendering is unchanged', () => {
  // These pin the EXACT existing strings. The currency fix was not licence to restyle
  // seven charts, so a change in casing or separator here is a regression, not a tidy-up.
  it.each([
    [0, '$0'],
    [66, '$66'],
    [1500, '$1.5k'],
    [4200, '$4.2k'],
    [12000, '$12k'],
    [-1500, '-$1.5k'],
  ])('%i renders as %s', (input, expected) => {
    expect(formatYAxisTick(input)).toBe(expected);
  });

  it('⚠️ THE ONE DELIBERATE en-US CHANGE: a round thousand loses its ".0"', () => {
    // Was `$3.0k` under the hardcoded-$ version, because that branch always ran
    // toFixed(1). Compact notation drops a trailing zero, so it now reads `$3k`.
    // Pinned rather than left to drift: it is the only visible difference the
    // currency fix makes to the US rendering, and it should be a decision someone
    // took, not a surprise in a screenshot.
    expect(formatYAxisTick(3000)).toBe('$3k');
  });
});

describe('formatYAxisTick — no padded fraction on an integral tick, on ANY ICU', () => {
  /**
   * ⚠️ THIS GROUP EXISTS BECAUSE CI WENT RED AND THIS MACHINE COULD NOT.
   *
   * The first fix set only `maximumFractionDigits`, which under `notation: 'compact'`
   * leaves ECMA-402 on the compact rounding default — and ICU builds disagree there.
   * GitHub's runner printed `$0.0`, `$66.0`, `$3.0k`, `$12.0k`; node v24.14.0 / ICU
   * 78.2 printed `$0`, `$66`, `$3k`, `$12k`. Same code, same locale, different string.
   *
   * The exact-string cases above pin the house style but are blind to WHY it drifted.
   * This one states the property directly — an integral amount never grows a `.0` —
   * so it fails on whichever engine regresses rather than only on the one I happen to
   * be running. `test:tz` varies the ZONE and never the ICU, so nothing else here
   * covers this.
   */
  it.each([0, 66, 3000, 12000, 250000])('%i renders with no trailing .0', (input) => {
    expect(formatYAxisTick(input)).not.toMatch(/\.0(?!\d)/);
  });

  it('a genuinely fractional tick KEEPS its one decimal', () => {
    // The guard above must not be satisfied by dropping precision everywhere — that
    // would turn $4.2k into $4k and quietly coarsen every chart.
    expect(formatYAxisTick(4200)).toBe('$4.2k');
  });
});

describe('formatYAxisTick — it follows the currency, which is the actual defect', () => {
  it('THE BUG: a EUR user gets € on the axis, not $', () => {
    setMoneyDisplay({ currency: 'EUR', locale: 'en-IE' });
    const tick = formatYAxisTick(4200);
    expect(tick).toContain('€');
    // The assertion that would have caught the original defect, stated plainly.
    expect(tick).not.toContain('$');
  });

  it('GBP too — so this is about the setting, not a second hardcoded symbol', () => {
    setMoneyDisplay({ currency: 'GBP', locale: 'en-GB' });
    const tick = formatYAxisTick(4200);
    expect(tick).toContain('£');
    expect(tick).not.toContain('$');
  });

  it('a EUR axis and a EUR balance agree — the two-currencies-on-one-screen case', () => {
    setMoneyDisplay({ currency: 'EUR', locale: 'en-IE' });
    // formatCurrency was always right; the axis was the half that disagreed with it.
    const axisSymbol = formatYAxisTick(4200).replace(/[\d.,\s\-k]/g, '');
    expect(axisSymbol).toBe('€');
  });
});

describe('formatYAxisTick — the magnitude suffix is localised, not glued on', () => {
  it('de-DE gets its own suffix and trailing symbol, never a stray "k"', () => {
    setMoneyDisplay({ currency: 'EUR', locale: 'de-DE' });
    const tick = formatYAxisTick(1500);
    expect(tick).toContain('€');
    // German writes the symbol AFTER the number. A hand-appended 'k' would have landed
    // past the symbol ("1,5 €k"), which is the bug the naive fix introduces.
    expect(tick).not.toMatch(/€k/);
  });

  it('the K→k step only touches a bare ASCII K, never a localised suffix', () => {
    setMoneyDisplay({ currency: 'EUR', locale: 'de-DE' });
    const tick = formatYAxisTick(1500);
    // ⚠️ DO NOT assert "Tsd." here. This runner's ICU returns `1500 €` for de-DE
    // compact — the data for that suffix is not in the build — so pinning it would
    // test Node's ICU, not this function, and would pass or fail by environment.
    // What IS ours, and holds in every ICU: the amount, the right symbol, and no
    // ASCII 'k' invented by us where the locale did not ask for one.
    expect(tick).toContain('€');
    expect(tick).not.toMatch(/€k/);
    expect(tick).not.toMatch(/\dk/);
  });
});
