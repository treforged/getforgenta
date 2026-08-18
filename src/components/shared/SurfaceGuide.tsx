import InstructionsModal from '@/components/shared/InstructionsModal';
import { resolveSurfaceGuide, type GuideSurface } from '@/lib/page-guides';

/**
 * The one guide for a page, sitting in its header row.
 *
 * ⚠️ ONE per surface, carrying EVERY panel's sections under its own heading — not one per
 * panel. Tre, 2026-08-18: *"put the guide for both sections in the same guide"*. A page's
 * panels are views of one subject, and splitting the guide meant the answer about the other
 * panel was only reachable by switching to it first.
 *
 * It renders as the last item of a header's right-hand cluster, which is what puts it at
 * the title's level while keeping its distance from the right edge the same on every page.
 */
export default function SurfaceGuide({ surface }: { surface: GuideSurface }) {
  const guide = resolveSurfaceGuide(surface);
  return (
    <div className="shrink-0">
      <InstructionsModal pageTitle={guide.title} sections={guide.sections} />
    </div>
  );
}
