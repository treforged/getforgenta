// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ShortMonthsNotice from '@/components/dashboard/ShortMonthsNotice';

const SHORT = [{ month: 'Nov 2026', shortfall: 1698 }, { month: 'Dec 2026', shortfall: 1567 }, { month: 'Mar 2027', shortfall: 962 }];

function Harness({ month, initial = '' }: { month: string; initial?: string }) {
  const [dismissed, setDismissed] = useState(initial);
  return (
    <MemoryRouter>
      <ShortMonthsNotice shortMonths={SHORT} currentMonth={month} dismissedMonth={dismissed} onDismiss={setDismissed} />
    </MemoryRouter>
  );
}

describe('ShortMonthsNotice', () => {
  it('names the first short month, counts the rest, and links to the Forecast card', () => {
    render(<Harness month="2026-09" />);
    expect(screen.getByRole('status').textContent)
      .toContain('Nov 2026 ends $1,698 below your cash floor, and 2 more months in the next year.');
    expect(screen.getByRole('link', { name: 'See what would cover it' }).getAttribute('href'))
      .toBe('/transactions?tab=forecast');
  });

  it('hides for the month when dismissed', () => {
    render(<Harness month="2026-09" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide for this month' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('comes back in a new month if the shortfall is still there', () => {
    render(<Harness month="2026-10" initial="2026-09" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders nothing when no month is short', () => {
    const { container } = render(
      <MemoryRouter><ShortMonthsNotice shortMonths={[]} currentMonth="2026-09" dismissedMonth="" onDismiss={() => {}} /></MemoryRouter>,
    );
    expect(container.textContent).toBe('');
  });
});
