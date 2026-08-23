import { Skeleton } from '@/components/ui/skeleton';

/**
 * Page skeletons.
 *
 * The rule these follow: a loading state must be the SHAPE of the thing that is
 * coming. Never a spinner laid over stale numbers, and never an empty state —
 * "No savings goals yet" and "still fetching your savings goals" look identical
 * to a person and mean opposite things.
 *
 * `PageSkeleton` is the generic list-shaped fallback. Prefer one of the named,
 * per-page shapes below when the page is not a list.
 */

const BAR = 'bg-muted/50';

function Row({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function SkeletonHeader({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className={`h-6 w-40 ${BAR}`} />
        <Skeleton className={`h-3 w-52 ${BAR}`} />
      </div>
      {withAction && <Skeleton className={`h-8 w-28 ${BAR}`} />}
    </div>
  );
}

export function SkeletonStatCard({ big = false }: { big?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-2.5 w-20 mx-auto ${BAR}`} />
      <Skeleton className={`${big ? 'h-7 w-28' : 'h-5 w-20'} mx-auto ${BAR}`} />
    </div>
  );
}

export function SkeletonMetricGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-forged p-4 space-y-2">
          <Skeleton className={`h-3 w-20 ${BAR}`} />
          <Skeleton className={`h-6 w-28 ${BAR}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * A chart-shaped placeholder: bars of varied height, so the eye reads "a chart
 * is loading" rather than "a grey box failed to load".
 */
export function SkeletonChart({ height = 200, bars = 8 }: { height?: number; bars?: number }) {
  const heights = [42, 58, 50, 66, 72, 60, 78, 84, 70, 90, 62, 76];
  return (
    <div className="flex items-end gap-2 px-2 pb-4 skeleton-shimmer" style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} className="flex-1 bg-muted/40 rounded-sm" style={{ height: `${heights[i % heights.length]}%` }} />
      ))}
    </div>
  );
}

export function SkeletonChartCard({ height = 200, bars = 8 }: { height?: number; bars?: number }) {
  return (
    <div className="card-forged p-5">
      <Skeleton className={`h-3 w-36 mb-5 ${BAR}`} />
      <SkeletonChart height={height} bars={bars} />
    </div>
  );
}

export function SkeletonListRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card-forged p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
          <div className="flex items-center gap-3">
            <Skeleton className={`h-8 w-8 rounded-full shrink-0 ${BAR}`} />
            <div className="space-y-1.5">
              <Skeleton className={`h-3 w-36 ${BAR}`} />
              <Skeleton className={`h-2.5 w-24 ${BAR}`} />
            </div>
          </div>
          <Skeleton className={`h-4 w-16 ${BAR}`} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4, height = 'h-24' }: { count?: number; height?: string }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`card-forged p-4 ${height}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className={`h-9 w-9 rounded-full shrink-0 ${BAR}`} />
              <div className="space-y-2">
                <Skeleton className={`h-3.5 w-32 ${BAR}`} />
                <Skeleton className={`h-2.5 w-20 ${BAR}`} />
              </div>
            </div>
            <div className="space-y-2 text-right">
              <Skeleton className={`h-5 w-24 ${BAR}`} />
              <Skeleton className={`h-2.5 w-16 ml-auto ${BAR}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonPills({ count = 3 }: { count?: number }) {
  const widths = ['w-24', 'w-20', 'w-24', 'w-16', 'w-20'];
  return (
    <div className="flex gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`h-7 ${widths[i % widths.length]} ${BAR}`} />
      ))}
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-6 overflow-x-hidden" aria-busy="true" data-testid="page-skeleton">
      {children}
    </div>
  );
}

/** Generic list-shaped fallback. */
export function PageSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonMetricGrid />
      <SkeletonListRows />
    </Page>
  );
}

/**
 * Accounts: header, the eight-figure summary block, the net-worth chart, the
 * filter pills, then the account rows. Matches the real page one-for-one so
 * nothing jumps when the data lands — and, critically, shows no numbers at all
 * rather than eight confident $0.00 tiles.
 */
/**
 * Accounts: header, the panel pills, then the account rows.
 *
 * No summary tiles and no chart, because the panel no longer has either — the trend chart
 * moved to the Overview on 2026-08-20 and the totals to the Dashboard's overview strip on
 * 2026-08-22. A skeleton promising a card that never arrives is a loading state that lies
 * about the shape of what is coming.
 */
export function AccountsSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonPills count={3} />
      <SkeletonCards count={5} />
    </Page>
  );
}

/** Goals: header, growth chart, the two totals, then the goal card grid. */
export function GoalsSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonChartCard height={180} bars={10} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card-forged p-4 space-y-2">
            <Skeleton className={`h-2.5 w-20 mx-auto ${BAR}`} />
            <Skeleton className={`h-5 w-24 mx-auto ${BAR}`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-forged p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className={`h-3.5 w-32 ${BAR}`} />
              <Skeleton className={`h-3 w-12 ${BAR}`} />
            </div>
            <Skeleton className={`h-2 w-full ${BAR}`} />
            <div className="flex items-center justify-between">
              <Skeleton className={`h-2.5 w-20 ${BAR}`} />
              <Skeleton className={`h-2.5 w-16 ${BAR}`} />
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

/** Debt payoff: header, tab strip, stat row, payoff chart, card accordion. */
export function DebtSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonPills count={5} />
      <SkeletonMetricGrid count={4} />
      <SkeletonChartCard height={220} bars={12} />
      <SkeletonCards count={3} />
    </Page>
  );
}

/** Forecast: header, assumption pills, the 60-month chart, then the table. */
export function ForecastSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonMetricGrid count={4} />
      <SkeletonChartCard height={280} bars={12} />
      <SkeletonListRows rows={8} />
    </Page>
  );
}

/** Transactions: header, totals, the filter bar, then the ledger. */
export function TransactionsSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonMetricGrid count={4} />
      <div className="flex flex-wrap gap-2">
        {['w-32', 'w-24', 'w-28', 'w-24'].map((w, i) => (
          <Skeleton key={i} className={`h-8 ${w} ${BAR}`} />
        ))}
      </div>
      <SkeletonListRows rows={10} />
    </Page>
  );
}

/** Budget control: header, totals, then the six rule sections. */
export function BudgetSkeleton() {
  return (
    <Page>
      <SkeletonHeader />
      <SkeletonMetricGrid count={4} />
      {Array.from({ length: 3 }).map((_, i) => (
        <Row key={i} className="card-forged p-5 space-y-3">
          <Skeleton className={`h-3 w-32 ${BAR}`} />
          {Array.from({ length: 3 }).map((__, j) => (
            <div key={j} className="flex items-center justify-between py-1.5">
              <Skeleton className={`h-3 w-40 ${BAR}`} />
              <Skeleton className={`h-3 w-16 ${BAR}`} />
            </div>
          ))}
        </Row>
      ))}
    </Page>
  );
}

/** The phase blocks and their line items, on their own — see BuildsSkeleton. */
export function BuildPhasesSkeleton({ phases = 3 }: { phases?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: phases }).map((_, i) => (
        <div key={i} className="card-forged p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className={`h-3.5 w-36 ${BAR}`} />
            <Skeleton className={`h-3 w-16 ${BAR}`} />
          </div>
          {Array.from({ length: 2 }).map((__, j) => (
            <div key={j} className="flex items-center justify-between py-1.5">
              <Skeleton className={`h-3 w-44 ${BAR}`} />
              <Skeleton className={`h-3 w-14 ${BAR}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Builds: the build switcher, the summary block, then phases and items. */
export function BuildsSkeleton() {
  return (
    <div className="max-w-3xl mx-auto py-2 sm:py-4 space-y-6" aria-busy="true" data-testid="page-skeleton">
      <div className="flex items-center gap-2">
        <Skeleton className={`h-9 flex-1 ${BAR}`} />
        <Skeleton className={`h-9 w-9 ${BAR}`} />
        <Skeleton className={`h-9 w-9 ${BAR}`} />
      </div>
      <div className="card-forged p-5 space-y-3">
        <Skeleton className={`h-3 w-28 ${BAR}`} />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
      </div>
      <BuildPhasesSkeleton />
    </div>
  );
}
