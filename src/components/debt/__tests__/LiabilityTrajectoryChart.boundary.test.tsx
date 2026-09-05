// @vitest-environment jsdom
//
// ONE BROKEN CHART MUST NOT BLANK THE WHOLE /debt PAGE.
//
// Found 2026-09-05 while fixing the mobile tap on the same component: only the Credit Card
// Engine tab was inside an ErrorBoundary. The other four LiabilityTrajectoryChart usages in
// DebtPayoff.tsx (:480, :537, :647, :718) were bare, so a throw in any one of them — a
// malformed debt row, a recharts version that dislikes an input, an undefined balance — takes
// the entire page down instead of one widget. The person it happens to is looking at their
// debt, and what they see is nothing at all.
//
// This presses the actual mechanism rather than reading the JSX: it renders a chart that
// throws, inside the same boundary the page now uses, alongside sibling content, and asserts
// the siblings survive and the fallback names WHICH widget failed.
//
// Would-fail check: remove the ErrorBoundary wrapper and the first case fails — React unmounts
// the whole tree on an unhandled render error, so the sibling text disappears with it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

/** Stands in for a chart whose render throws — the failure mode being contained. */
function ExplodingChart(): never {
  throw new Error('recharts blew up on a malformed series');
}

function renderPageLike() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <div>
        <h1>Student Loans</h1>
        <ErrorBoundary variant="widget" label="Student Loan Trajectory">
          <ExplodingChart />
        </ErrorBoundary>
        <p>Nelnet balance $8,000</p>
      </div>
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a throwing trajectory chart is contained to its own widget', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('leaves the rest of the page rendered', () => {
    // React logs the caught error; silence it so a passing run is not full of red.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPageLike();

    // The two things either side of the broken chart are still there. Without the boundary
    // React unmounts the whole tree and both of these disappear.
    expect(screen.getByText('Student Loans')).toBeTruthy();
    expect(screen.getByText('Nelnet balance $8,000')).toBeTruthy();
  });

  it('says WHICH widget failed, so the fallback is not an anonymous shrug', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPageLike();

    // The label is the whole point of passing one: four charts on this page look alike, and a
    // fallback that does not name itself sends the user to the wrong place.
    expect(screen.getByText(/Student Loan Trajectory/i)).toBeTruthy();
  });
});
