import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

/**
 * Escape closes the TOP modal, and only the top one.
 *
 * WHY A MODULE-LEVEL STACK. A modal can open another modal (a form inside a panel, a confirm inside
 * a form). If every open modal listened for Escape on its own, one key press would close all of
 * them at once and throw away the form underneath. So every modal registers here, the most recently
 * enabled one sits on top, and one document listener calls only that one.
 *
 * Drafted by the free tier (qwen3), reviewed and trimmed by Ada 2026-09-23: the handler's
 * try/catch-and-log was dropped, because a close handler that throws is a real bug and should
 * surface, not become a console line nobody reads.
 */

const escapeStack: Array<MutableRefObject<() => void>> = [];
let listenerAttached = false;

function handleKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.key !== 'Escape') return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current();
}

function syncListener(): void {
  if (escapeStack.length > 0 && !listenerAttached) {
    document.addEventListener('keydown', handleKeyDown);
    listenerAttached = true;
  } else if (escapeStack.length === 0 && listenerAttached) {
    document.removeEventListener('keydown', handleKeyDown);
    listenerAttached = false;
  }
}

/** Call `onClose` when Escape is pressed and this is the top-most enabled modal. */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  const handlerRef = useRef(onClose);
  // Latest handler without re-registering, so the stack order stays the mount order. Written in a
  // layout effect, never during render, so it is current before any key event can reach it.
  useLayoutEffect(() => {
    handlerRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    escapeStack.push(handlerRef);
    syncListener();
    return () => {
      const idx = escapeStack.indexOf(handlerRef);
      if (idx !== -1) escapeStack.splice(idx, 1);
      syncListener();
    };
  }, [enabled]);
}

/** Test-only: how many modals are registered. */
export function __escapeStackSize(): number {
  return escapeStack.length;
}
