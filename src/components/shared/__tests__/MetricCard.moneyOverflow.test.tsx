// @vitest-environment jsdom
//
// A MONEY FIGURE MUST NOT SPILL, AND MUST NOT BE CLIPPED EITHER.
//
// MetricCard's value carried `whitespace-nowrap` with no truncate, and `card-forged` has no
// overflow-hidden — so a wide value did not clip, it SPILLED over the card border onto the
// neighbouring tile and the icon. At 375px the value has roughly 89px, about eight characters,
// so ordinary amounts like -$14,400 or $150,000 overflowed. Live on Dashboard and on
// BudgetControl through a two-column grid with no breakpoint bump. Not an edge case.
//
// ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE, said plainly. The real proof is a 375x667 layout
// assertion that scrollWidth <= clientWidth, and JSDOM CANNOT MAKE IT: it does no layout, so
// every element reports zero width. MaintenanceLog.wrap.test.tsx says the same thing in its own
// comments. So these are class assertions — they lock the DECISION, not the pixels — and the
// pixel check needs a real browser at 375px wide.
//
// ⚠️ THE DECISION THESE LOCK CHANGED ON 2026-09-17, AND BOTH HALVES OF THE OLD ONE WERE WRONG
// IN TURN. The original element used `whitespace-nowrap` and SPILLED. That was fixed by letting
// it WRAP, on the reasoning that a clipped number reads as a smaller number - which is still
// right, and the no-truncate assertion below is unchanged because of it.
//
// Then Tre, with a screenshot of the Home > Overview tiles: "numbers should never wrap. fix
// that." AVG MONTHLY SPEND rendered "$1,42" with the "2" on the next line. A figure broken
// mid-number is not merely ugly - for a moment it is a DIFFERENT NUMBER, which is the same
// class of harm as truncating it.
//
// So the contract is now all three at once: never wrap, never truncate, never spill - held by
// stepping the type size down as the string gets longer (`valueSizeClass`). Neither of the two
// earlier answers is acceptable on its own.
//
// Would-fail checks: remove `whitespace-nowrap` and the no-wrap case fails; "fix" a long value
// with `truncate` and the no-ellipsis case fails, which is still the tempting wrong answer; and
// widen a size step and the boundary pins fail.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrendingUp } from 'lucide-react';
import MetricCard, { valueSizeClass } from '@/components/shared/MetricCard';

/** Eight characters plus a sign — the length measured as overflowing at 375px. */
const WIDE_NEGATIVE = '-$14,400';
const WIDE_POSITIVE = '$150,000';

describe('MetricCard money values', () => {
  afterEach(cleanup);

  it('keeps a wide value on ONE LINE rather than breaking it mid-number', () => {
    render(<MetricCard label="Net Worth" value={WIDE_NEGATIVE} icon={TrendingUp} />);
    const value = screen.getByText(WIDE_NEGATIVE);

    expect(value.className).toContain('whitespace-nowrap');
    expect(value.className).not.toContain('break-words');
  });

  it('shrinks the type instead, which is what makes one line affordable', () => {
    // The paired case: nowrap ALONE is what caused the original spill, so the no-wrap assertion
    // above is only safe because the size steps come with it. Asserting one without the other
    // would re-approve the very defect this element started with.
    render(<MetricCard label="Spend" value="$1,234,567.89" icon={TrendingUp} />);
    const wide = screen.getByText('$1,234,567.89');
    cleanup();
    render(<MetricCard label="DTI" value="16.7%" icon={TrendingUp} />);
    const short = screen.getByText('16.7%');

    expect(wide.className).not.toBe(short.className);
    expect(short.className).toContain('text-2xl');
    expect(wide.className).not.toContain('text-2xl');
  });

  it('pins the size steps, so a later edit cannot quietly widen them', () => {
    // Boundary pairs rather than midpoints: a step that moved by one character would still pass
    // a midpoint check, which is how a size ladder drifts without anything going red.
    expect(valueSizeClass('$560')).toBe('text-xl sm:text-2xl');       // 4
    expect(valueSizeClass('0.2 mo')).toBe('text-xl sm:text-2xl');     // 6 - Tre's runway tile
    expect(valueSizeClass('-$14,400')).toBe('text-lg sm:text-xl');    // 8
    expect(valueSizeClass('$1,234.56')).toBe('text-lg sm:text-xl');   // 9
    expect(valueSizeClass('$150,000.00')).toBe('text-base sm:text-lg'); // 11
    expect(valueSizeClass('$1,234,567.89')).toBe('text-sm sm:text-base'); // 13
  });

  it('never truncates it — an ellipsised number reads as a smaller number', () => {
    render(<MetricCard label="Goal" value={WIDE_POSITIVE} icon={TrendingUp} />);
    const value = screen.getByText(WIDE_POSITIVE);

    expect(value.className).not.toContain('truncate');
    expect(value.className).not.toContain('text-ellipsis');
  });

  it('contains its own contents, so nothing reaches the neighbouring tile', () => {
    const { container } = render(
      <MetricCard label="Net Worth" value={WIDE_NEGATIVE} icon={TrendingUp} />,
    );
    const card = container.firstElementChild as HTMLElement;

    // Scoped to this card on purpose. The card-forged utility also wraps panels holding
    // dropdowns and popovers that are meant to escape their box, and clipping those would
    // trade one visual bug for a worse one.
    expect(card.className).toContain('overflow-hidden');
  });

  it('still renders the value exactly as given, sign and separators included', () => {
    render(<MetricCard label="Net Worth" value={WIDE_NEGATIVE} icon={TrendingUp} />);
    // The whole point of refusing truncation: the number a user reads is the number passed in.
    expect(screen.getByText('-$14,400')).toBeTruthy();
  });
});
