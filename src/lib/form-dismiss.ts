/**
 * What a tap outside an open edit form should do.
 *
 * Tre, 2026-08-18: *"if someone taps outside of an edit box, it auto closes the input pop
 * up, make it so it saves their inputs."*
 *
 * ## Why this is not simply "always save"
 *
 * Three things have to be true at once, and only one rule satisfies all three:
 *
 * 1. **Typed work is never thrown away.** That is the whole complaint — the old behaviour
 *    discarded a filled-in form on a stray tap.
 * 2. **A half-filled form is never written.** This is a financial app; committing a plan
 *    with no name or a zero amount because someone's thumb landed on the backdrop is a
 *    worse outcome than the bug being fixed. So "save" here means *run the form's real
 *    save handler*, which validates and refuses — the popup then stays open with the
 *    reason, which is the same thing the Save button would have done.
 * 3. **An untouched form still closes.** Someone who opens a form, changes nothing, and
 *    taps away meant to dismiss it. Answering that with "Plan name is required" would make
 *    the popup feel stuck.
 *
 * So: **pristine dismisses, dirty saves.** Never discards.
 *
 * ⚠️ The caller passes a BASELINE captured when the form was opened, not an empty form.
 * Editing an existing record starts dirty against `{}` and pristine against the record —
 * only the second is the real question ("has this person changed anything?").
 */

export type BackdropAction =
  /** Nothing was typed: dismiss, as the user intended. */
  | 'close'
  /**
   * Something was typed: run the form's own save handler. It validates, so an incomplete
   * form keeps the popup open with its usual message rather than writing a bad row.
   */
  | 'save';

/**
 * Compared as JSON because these are flat form-state objects of primitives — the same
 * shape React holds in `useState`. It is deliberately NOT a general deep-equal: a form
 * carrying a Date, a Map or a function is outside what this can honestly compare, and
 * would silently read as dirty forever.
 */
function sameForm(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What a backdrop tap should do, given the form now and the form as it was opened.
 *
 * @param current  the form state at the moment of the tap
 * @param baseline the form state captured when the popup opened
 */
export function backdropAction(current: unknown, baseline: unknown): BackdropAction {
  return sameForm(current, baseline) ? 'close' : 'save';
}
