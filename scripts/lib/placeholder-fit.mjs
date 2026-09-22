/**
 * DOES A PLACEHOLDER FIT ITS FIELD? - the one definition, shared by every walk that can see one.
 *
 * ── WHY THIS IS A SHARED MODULE AND NOT A COPY ───────────────────────────────────────────────
 * `check-placeholders.mjs` walks ROUTES, so it only ever sees fields that render WITHOUT
 * interaction - measured live on 2026-09-22, that is **3 distinct placeholders against 71 in
 * source**. The other 68 sit behind modals, panels and the onboarding steps, and the only way to
 * reach them is a walk that PRESSES things. `check-onboarding-orientation.mjs` already drives all
 * nine first-run steps and meets 5 of them.
 *
 * Two walks measuring the same property is exactly where a copied rule drifts, and this one is
 * subtle enough that a drifted copy would be wrong rather than merely different. So the
 * measurement lives here once and both callers evaluate it.
 *
 * ── ⚠️ `scrollWidth > clientWidth` IS THE OBVIOUS CRITERION AND IT IS BLIND ───────────────────
 * A placeholder is not CONTENT. An empty input has nothing to overflow, so the browser reports
 * `scrollWidth === clientWidth` however long the placeholder is. A gate built on it returns a
 * confident zero. It is still RECORDED below, as `swGtCw`, purely so the report can show how many
 * real clippings it would have missed - never to gate on.
 *
 * ── WHAT IS ACTUALLY MEASURED ────────────────────────────────────────────────────────────────
 * The placeholder string laid out with the field's OWN computed font via `measureText`, against
 * the field's content box: `clientWidth` minus its horizontal padding. `clientWidth` excludes the
 * border but INCLUDES padding, which the text cannot use. An icon absolutely positioned over the
 * field eats width that padding does not describe, so an overlapping absolute sibling is
 * subtracted too.
 *
 * ── WHAT IT DOES NOT ANSWER ──────────────────────────────────────────────────────────────────
 * Whether a placeholder that FITS is the right words, and anything at all about a `textarea` -
 * a multi-line field WRAPS its placeholder, so a long one there is correct rather than clipped.
 * Only `input[placeholder]` is examined, deliberately.
 */

/**
 * Runs INSIDE the browser, so it must be self-contained - no closure over module scope, because
 * it is serialised across the boundary. Pass it straight to `page.evaluate`.
 *
 * @returns {Promise<Array<{text:string,textPx:number,availPx:number,overflowPx:number,swGtCw:boolean}>>}
 */
export const READ_PLACEHOLDER_FIT = () => {
  const canvas = document.createElement('canvas');
  const c2d = canvas.getContext('2d');
  const out = [];
  for (const el of document.querySelectorAll('input[placeholder]')) {
    const text = el.getAttribute('placeholder') || '';
    if (!text.trim()) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;   // a 0x0 wrapper is not a rendered field

    // The browser lays the placeholder out in the field's own font, so measure in that font.
    c2d.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} / ${st.lineHeight} ${st.fontFamily}`;
    const textPx = c2d.measureText(text).width;

    // clientWidth already excludes the border but INCLUDES padding, which the text cannot use.
    const padL = parseFloat(st.paddingLeft) || 0;
    const padR = parseFloat(st.paddingRight) || 0;
    let avail = el.clientWidth - padL - padR;

    // An icon absolutely positioned over the field eats width that padding does not describe.
    // Subtract any absolute sibling that overlaps the field's own box.
    const parent = el.parentElement;
    if (parent) {
      for (const sib of parent.children) {
        if (sib === el) continue;
        const ss = getComputedStyle(sib);
        if (ss.position !== 'absolute') continue;
        const sb = sib.getBoundingClientRect();
        if (sb.width < 1 || sb.right < box.left || sb.left > box.right) continue;
        avail -= Math.min(sb.width, box.width);
      }
    }

    out.push({
      text,
      textPx: Math.round(textPx),
      availPx: Math.round(avail),
      overflowPx: Math.round(textPx - avail),
      // Recorded ONLY to show it is blind here. Never gate on it.
      swGtCw: el.scrollWidth > el.clientWidth,
    });
  }
  return out;
};

/** A field is clipped when its placeholder needs more width than the box gives it. */
export const isClipped = (f) => f.overflowPx > 0;
