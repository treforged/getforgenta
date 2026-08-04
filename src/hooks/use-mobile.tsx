import * as React from "react";

const MOBILE_BREAKPOINT = 768;

// No window during prerender. Returns false, which is exactly what the old
// state-based hooks returned on their first render (`!!undefined`).
const getServerSnapshot = () => false;

function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * True while the viewport is narrower than `breakpoint` px.
 *
 * Reads the breakpoint through useSyncExternalStore instead of state plus a
 * mount effect. A media query is an external store, which is precisely what
 * that hook exists for: the correct value is available on the first render
 * rather than one commit later, so mobile stops painting a single
 * desktop-layout frame before correcting itself.
 *
 * Prefer this over reading `window.innerWidth` in a render body — a bare read
 * is not subscribed to anything, so the value goes stale the moment the user
 * resizes or rotates the device and nothing re-renders to correct it.
 */
export function useIsViewportBelow(breakpoint: number) {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px)`);
}

/** True while the viewport is narrower than the 768px layout breakpoint. */
export function useIsMobile() {
  return useIsViewportBelow(MOBILE_BREAKPOINT);
}

/**
 * True on devices with no hover-capable pointer.
 *
 * This is a *capability* test, not a size test, and the two are not
 * interchangeable: a narrow desktop window still has a mouse, and a large
 * tablet still does not. Use this to gate hover- and drag-dependent
 * interactions; use `useIsViewportBelow` for layout.
 */
export function useIsTouch() {
  return useMediaQuery("(hover: none)");
}
