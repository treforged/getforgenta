// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { ErrorBoundaryInner } from '../ErrorBoundary';

// The bug this pins: "Try again" used to reset only the boundary's own state,
// then re-render the same children over the same crashed state — so clicking
// it did nothing, while a full page reload always worked. Retry must now
// reset the query cache, remount the children, and escalate to a reload when
// a retry has already failed once.

// A child controlled by a module flag rather than a counter, because React
// retries a throwing render internally an implementation-defined number of
// times — a counter makes the test depend on that number, a flag does not.
let shouldCrash = false;
function FlakyChild() {
  if (shouldCrash) throw new Error('render crash');
  return <div>recovered content</div>;
}

function renderBoundary(reload: () => void, queryClient: QueryClient) {
  return render(
    <ErrorBoundaryInner queryClient={queryClient} reload={reload}>
      <FlakyChild />
    </ErrorBoundaryInner>
  );
}

describe('ErrorBoundary retry', () => {
  let queryClient: QueryClient;
  let reload: Mock<() => void>;

  beforeEach(() => {
    queryClient = new QueryClient();
    reload = vi.fn<() => void>();
    shouldCrash = false;
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    renderBoundary(reload, queryClient);
    expect(screen.getByText('recovered content')).toBeTruthy();
  });

  it('recovers via Try again when the crash was transient, resetting the query cache', () => {
    const resetSpy = vi.spyOn(queryClient, 'resetQueries');
    shouldCrash = true;
    renderBoundary(reload, queryClient);

    expect(screen.getByText('Try again')).toBeTruthy();
    shouldCrash = false;
    fireEvent.click(screen.getByText('Try again'));

    expect(screen.getByText('recovered content')).toBeTruthy();
    expect(resetSpy).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('escalates to a full reload when a retry crashes again', () => {
    shouldCrash = true;
    renderBoundary(reload, queryClient);

    fireEvent.click(screen.getByText('Try again'));

    // The retry crashed too; the button must now be honest about what it does.
    const reloadButton = screen.getByText('Reload page');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(reloadButton);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('re-arms the soft retry after a successful recovery', () => {
    shouldCrash = true;
    const view = renderBoundary(reload, queryClient);
    shouldCrash = false;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('recovered content')).toBeTruthy();

    // A later, unrelated crash in the SAME boundary starts from "Try again",
    // not "Reload page" — the pending flag was cleared by the clean render.
    shouldCrash = true;
    view.rerender(
      <ErrorBoundaryInner queryClient={queryClient} reload={reload}>
        <FlakyChild />
      </ErrorBoundaryInner>
    );
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });
});
