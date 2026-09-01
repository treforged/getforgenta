// A modal must not close because you highlighted text in it.
//
// THE BUG, reported 2026-09-01: "when highlighting in popups, sometimes the
// modal closes." Every overlay in this app is a `div.modal-overlay` with
// `onClick={dismiss}` and an inner card that calls `stopPropagation`. That
// stops CLICKS ON THE CARD, and it is not what happens when you drag-select:
// the pointer goes down on the text inside the card and up on the scrim, and
// the browser then dispatches a single `click` whose target is the nearest
// common ancestor of the two -- the overlay itself. The card's
// `stopPropagation` never runs, because the event was never dispatched to the
// card. The modal closes mid-selection, and the text you were copying goes with
// it.
//
// WHY THIS IS ONE GUARD AND NOT TWENTY EDITS. There are twenty files with a
// `modal-overlay` in them and about half wire `onClick={dismiss}` inline. Fixing
// them one at a time means missing one today and reintroducing it in the next
// modal somebody writes. This listens once, at the document, in the capture
// phase, and swallows exactly the events that are the bug: a click ON a scrim
// whose gesture did not START on that scrim. A genuine click on the backdrop
// still closes, which is the behaviour worth keeping.
//
// It is deliberately narrow. It only looks at elements carrying the
// `modal-overlay` class, it only acts when the pointerdown target differs, and
// it never touches anything else on the page.

const OVERLAY_CLASS = 'modal-overlay';

let installed = false;

/** Where the current gesture began. Read once per click and never held across
 *  gestures, so a stale target cannot suppress a later legitimate dismiss. */
let gestureStart: EventTarget | null = null;

function onPointerDown(event: Event): void {
  gestureStart = event.target;
}

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element) || !target.classList.contains(OVERLAY_CLASS)) return;
  // The gesture started on this same scrim: an ordinary backdrop click, which
  // is allowed to dismiss.
  if (gestureStart === target) return;
  // Anything else that lands on a scrim is a drag that began elsewhere, which
  // is a selection and not a dismissal.
  event.stopPropagation();
  event.preventDefault();
}

/** Idempotent, so a re-render or a second import cannot double-install. */
export function installModalDismissGuard(doc: Document = document): () => void {
  if (installed) return () => undefined;
  installed = true;
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('click', onClick, true);
    gestureStart = null;
    installed = false;
  };
}
