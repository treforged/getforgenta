import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  return (
    <div className="py-4 lg:py-6 max-w-6xl mx-auto space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 bg-muted/50" />
          <Skeleton className="h-3 w-32 bg-muted/50" />
        </div>
        <Skeleton className="h-8 w-24 bg-muted/50" />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-forged p-4 space-y-2">
            <Skeleton className="h-3 w-20 bg-muted/50" />
            <Skeleton className="h-6 w-28 bg-muted/50" />
          </div>
        ))}
      </div>

      {/* Content list */}
      <div className="card-forged p-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full bg-muted/50 shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-36 bg-muted/50" />
                <Skeleton className="h-2.5 w-24 bg-muted/50" />
              </div>
            </div>
            <Skeleton className="h-4 w-16 bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
