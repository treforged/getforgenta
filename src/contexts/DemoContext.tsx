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

export const DEMO_SESSION_KEY = 'forged:demo_session';

type DemoContextType = {
  isDemo: boolean;
  setIsDemo: (v: boolean) => void;
};

const DemoContext = createContext<DemoContextType>({
  isDemo: false,
  setIsDemo: () => {},
});

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem(DEMO_SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Stable identity: App.tsx's DemoEntry calls this inside a useEffect whose dependency
  // array contains it, and an unstable identity would re-run that effect every render.
  const setDemo = useCallback((v: boolean) => {
    try {
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
  }, []);

  return (
    <DemoContext.Provider value={{ isDemo, setIsDemo: setDemo }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextType {
  return useContext(DemoContext);
}
