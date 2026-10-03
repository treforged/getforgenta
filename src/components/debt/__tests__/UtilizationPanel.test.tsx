// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import UtilizationPanel from '../UtilizationPanel';
import type { OverallUtilization } from '@/lib/credit-utilization';

// Since 2026-10-03 the three breakdown figures live inside the summary tiles in CreditCardEngine
// (they never lined up as a strip of their own), so this panel carries only the two notes. What
// must hold: each note appears exactly when its fact is true, and with neither there is no empty
// divider left behind under the tiles.

afterEach(cleanup);

const base: OverallUtilization = {
  totalBalance: 4200,
  totalLimit: 7500,
  utilizationPct: 56,
  interestBearingBalance: 4200,
  utilizationOnlyBalance: 0,
  futureCards: [],
};

describe('UtilizationPanel', () => {
  it('renders nothing - not an empty divider - when neither note applies', () => {
    const { container } = render(<UtilizationPanel summary={base} />);
    expect(container.innerHTML).toBe('');
  });

  it('explains 0% plans only when a 0% balance exists', () => {
    render(<UtilizationPanel summary={{ ...base, utilizationOnlyBalance: 2417, interestBearingBalance: 1783 }} />);
    expect(screen.getByText(/0% plans lower utilization/)).toBeTruthy();
    expect(screen.queryByText(/Not counted yet/)).toBeNull();
  });

  it('names every card that opens later, with its limit and month', () => {
    render(<UtilizationPanel summary={{
      ...base,
      futureCards: [{ id: 'vx', name: 'Venture X', creditLimit: 10000, opensInMonths: 3 }],
    }} />);
    const note = screen.getByText(/Not counted yet/);
    expect(note.textContent).toBe('Not counted yet: Venture X ($10,000.00 limit, opens in 3 mo)');
    expect(screen.queryByText(/0% plans lower utilization/)).toBeNull();
  });
});
