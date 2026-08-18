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
 */
export default function PanelBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="seg-track" role="tablist">
      {children}
    </div>
  );
}
