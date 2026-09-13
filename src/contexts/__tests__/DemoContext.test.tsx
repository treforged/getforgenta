// @vitest-environment jsdom
//
// These pin the ONE behaviour that was measured broken in Chrome on 2026-09-13: demo mode
// did not survive a reload, so a signed-in visitor who refreshed was shown their real
// financial data under a header that looked the same. Nothing threw, so no existing gate
// saw it.
//
// A reload is modelled by UNMOUNTING the provider and mounting a fresh one — a remount is
// exactly what a reload does to React state, and it is the only part of a reload that this
// defect turns on. Asserting on the rendered flag rather than on sessionStorage directly is
// deliberate: reading back the key you just wrote proves the write, not the recovery.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DemoProvider, useDemo, DEMO_SESSION_KEY } from '../DemoContext';

function Probe() {
  const { isDemo, setIsDemo } = useDemo();
  return (
    <div>
      <span data-testid="flag">{isDemo ? 'DEMO' : 'REAL'}</span>
      <button onClick={() => setIsDemo(true)}>enter</button>
      <button onClick={() => setIsDemo(false)}>leave</button>
    </div>
  );
}

const flag = () => screen.getByTestId('flag').textContent;
const press = (label: string) => act(() => { screen.getByText(label).click(); });
const mount = () => render(<DemoProvider><Probe /></DemoProvider>);

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(cleanup);

describe('demo mode survives a reload', () => {
  it('starts off when nothing is stored', () => {
    mount();
    expect(flag()).toBe('REAL');
  });

  it('THE REGRESSION: a remount after entering the demo is still the demo', () => {
    mount();
    press('enter');
    expect(flag()).toBe('DEMO');

    cleanup();          // the reload
    mount();
    expect(flag()).toBe('DEMO');
  });

  it('leaving the demo survives a remount too, and clears the key rather than storing false', () => {
    mount();
    press('enter');
    press('leave');
    expect(flag()).toBe('REAL');
    // Absent and off are ONE state — a stored 'false' would be a third value to reason about.
    expect(window.sessionStorage.getItem(DEMO_SESSION_KEY)).toBeNull();

    cleanup();
    mount();
    expect(flag()).toBe('REAL');
  });

  it('only the exact string "true" is demo-on, so a stray value cannot enable it', () => {
    for (const junk of ['false', 'TRUE', '1', 'yes', '']) {
      window.sessionStorage.setItem(DEMO_SESSION_KEY, junk);
      mount();
      expect(flag(), `stored value ${JSON.stringify(junk)}`).toBe('REAL');
      cleanup();
    }
  });

  it('degrades to demo-off, and does not crash, when storage throws', () => {
    const proto = Object.getPrototypeOf(window.sessionStorage);
    const realGet = proto.getItem;
    const realSet = proto.setItem;
    proto.getItem = () => { throw new Error('blocked'); };
    proto.setItem = () => { throw new Error('blocked'); };
    try {
      mount();
      expect(flag()).toBe('REAL');
      // The visitor still gets the demo for this page view; it just will not survive a reload.
      press('enter');
      expect(flag()).toBe('DEMO');
    } finally {
      proto.getItem = realGet;
      proto.setItem = realSet;
    }
  });
});
