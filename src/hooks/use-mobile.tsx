import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;

// No window during prerender. Returns false, which is exactly what the old
// state-based hook returned on its first render (`!!undefined`).
const getServerSnapshot = () => false;

/**
 * Reads the viewport breakpoint through useSyncExternalStore instead of state
 * plus a mount effect. A media query is an external store, which is precisely
 * what this hook exists for: the correct value is available on the first
 * render rather than one commit later, so mobile stops painting a single
 * desktop-layout frame before correcting itself.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
