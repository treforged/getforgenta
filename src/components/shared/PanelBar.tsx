import InstructionsModal from '@/components/shared/InstructionsModal';
import { resolveGuide, type GuideSurface } from '@/lib/page-guides';

/**
 * The panel row, and the guide for whatever panel is open.
 *
 * ⚠️ This component exists so that NO page decides where its Guide button goes. The button
 * used to trail each page's `<h1>`, which made its x a function of title length — measured
 * at 96 / 118 / 123 / 162 / 271 / 391 px across the six surfaces, plus two nested ones at
 * x=18 inside a hosted panel. Here it is pinned to the right-hand end of the panel row, so
 * its position is the same on every surface at every width, and it sits next to the control
 * that decides which guide it shows.
 *
 * The guide follows the ACTIVE PANEL, not the page (see `lib/page-guides.ts`). A page that
 * hosts another page's panel therefore shows one guide — the right one — where it used to
 * render two buttons at once.
 *
 * The children are the `seg-item` buttons themselves; the track is owned here so the markup
 * cannot drift from surface to surface.
 */
export default function PanelBar({
  surface,
  panel,
  children,
}: {
  surface: GuideSurface;
  /** The page's own active-panel state value, passed through unchanged. */
  panel: string;
  children: React.ReactNode;
}) {
  const guide = resolveGuide(surface, panel);
  return (
    <div className="flex items-center gap-2">
      {/* min-w-0 so the track, not the row, is what scrolls when the pills overflow —
          otherwise the guide gets pushed off the right edge at 390px. */}
      <div className="seg-track min-w-0" role="tablist">
        {children}
      </div>
      <div className="shrink-0">
        <InstructionsModal pageTitle={guide.title} sections={guide.sections} />
      </div>
    </div>
  );
}
