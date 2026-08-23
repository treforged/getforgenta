import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/calculations';

/**
 * What the user's accounts add up to, at the very top of every Dashboard panel.
 *
 * This is the tile block that used to sit inside the Accounts panel (Tre, 2026-08-22:
 * *"move the overview data from the accounts tab to the top of the dashboard. condense and
 * combine duplicate information."*). Every figure it showed is still here — Net Worth,
 * Total Assets, Total Liabilities, Liquid Cash, Investments, Retirement and CC Debt — with
 * assets and liabilities demoted to sub-figures under the headline they add up to, and
 * credit utilization folded onto the CC Debt tile it is the ratio of.
 *
 * Fixed, not a `useDashboardLayout` widget: it is the answer to "how am I doing", it renders
 * above the panel switcher so Overview, Accounts and Goals all keep it on screen, and there
 * is no arrangement of the page where hiding it helps.
 *
 * Loading is a shape, never a zero. A $0 net worth and a net worth that has not been read
 * yet look identical, and the totals aggregate four sources (accounts, manual assets, manual
 * liabilities, amortized vehicle loans) — the Accounts panel painted eight confident $0.00
 * tiles for exactly that reason before it gated on all four.
 */
export interface DashboardOverviewStripProps {
  /** True until every source behind these totals has resolved. Shows the skeleton. */
  loading: boolean;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  liquidCash: number;
  investments: number;
  retirement: number;
  ccDebt: number;
  /** Limit across OPEN cards only. 0 means no limits on file, not "no credit". */
  ccLimit: number;
  /** Opens the net-worth breakdown drawer, when the host has one. */
  onNetWorthClick?: () => void;
  /** Opens the liquid-cash breakdown drawer, when the host has one. */
  onLiquidCashClick?: () => void;
}

const LABEL = 'text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wider font-medium';
const SUB_FIGURE = 'text-sm sm:text-base font-display font-bold mt-0.5';

const money = (v: number) => formatCurrency(v, false);

interface SplitTileProps {
  label: string;
  value: string;
  tone: string;
  sub?: string;
  onClick?: () => void;
}

function SplitTile({ label, value, tone, sub, onClick }: SplitTileProps) {
  const body = (
    <>
      <p className={LABEL}>{label}</p>
      <p className={`${SUB_FIGURE} ${tone}`}>{value}</p>
      {sub && <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </>
  );

  if (!onClick) return <div>{body}</div>;
  return (
    <button type="button" onClick={onClick} className="w-full text-center transition-colors hover:text-primary">
      {body}
    </button>
  );
}

function StripSkeleton() {
  return (
    <div className="card-forged p-4 sm:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 sm:gap-5">
        <div className="space-y-2 text-center lg:text-left">
          <Skeleton className="h-2.5 w-20 bg-muted/50 mx-auto lg:mx-0" />
          <Skeleton className="h-7 w-36 bg-muted/50 mx-auto lg:mx-0" />
          <Skeleton className="h-3 w-44 bg-muted/50 mx-auto lg:mx-0" />
        </div>
        <div className="border-t lg:border-t-0 lg:border-l border-border/40 pt-4 lg:pt-0 lg:pl-5 xl:pl-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-2.5 w-16 bg-muted/50 mx-auto" />
                <Skeleton className="h-5 w-20 bg-muted/50 mx-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardOverviewStrip({
  loading,
  netWorth,
  totalAssets,
  totalLiabilities,
  liquidCash,
  investments,
  retirement,
  ccDebt,
  ccLimit,
  onNetWorthClick,
  onLiquidCashClick,
}: DashboardOverviewStripProps) {
  if (loading) return <StripSkeleton />;

  // No limits on file means the ratio has no reading. 0.0% and "you use none of your
  // credit" are the same pixels and opposite facts.
  const utilizationSub = ccLimit > 0
    ? `${((ccDebt / ccLimit) * 100).toFixed(1)}% of ${money(ccLimit)}`
    : 'no credit limits on file';

  const headline = (
    <>
      <p className={LABEL}>Net Worth</p>
      <p className={`text-2xl sm:text-3xl font-display font-bold mt-0.5 ${netWorth >= 0 ? 'text-primary' : 'text-destructive'}`}>
        {money(netWorth)}
      </p>
      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
        <span className="text-success font-medium">{money(totalAssets)}</span> assets
        <span className="mx-1.5 text-border">|</span>
        <span className="text-destructive font-medium">{money(totalLiabilities)}</span> liabilities
      </p>
    </>
  );

  return (
    <div className="card-forged p-4 sm:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 sm:gap-5">
        <div className="text-center lg:text-left">
          {onNetWorthClick ? (
            <button
              type="button"
              onClick={onNetWorthClick}
              className="w-full text-center lg:text-left transition-colors hover:text-primary"
            >
              {headline}
            </button>
          ) : (
            headline
          )}
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-border/40 pt-4 lg:pt-0 lg:pl-5 xl:pl-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5 text-center">
            <SplitTile label="Liquid Cash" value={money(liquidCash)} tone="text-success" onClick={onLiquidCashClick} />
            <SplitTile label="Investments" value={money(investments)} tone="text-primary" />
            <SplitTile label="Retirement" value={money(retirement)} tone="text-primary" />
            <SplitTile label="CC Debt" value={money(ccDebt)} tone="text-destructive" sub={utilizationSub} />
          </div>
        </div>
      </div>
    </div>
  );
}
