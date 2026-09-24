import { useEffect } from 'react';

/**
 * Tab stays inside the open popup.
 *
 * ONE LISTENER FOR THE WHOLE APP, not a ref per popup. Every modal here is marked
 * role="dialog"|"alertdialog" + aria-modal="true" (census: modal-dialog-role.gate.test.ts), so the
 * trap finds the open one by that marker instead of needing each of 18 panels wired to a ref.
 * Mounted once in App.
 *
 * - Tab on the last control goes to the first, Shift+Tab on the first goes to the last.
 * - Tab while focus is OUTSIDE the popup (the page behind it) moves focus into the popup.
 * - Radix dialogs trap focus themselves and preventDefault first, so a handled event is skipped.
 * - "Top" popup = the last one in document order, which is the most recently opened portal/overlay.
 *
 * FOCUS RETURNS TO THE OPENER. A MutationObserver diffs the set of open aria-modal dialogs. When
 * one appears, its opener is the most recently focused element OUTSIDE it (a short focus history,
 * because an autoFocus inside the popup may already have taken focus by the time the observer
 * runs). When it goes away, focus goes back to that opener - but only if the opener is still in
 * the page AND focus was dropped (body or a detached node). Focus the user moved on purpose is
 * left alone.
 *
 * FOCUS MOVES IN ON OPEN. When a popup appears and focus is still outside it, focus goes to the
 * popup ITSELF (tabindex=-1), not to its first control. A screen reader then announces the popup
 * by its label, and the next Tab reaches the first control. The container is chosen on purpose:
 * the first control of a delete confirmation can be the destructive button, and landing on it
 * makes one Enter press destroy data. An autoFocus inside the popup already moved focus in, and
 * that choice is left alone.
 * First draft by the free tier (qwen3:14b), rewritten by Ada 2026-09-23: the draft counted
 * tabindex=-1 as tabbable, missed Shift+Tab from the container, and needed a ref per panel.
 */

const MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    // tabIndex < 0 is checked on the element, because `button:not([disabled])` already matched a
    // tabindex="-1" button - the selector's own exclusion only applies to the [tabindex] arm.
    el => el.tabIndex >= 0 && !el.closest('[hidden], [aria-hidden="true"], [inert]'),
  );
}

export function topModal(doc: Document = document): HTMLElement | null {
  const all = doc.querySelectorAll<HTMLElement>(MODAL);
  return all.length ? all[all.length - 1] : null;
}

export function handleTrapKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.key !== 'Tab') return;
  const modal = topModal();
  if (!modal) return;
  const items = tabbablesIn(modal);
  const active = document.activeElement as HTMLElement | null;

  if (items.length === 0) {
    e.preventDefault();
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    modal.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const inside = !!active && modal.contains(active);

  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === modal)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || active === modal)) {
    e.preventDefault();
    first.focus();
  }
}

const HISTORY = 8;

/**
 * Return focus to each popup's opener when the popup closes. Returns the teardown.
 * Exported for tests; the app gets it through useModalFocusTrap.
 */
export function startFocusReturn(doc: Document = document): () => void {
  const history: HTMLElement[] = [];
  const openers = new Map<HTMLElement, HTMLElement>();
  let open = new Set<HTMLElement>(doc.querySelectorAll<HTMLElement>(MODAL));

  const onFocusIn = (e: FocusEvent) => {
    if (!(e.target instanceof HTMLElement)) return;
    history.push(e.target);
    if (history.length > HISTORY) history.shift();
  };

  const openerFor = (modal: HTMLElement): HTMLElement | null => {
    const active = doc.activeElement;
    const candidates = [...(active instanceof HTMLElement ? [active] : []), ...[...history].reverse()];
    return candidates.find(el => el !== doc.body && el.isConnected && !modal.contains(el)) ?? null;
  };

  const onMutate = () => {
    const now = new Set<HTMLElement>(doc.querySelectorAll<HTMLElement>(MODAL));
    for (const m of now) {
      if (open.has(m)) continue;
      const opener = openerFor(m);
      if (opener) openers.set(m, opener);
      const active = doc.activeElement;
      if (m === topModal(doc) && !(active instanceof HTMLElement && m.contains(active))) {
        if (!m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
        m.focus({ preventScroll: true });
      }
    }
    for (const m of open) {
      if (now.has(m)) continue;
      const opener = openers.get(m);
      openers.delete(m);
      const active = doc.activeElement;
      const dropped = !active || active === doc.body || !active.isConnected;
      if (opener && opener.isConnected && dropped) opener.focus();
    }
    open = now;
  };

  const observer = new MutationObserver(onMutate);
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal'] });
  doc.addEventListener('focusin', onFocusIn);
  return () => {
    observer.disconnect();
    doc.removeEventListener('focusin', onFocusIn);
  };
}

/** Mount once, near the root. */
export function useModalFocusTrap(): void {
  useEffect(() => {
    document.addEventListener('keydown', handleTrapKeyDown);
    const stopReturn = startFocusReturn();
    return () => {
      document.removeEventListener('keydown', handleTrapKeyDown);
      stopReturn();
    };
  }, []);
}
