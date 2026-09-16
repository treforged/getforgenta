import { useEffect, useRef } from 'react';

/**
 * The panel row, in identical markup on every surface.
 *
 * The children are the `seg-item` buttons; the track is owned here so it cannot drift from
 * surface to surface.
 *
 * ⚠️ The Guide button used to live here, pinned to the row's right-hand end. Tre moved it
 * on 2026-08-18 — *"move the guide up to where the title for the tab is. put the guide for
 * both sections in the same guide"* — so it now sits in the page header as `SurfaceGuide`,
 * carrying every panel of the surface at once. Do not put a second one back here: that is
 * exactly the two-buttons-at-once state this component was built to end.
 *
 * ⚠️ THE TRACK IS ONE ROW THAT SCROLLS (`flex-nowrap` + `overflow-x-auto`, see `seg-track`
 * in `index.css`). Tre, 2026-09-16: *"format the pill in the settings tab cleaner."* It used
 * to wrap, which left a stray segment on a second line under the pill.
 */
export default function PanelBar({ children }: { children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);

  /**
   * KEEP THE SELECTED SEGMENT ON SCREEN.
   *
   * ⚠️ THIS IS WHAT MAKES `flex-nowrap` SAFE, so it is not a nicety. Debt's five segments need
   * 730px in a 363px phone track — without this, selecting "Other Debts" would leave the
   * chosen segment scrolled off the right-hand end with no scrollbar (`scrollbar-width: none`)
   * to hint that anything is there. A wrapped segment is at least visible; a silently
   * offscreen one is the worse failure, and it is the one nowrap would have introduced.
   *
   * It watches `aria-selected` rather than taking the active index as a prop, so every one of
   * the eight call sites gets this for free and none of them can forget to pass it. A call
   * site that marks selection some other way simply gets no scrolling rather than a crash.
   *
   * `block: 'nearest'` and `inline: 'nearest'` keep this to the horizontal axis — without
   * `nearest` on the block axis, scrolling a segment into view drags the whole PAGE to the
   * track, which on a long surface yanks the reader away from what they were looking at.
   */
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const scrollActiveIntoView = () => {
      const active = el.querySelector('[aria-selected="true"], .seg-item-active');
      if (!active) return;
      // Only when it is actually out of the track's own box — an unconditional call still
      // nudges the scroll position and makes the row twitch on every render.
      const t = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      if (a.left >= t.left && a.right <= t.right) return;
      active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    };
    scrollActiveIntoView();
    // The selection changes without this component re-rendering (the parent owns the state and
    // only the child's className/aria changes), so a MutationObserver is what actually catches
    // it. Scoped to the two attributes that carry selection.
    const obs = new MutationObserver(scrollActiveIntoView);
    obs.observe(el, { attributes: true, subtree: true, attributeFilter: ['aria-selected', 'class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={track} className="seg-track" role="tablist">
      {children}
    </div>
  );
}
