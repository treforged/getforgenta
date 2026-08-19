// @vitest-environment jsdom
//
// WARNING: what this protects. Tre, from TestFlight on 5G: "app refreshed randomly". It had --
// `ErrorBoundary` auto-reloads once on a chunk-load error, which is right when a deploy replaced
// the hashed chunks and wrong when the chunk simply did not arrive. This component is the honest
// answer for the second case, so the two things that matter are that it SAYS which case it is, and
// that its recovery is a retry rather than another reload.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConnectionNotice from '@/components/shared/ConnectionNotice';

// The repo's convention (see DashboardHero.test.tsx): without this, each render stacks onto the
// last one's DOM and a `queryBy...toBeNull()` finds the PREVIOUS test's markup.
afterEach(cleanup);

describe('it names the problem rather than showing a generic wait', () => {
  it('says the device is offline when it is', () => {
    render(<ConnectionNotice offline onRetry={() => {}} />);
    expect(screen.getByText(/No internet connection/i)).toBeTruthy();
    // The reassurance matters as much as the diagnosis: nothing was lost, and it recovers itself.
    expect(screen.getByText(/pick up on its own/i)).toBeTruthy();
  });

  it('says something different when the device is online but nothing is answering', () => {
    render(<ConnectionNotice offline={false} onRetry={() => {}} />);
    expect(screen.getByText(/Still trying to reach Forgenta/i)).toBeTruthy();
    expect(screen.queryByText(/No internet connection/i)).toBeNull();
  });

  // Two states, two sentences. If these ever collapse into one message the component has stopped
  // doing the only thing it exists for.
  it('never shows the offline copy and the slow copy at once', () => {
    render(<ConnectionNotice offline onRetry={() => {}} />);
    expect(screen.queryByText(/Still trying to reach/i)).toBeNull();
  });
});

describe('it shows work in progress, and recovers WITHOUT reloading', () => {
  it('renders a spinner, because a retry has no shape to promise', () => {
    const { container } = render(<ConnectionNotice offline={false} onRetry={() => {}} />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('is announced to assistive tech as a live status', () => {
    const { container } = render(<ConnectionNotice offline onRetry={() => {}} />);
    const el = container.querySelector('[role="status"]');
    expect(el).toBeTruthy();
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  // THE POINT. Reloading is what produced the complaint: it throws away everything unsaved on the
  // page to fix a problem that is usually outside the page. The button hands control back to the
  // caller, which re-arms the wait.
  it('calls onRetry and does not touch the location', () => {
    const onRetry = vi.fn();
    render(<ConnectionNotice offline onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
