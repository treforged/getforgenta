// @vitest-environment jsdom
//
// ⚠️ READ THIS BEFORE TRUSTING A GREEN RUN HERE.
//
// An earlier version of this feature passed EIGHT tests in this harness and failed in Chrome
// three times running, and was reverted rather than shipped. jsdom reports `scrollHeight` and
// `clientHeight` as **0** and does **not clamp** `scrollTop`, so a naive test passes against every
// one of the real failures at once — the wrong scroll target, a silent clamp, a restore that fires
// before the data arrives, an rAF that never runs, and a save that reads a stale offset.
//
// So this file MODELS THE GEOMETRY on purpose. `makeScroller` below defines `scrollHeight`,
// `clientHeight` and a `scrollTop` setter that CLAMPS the way a browser does. Every assertion that
// matters is about a number that only exists because the model provides it. Do not "simplify" it
// back to a plain div — that is precisely how the eight green tests were bought.
//
// It is still not a substitute for a browser. The behaviour was verified in Chrome on the demo
// dashboard before it shipped: a real wheel gesture to 800, a PUSH to /transactions landing at 0,
// and a `history.back()` restoring exactly 800. The measurements quoted in the comments below all
// come from that session.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import { useEffect } from 'react';

import { useScrollRestoration, clearScrollPositions, SCROLLER_ID } from '@/hooks/useScrollRestoration';

/**
 * A scroller that behaves like a browser's, which jsdom's does not.
 *
 * `contentHeight` is mutable so a test can reproduce the case that broke the first attempt: the
 * page is short while its queries are in flight and only reaches full height afterwards.
 */
function makeScroller(contentHeight: number, viewport = 545) {
  const el = document.createElement('main');
  el.id = SCROLLER_ID;
  const state = { top: 0, content: contentHeight };

  Object.defineProperty(el, 'scrollHeight', { get: () => state.content, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => viewport, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => state.top,
    // ⚠️ THE CLAMP IS THE POINT. Assign 800 to a container that is only 600px tall and a browser
    // gives you back its maximum, with no error and no way to tell the write failed.
    set: (v: number) => { state.top = Math.max(0, Math.min(v, Math.max(0, state.content - viewport))); },
    configurable: true,
  });

  document.body.appendChild(el);
  return {
    el,
    /** What a real wheel gesture does: move, and fire the event that a bare assignment does not. */
    gestureTo(v: number) {
      el.scrollTop = v;
      el.dispatchEvent(new Event('scroll'));
    },
    /** Content arriving after the route mounted. */
    grow(to: number) { state.content = to; },
    /** Content tearing down as the outgoing route unmounts — this is what clamps the live read. */
    collapse(to: number) {
      state.content = to;
      el.scrollTop = state.top; // re-run the clamp, exactly as a browser does
    },
    get top() { return state.top; },
  };
}

function Page({ label }: { label: string }) {
  useScrollRestoration();
  return <div data-testid={`page-${label}`}>{label}</div>;
}

/** Drives navigation from inside the router, so `useNavigationType` reports real PUSH/POP. */
let nav: ReturnType<typeof useNavigate> | null = null;
function CaptureNav() {
  const n = useNavigate();
  useEffect(() => { nav = n; }, [n]);
  return null;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <CaptureNav />
      <Routes>
        <Route path="/dashboard" element={<Page label="dashboard" />} />
        <Route path="/transactions" element={<Page label="transactions" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useScrollRestoration', () => {
  let scroller: ReturnType<typeof makeScroller>;
  let rafQueue: FrameRequestCallback[];

  beforeEach(() => {
    clearScrollPositions();
    scroller = makeScroller(2517);
    rafQueue = [];
    // Run frames on demand rather than on a timer, so a test can assert what happens BETWEEN them.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    nav = null;
  });

  const flushFrames = (n = 6) => {
    for (let i = 0; i < n; i++) {
      const queued = rafQueue;
      rafQueue = [];
      queued.forEach(cb => cb(performance.now()));
    }
  };

  it('puts the reader back where they were after a Back', async () => {
    renderApp();
    scroller.gestureTo(800);
    expect(scroller.top).toBe(800);

    await act(async () => { nav!('/transactions'); });
    // A new route starts at the top; nothing in this hook moves it.
    expect(scroller.top).toBe(800); // the element is shared; the app's ScrollToTop owns the reset

    scroller.el.scrollTop = 0;
    await act(async () => { nav!(-1); });
    await act(async () => { flushFrames(); });

    expect(scroller.top).toBe(800);
  });

  it('does NOT restore on a PUSH — a page you have never seen opens at the top', async () => {
    renderApp();
    scroller.gestureTo(800);

    await act(async () => { nav!('/transactions'); });
    scroller.el.scrollTop = 0;
    // Forward to a route that HAS a stored offset, but by PUSH rather than POP.
    await act(async () => { nav!('/dashboard'); });
    await act(async () => { flushFrames(); });

    expect(scroller.top).toBe(0);
  });

  it('waits for the page to be tall enough instead of restoring into a clamp', async () => {
    renderApp();
    scroller.gestureTo(800);
    await act(async () => { nav!('/transactions'); });
    scroller.el.scrollTop = 0;

    // Back to a dashboard whose queries have not resolved: 600px of content cannot hold 800.
    scroller.grow(600);
    await act(async () => { nav!(-1); });
    await act(async () => { flushFrames(3); });
    // ⚠️ THIS is the assertion the un-modelled harness could not make. A browser clamps to 55
    // here and reports no error; the hook must not have written at all.
    expect(scroller.top).toBe(0);

    scroller.grow(2517);
    await act(async () => { flushFrames(); });
    expect(scroller.top).toBe(800);
  });

  it('gives up honestly when the page is genuinely shorter than it was', async () => {
    vi.useFakeTimers();
    try {
      renderApp();
      scroller.gestureTo(800);
      await act(async () => { nav!('/transactions'); });
      scroller.el.scrollTop = 0;

      scroller.grow(700); // a filter that now returns three rows: it will never be 2517 again
      await act(async () => { nav!(-1); });
      await act(async () => { flushFrames(4); });
      vi.advanceTimersByTime(2000);
      await act(async () => { flushFrames(4); });

      // Not scrolled to a maximum that is not where they were. The top is the honest outcome.
      expect(scroller.top).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves the gesture offset when the DOM has already collapsed under it', async () => {
    // ⚠️ THE BUG THIS PINS WAS MEASURED IN CHROME, NOT IMAGINED. On leaving the dashboard at 800,
    // `el.scrollTop` inside the cleanup read **10** — the outgoing content shrinks and the browser
    // clamps before the cleanup runs. A save that trusted the live read stored 10 and returned the
    // reader to the top of the ledger, with every test green.
    renderApp();
    scroller.gestureTo(800);

    await act(async () => {
      scroller.collapse(555); // 555 - 545 viewport = a maximum of 10. Exactly what Chrome reported.
      expect(scroller.top).toBe(10);
      nav!('/transactions');
    });

    scroller.grow(2517);
    scroller.el.scrollTop = 0;
    await act(async () => { nav!(-1); });
    await act(async () => { flushFrames(); });

    expect(scroller.top).toBe(800);
  });

  it('keeps each route+query its own offset, because a filtered list is a different list', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard?tab=goals']}>
        <CaptureNav />
        <Routes>
          <Route path="/dashboard" element={<Page label="dashboard" />} />
          <Route path="/transactions" element={<Page label="transactions" />} />
        </Routes>
      </MemoryRouter>,
    );
    // ⚠️ THIS ORDERING IS DELIBERATE AND THE OBVIOUS ONE DOES NOT WORK. Storing goals, then
    // cards, then going back to CARDS passes whether or not the key includes the query string —
    // the second write simply overwrites the first and both readings return the same number.
    // Mutation-checked: dropping `location.search` from the key left that version green.
    // Going back to GOALS is what discriminates, because a search-blind key has by then
    // overwritten 800 with the 200 belonging to a different tab.
    scroller.gestureTo(800);
    await act(async () => { nav!('/dashboard?tab=cards'); });
    scroller.el.scrollTop = 0;
    scroller.gestureTo(200);

    await act(async () => { nav!(-1); });
    await act(async () => { flushFrames(); });

    // Back on ?tab=goals, which is 800 — not the 200 belonging to ?tab=cards.
    expect(scroller.top).toBe(800);
  });

  it('does nothing at all when the layout has no scroller, rather than throwing', async () => {
    document.body.innerHTML = '';
    expect(() => renderApp()).not.toThrow();
  });
});
