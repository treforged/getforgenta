// @vitest-environment jsdom
//
// The guard has exactly two jobs and they pull against each other: a backdrop
// click must still close the modal, and a drag that merely ENDS on the backdrop
// must not. Both are asserted here, because a fix for one that breaks the other
// is worse than the bug -- a modal you cannot dismiss is more annoying than one
// that closes too eagerly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installModalDismissGuard } from '@/lib/modal-dismiss-guard';

let teardown: () => void;
let overlay: HTMLDivElement;
let card: HTMLDivElement;
let dismiss: ReturnType<typeof vi.fn<(e: Event) => void>>;

beforeEach(() => {
  document.body.innerHTML = '';
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay z-50';
  card = document.createElement('div');
  card.textContent = 'some text you might want to copy';
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  dismiss = vi.fn<(e: Event) => void>();
  overlay.addEventListener('click', dismiss);
  card.addEventListener('click', (e) => e.stopPropagation());
  teardown = installModalDismissGuard(document);
});

afterEach(() => {
  teardown();
  document.body.innerHTML = '';
});

/** What the browser actually does for a drag: pointerdown on one element, and a
 *  single click dispatched on the common ancestor of down and up. */
function gesture(downOn: Element, clickOn: Element): void {
  downOn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  clickOn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('modal dismiss guard', () => {
  it('closes on a real backdrop click', () => {
    gesture(overlay, overlay);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when a selection started inside and ended on the backdrop', () => {
    // The reported bug, in one line: down on the text, up on the scrim.
    gesture(card, overlay);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('still closes on the next genuine backdrop click after a selection', () => {
    // The gesture start must not stick around and suppress later dismissals.
    gesture(card, overlay);
    gesture(overlay, overlay);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves clicks that are not on an overlay entirely alone', () => {
    const plain = document.createElement('button');
    const clicked = vi.fn<(e: Event) => void>();
    plain.addEventListener('click', clicked);
    document.body.appendChild(plain);
    gesture(document.body, plain);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('installs once, however many times it is called', () => {
    const second = installModalDismissGuard(document);
    gesture(overlay, overlay);
    expect(dismiss).toHaveBeenCalledTimes(1);
    second();
  });
});
