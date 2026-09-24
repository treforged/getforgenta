/**
 * Demo mode, and why it is persisted rather than held in memory.
 *
 * ⚠️ MEASURED IN CHROME 2026-09-13, not reasoned. `isDemo` was a plain `useState`, so a
 * page reload dropped the visitor out of the demo silently. `/demo` redirects to
 * `/dashboard`, so the URL does not carry the demo either and refreshing cannot get back
 * to it. A signed-in visitor was then shown their REAL financial data under a visually
 * identical header — same layout, same headings, different numbers — with the DEMO banner
 * and its "Back to my account" way out both gone. Nothing threw, so no gate saw it.
 *
 * sessionStorage and NOT localStorage: the banner already tells the user "All data is
 * fictional and resets when you close the tab." sessionStorage has exactly that lifetime,
 * so this makes existing copy true rather than changing the promise. localStorage would
 * outlive the tab and break it.
 *
 * Every read and write is wrapped: private mode and blocked site data make these THROW,
 * and a throw must degrade to demo-off rather than crash the provider. A write that throws
 * still turns demo on in memory — the visitor gets the demo they asked for, it just will
 * not survive their next reload, which is strictly better than refusing to show it.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

export const DEMO_SESSION_KEY = 'forged:demo_session';
/**
 * SCREENSHOT CAPTURE MODE - `/demo?capture=1`. Tre, 2026-09-23 via Ruby: the App Store shots must look
 * like a normal user's feed, not carry the demo's long guide cards. Capture mode hides ONLY those
 * guide cards (`showDemoGuides`); the fixture data and everything else is the demo as visitors see
 * it. Plain `/demo` is unchanged. Tab-scoped like the demo itself, never restored on native, and
 * cleared whenever the demo is left.
 */
export const DEMO_CAPTURE_KEY = 'forged:demo_capture';

type DemoContextType = {
  isDemo: boolean;
  /** Pass `{ capture: true }` only from `/demo?capture=1`. */
  setIsDemo: (v: boolean, opts?: { capture?: boolean }) => void;
  /** The demo's orientation/guide cards render only when this is true. */
  showDemoGuides: boolean;
  /**
   * `/demo?capture=1` is active. Store frames also drop the bottom tab bar and the demo banner
   * (ask b3573355, Ruby 2026-09-24: the bar in every frame made the shots read as dense, and a
   * "demo" strip is not what a store visitor should see). Only the capture URL turns this on.
   */
  isCapture: boolean;
};

const DemoContext = createContext<DemoContextType>({
  isDemo: false,
  setIsDemo: () => {},
  showDemoGuides: false,
  isCapture: false,
});

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    try {
      // ⚠️ NEVER RESTORED ON NATIVE - Tre, 2026-09-16, on iOS 862: *"there is a notice stating
      // demo mode when i got in."* He was opening his own account and was shown Jordan's
      // fixture data, because `isDemo` had been restored from a previous launch.
      //
      // THE PERSISTENCE ABOVE IS CORRECT ON THE WEB AND HAS NO MEANING HERE. It exists so a
      // browser RELOAD does not drop a visitor out of the demo, and it leans on sessionStorage
      // having exactly a tab's lifetime - which is also what the banner promises in words:
      // "resets when you close the tab." **A native app has no tab.** Its WKWebView is not
      // closed and reopened the way a tab is, so a flag written once can greet the user on a
      // later launch, and the copy that explains it is false there.
      //
      // ⚠️ THIS FIX DOES NOT DEPEND ON KNOWING EXACTLY HOW LONG iOS KEEPS sessionStorage, and
      // that is deliberate: this desk cannot run the device, so the lifetime is a hypothesis.
      // Refusing to restore is correct under BOTH readings - if the value never survives, this
      // is a no-op; if it does, it is the fix. The `removeItem` is belt and braces, idempotent,
      // and makes the state on disk match the state in memory.
      //
      // Entering the demo still works on native; it simply cannot be the state you ARRIVE in.
      // A money app must never open on somebody else's numbers.
      if (Capacitor.isNativePlatform()) {
        try { window.sessionStorage.removeItem(DEMO_SESSION_KEY); } catch { /* storage gone */ }
        return false;
      }
      return window.sessionStorage.getItem(DEMO_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [capture, setCapture] = useState<boolean>(() => {
    try {
      if (Capacitor.isNativePlatform()) return false;
      return window.sessionStorage.getItem(DEMO_CAPTURE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Stable identity: App.tsx's DemoEntry calls this inside a useEffect whose dependency
  // array contains it, and an unstable identity would re-run that effect every render.
  const setDemo = useCallback((v: boolean, opts?: { capture?: boolean }) => {
    const nextCapture = v && opts?.capture === true;
    try {
      if (nextCapture) window.sessionStorage.setItem(DEMO_CAPTURE_KEY, 'true');
      else if (!v || opts) window.sessionStorage.removeItem(DEMO_CAPTURE_KEY);
      if (v) {
        window.sessionStorage.setItem(DEMO_SESSION_KEY, 'true');
      } else {
        // Removed, never written as 'false' — absent and off must be ONE state, so there
        // is only one way to be off and no third value to reason about on read.
        window.sessionStorage.removeItem(DEMO_SESSION_KEY);
      }
    } catch {
      // Storage unavailable. Demo still turns on for this page view; it will not survive
      // a reload, which is the honest degradation.
    }
    setIsDemo(v);
    // Leaving the demo always ends capture; entering with explicit opts sets it either way; a bare
    // setIsDemo(true) (e.g. a reload path) keeps whatever the tab already had.
    if (!v || opts) setCapture(nextCapture);
  }, []);

  return (
    <DemoContext.Provider value={{ isDemo, setIsDemo: setDemo, showDemoGuides: isDemo && !capture, isCapture: isDemo && capture }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextType {
  return useContext(DemoContext);
}
