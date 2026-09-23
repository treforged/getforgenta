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
 * Does NOT restore focus to the opener when a popup closes, and does not move focus in on open.
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
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Mount once, near the root. */
export function useModalFocusTrap(): void {
  useEffect(() => {
    document.addEventListener('keydown', handleTrapKeyDown);
    return () => document.removeEventListener('keydown', handleTrapKeyDown);
  }, []);
}
