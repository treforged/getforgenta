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
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { DemoProvider, useDemo, DEMO_SESSION_KEY } from '../DemoContext';

// The platform is the whole discriminator here, so it is the one thing mocked.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false) } }));
const setPlatform = (native: boolean) => {
  (Capacitor.isNativePlatform as unknown as ReturnType<typeof vi.fn>).mockReturnValue(native);
};

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

beforeEach(() => { window.sessionStorage.clear(); setPlatform(false); });
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

/**
 * ⚠️ THE WEB BEHAVIOUR ABOVE IS CORRECT AND MUST NOT BE TRADED AWAY FOR THIS ONE.
 *
 * Tre, 2026-09-16, on iOS 862: *"there is a notice stating demo mode when i got in."* He opened
 * his own account and was shown Jordan's fixture data, because `isDemo` had been restored from a
 * previous launch. The persistence exists so a browser RELOAD does not drop a visitor out of the
 * demo, and it leans on sessionStorage having a TAB's lifetime - which the banner also promises
 * in words. A native app has no tab.
 *
 * SO THIS IS A DISCRIMINATING PAIR AND BOTH ARMS ARE LOAD-BEARING. Deleting the persistence
 * outright would pass the native arm and silently restore the 2026-09-13 defect, which is why
 * the web arm is asserted in the same block rather than left to the suite above.
 *
 * ⚠️ WHAT THIS CANNOT PROVE: whether iOS actually keeps sessionStorage across a launch. This
 * desk has no device, so that remains a hypothesis - and the fix is written so it does not
 * matter, because refusing to restore is right either way. What IS proven here is that the app
 * cannot OPEN in demo on native, which is the property a money app needs.
 */
describe('a native app never OPENS in demo', () => {
  it('THE REGRESSION: a stored flag does not put a native launch into the demo', () => {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, 'true');
    setPlatform(true);
    mount();
    expect(flag()).toBe('REAL');
  });

  it('and it clears the stale key, so storage and memory agree', () => {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, 'true');
    setPlatform(true);
    mount();
    expect(window.sessionStorage.getItem(DEMO_SESSION_KEY)).toBeNull();
  });

  it('THE CONTROL: the same stored flag DOES restore on the web', () => {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, 'true');
    setPlatform(false);
    mount();
    expect(flag()).toBe('DEMO');
  });

  it('entering the demo still works on native - it just cannot be where you arrive', () => {
    setPlatform(true);
    mount();
    expect(flag()).toBe('REAL');
    press('enter');
    expect(flag()).toBe('DEMO');
  });
});
