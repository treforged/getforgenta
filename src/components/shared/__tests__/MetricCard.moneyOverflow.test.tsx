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
// The decision they lock is the one that matters: the value WRAPS, it is never truncated. A
// number that runs onto a second line is ugly and legible; a clipped or ellipsised one reads as
// a smaller number, and on a finance screen that is not a cosmetic problem.
//
// Would-fail checks: put `whitespace-nowrap` back and the wrap case fails; "fix" it with
// `truncate` instead and the no-ellipsis case fails, which is the tempting wrong answer.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TrendingUp } from 'lucide-react';
import MetricCard from '@/components/shared/MetricCard';

/** Eight characters plus a sign — the length measured as overflowing at 375px. */
const WIDE_NEGATIVE = '-$14,400';
const WIDE_POSITIVE = '$150,000';

describe('MetricCard money values', () => {
  afterEach(cleanup);

  it('lets a wide value WRAP rather than run past its card', () => {
    render(<MetricCard label="Net Worth" value={WIDE_NEGATIVE} icon={TrendingUp} />);
    const value = screen.getByText(WIDE_NEGATIVE);

    expect(value.className).not.toContain('whitespace-nowrap');
    expect(value.className).toContain('break-words');
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
