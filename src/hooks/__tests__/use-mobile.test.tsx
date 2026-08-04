// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsViewportBelow, useIsMobile, useIsTouch } from '../use-mobile';

// These hooks exist because four call sites used to read `window.innerWidth`
// straight out of a render body. A bare read is subscribed to nothing, so the
// value went stale the moment the viewport changed and nothing re-rendered to
// correct it. The re-render-on-change test below is the one that pins that fix.

interface FakeQuery {
  matches: boolean;
  listeners: Set<() => void>;
  removed: number;
}

const queries = new Map<string, FakeQuery>();

function queryFor(query: string): FakeQuery {
  let q = queries.get(query);
  if (!q) {
    q = { matches: false, listeners: new Set(), removed: 0 };
    queries.set(query, q);
  }
  return q;
}

/** Flip a query's result and notify subscribers, the way a real resize would. */
function setMatches(query: string, matches: boolean) {
  const q = queryFor(query);
  q.matches = matches;
  act(() => {
    q.listeners.forEach(fn => fn());
  });
}

beforeEach(() => {
  queries.clear();
  vi.stubGlobal('matchMedia', (query: string) => {
    const q = queryFor(query);
    return {
      get matches() {
        return q.matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => q.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => {
        q.listeners.delete(fn);
        q.removed += 1;
      },
    };
  });
});

describe('useIsViewportBelow', () => {
  it('asks for a max-width query one pixel below the breakpoint', () => {
    renderHook(() => useIsViewportBelow(640));
    expect([...queries.keys()]).toEqual(['(max-width: 639px)']);
  });

  it('reports the current match on the FIRST render, not one commit later', () => {
    queryFor('(max-width: 639px)').matches = true;
    const { result } = renderHook(() => useIsViewportBelow(640));
    // A state+useEffect implementation would return false here and only correct
    // itself after mount, painting one wrong frame.
    expect(result.current).toBe(true);
  });

  it('re-renders when the viewport crosses the breakpoint', () => {
    const { result } = renderHook(() => useIsViewportBelow(640));
    expect(result.current).toBe(false);

    setMatches('(max-width: 639px)', true);
    expect(result.current).toBe(true);

    setMatches('(max-width: 639px)', false);
    expect(result.current).toBe(false);
  });

  it('keeps separate breakpoints independent', () => {
    const { result: small } = renderHook(() => useIsViewportBelow(640));
    const { result: large } = renderHook(() => useIsViewportBelow(768));

    setMatches('(max-width: 639px)', true);

    expect(small.current).toBe(true);
    expect(large.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useIsViewportBelow(640));
    expect(queryFor('(max-width: 639px)').listeners.size).toBe(1);

    unmount();

    expect(queryFor('(max-width: 639px)').listeners.size).toBe(0);
    expect(queryFor('(max-width: 639px)').removed).toBeGreaterThan(0);
  });
});

describe('useIsMobile', () => {
  it('defaults to the 768px layout breakpoint', () => {
    renderHook(() => useIsMobile());
    expect([...queries.keys()]).toEqual(['(max-width: 767px)']);
  });
});

describe('useIsTouch', () => {
  it('tests pointer capability, NOT viewport width', () => {
    renderHook(() => useIsTouch());
    // Builds.tsx gates drag-and-drop on this. A narrow desktop window still has
    // a mouse and must keep drag-and-drop, so this must never become a width
    // query — that swap is exactly the regression this assertion blocks.
    expect([...queries.keys()]).toEqual(['(hover: none)']);
  });

  it('re-renders when a hover-capable pointer appears or disappears', () => {
    const { result } = renderHook(() => useIsTouch());
    expect(result.current).toBe(false);

    setMatches('(hover: none)', true);

    expect(result.current).toBe(true);
  });
});
