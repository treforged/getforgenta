// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShortfallLevers from '@/components/forecast/ShortfallLevers';
import type { BreachLeverReport } from '@/lib/breach-levers';

const SHORT = [{ month: 'Nov 2026', shortfall: 1698 }, { month: 'Dec 2026', shortfall: 1567 }];

const REPORT: BreachLeverReport = {
  months: SHORT,
  totalShortfall: 3265,
  excluded: [{ name: '401K Roth', reason: 'retirement' }],
  levers: [
    { kind: 'pause_transfer', id: 'r1', name: 'Owners Contribution', monthlyAmount: 145, coveredDollars: 2649,
      shortfallAfter: 616, monthsCleared: ['Aug 2027'], paysRules: ['Claude', 'QUO'] },
    { kind: 'pause_goal', id: 'g1', name: 'Move fund', monthlyAmount: 510, coveredDollars: 1190,
      shortfallAfter: 2075, monthsCleared: [], paysRules: [] },
  ],
};

describe('ShortfallLevers', () => {
  it('renders nothing when no month is short', () => {
    const { container } = render(<ShortfallLevers shortMonths={[]} compute={() => REPORT} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not run the engine until the tap, then shows the ranked moves', async () => {
    const compute = vi.fn(() => REPORT);
    render(<ShortfallLevers shortMonths={SHORT} compute={compute} />);
    expect(screen.getByText(/2 months in the next year end below your cash floor, \$3,265\.00 short/)).toBeTruthy();
    expect(compute).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: /moves that would cover/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /what would cover this/i }));
    const list = await screen.findByRole('list', { name: /moves that would cover/i });
    expect(compute).toHaveBeenCalledTimes(1);
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Pause Owners Contribution ($145.00/mo) covers $2,649.00, and clears Aug 2027.');
    expect(items[0].textContent).toContain('That account still pays Claude and QUO');
    expect(items[1].textContent).toContain('Pause saving to Move fund ($510.00/mo) covers $1,190.');
    expect(screen.queryByRole('button', { name: /what would cover this/i })).toBeNull();
    expect(screen.queryByText(/401K/)).toBeNull();
  });

  it('agrees its verb with a single month', () => {
    render(<ShortfallLevers shortMonths={[SHORT[0]]} compute={() => REPORT} />);
    expect(screen.getByText(/1 month in the next year ends below your cash floor, \$1,698\.00 short/)).toBeTruthy();
  });

  it('says so plainly when no single move closes the gap', async () => {
    render(<ShortfallLevers shortMonths={SHORT} compute={() => ({ ...REPORT, levers: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /what would cover this/i }));
    expect(await screen.findByText(/None of your savings goals or transfers would close this gap/)).toBeTruthy();
  });

  it('reports a failure instead of hanging on "Working it out"', async () => {
    render(<ShortfallLevers shortMonths={SHORT} compute={() => { throw new Error('boom'); }} />);
    fireEvent.click(screen.getByRole('button', { name: /what would cover this/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be worked out/));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
