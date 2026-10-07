// The ONE loading indicator for full-screen waits (ask 98cbf494, Tre: "the cover page lingers with
// no feedback ... same for other loading/cover screens"). The Forgenta mark with the `logo-shimmer`
// sweep (index.css), and an optional label announced to screen readers. Route chunks still show
// PageSkeleton (App.tsx): a skeleton holds the shape of the page that is coming, which this cannot.

interface LoadingMarkProps {
  /** Shown under the mark and announced politely. Omit for a mark-only wait. */
  label?: string;
  /** Edge length of the mark in px. 112 matches the native cover's logo. */
  size?: number;
  /** false renders the same mark without the sweep, for a settled screen that only shows branding. */
  loading?: boolean;
}

export default function LoadingMark({ label, size = 112, loading = true }: LoadingMarkProps) {
  return (
    <div className="flex flex-col items-center gap-4" role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
      <span className={`inline-flex ${loading ? 'logo-shimmer' : ''}`} data-testid="loading-mark">
        <img
          src="/logo-transparent-384.png"
          alt={label ? '' : 'Forgenta'}
          style={{ height: size, width: size, objectFit: 'contain' }}
          draggable={false}
        />
      </span>
      {label && <p className="text-sm text-muted-foreground text-center">{label}</p>}
    </div>
  );
}
