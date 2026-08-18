import { Link } from 'react-router';
import { ArrowUpRight, AlertTriangle, Flag } from 'lucide-react';
import {
  selectNextMilestone,
  classifyMilestoneTone,
  type ForecastMilestone,
  type MilestoneTone,
} from '@/lib/next-milestone';

/**
 * The one thing the Forecast leads with (DIRECTION.md rule 2): the next milestone month.
 *
 * A pure renderer over `selectNextMilestone`, in the same shape as `DashboardHero` — which
 * branch is taken is decided by a tested selector, not by JSX, so "never skip the bad news"
 * and "never fabricate a month" are pinned by tests rather than by reading the markup.
 *
 * Good and bad news get the SAME prominence — same `text-5xl font-display` month — and
 * differ only in tone. Gold stays out of it: it is reserved for money-in-motion and primary
 * actions, and a milestone is neither.
 */
type Props = {
  milestones: readonly ForecastMilestone[] | undefined;
  /**
   * Why the milestone list is empty, when it is. `no-inputs` means nothing has been entered
   * yet; `no-milestones` means the projection ran and simply crosses no line in 60 months.
   * Telling a fully-set-up user to "add an account" would be a lie, hence the split.
   */
  emptyReason: 'no-inputs' | 'no-milestones';
};

const EMPTY_COPY: Record<Props['emptyReason'], { title: string; body: string; action?: { to: string; label: string } }> = {
  'no-inputs': {
    title: 'Nothing to project yet',
    body: 'Add your income and expense rules, or connect an account, and your next milestone lands here.',
    action: { to: '/budget', label: 'Add income & expenses' },
  },
  'no-milestones': {
    title: 'No milestones in 60 months',
    body: 'Nothing in this projection crosses a payoff, a savings goal, or your cash floor. The monthly receipts below still show every month.',
  },
};

/** Month colour by tone. Negative reads destructive; nothing here is ever gold. */
const MONTH_TONE: Record<MilestoneTone, string> = {
  negative: 'text-destructive',
  positive: 'text-foreground',
  neutral: 'text-foreground',
};

/** Supporting-line colour by tone — the distinct voice, at identical prominence. */
const EVENT_TONE: Record<MilestoneTone, string> = {
  negative: 'text-destructive',
  positive: 'text-success',
  neutral: 'text-muted-foreground',
};

function HeroShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="card-forged p-5 sm:p-6" aria-label="Next milestone">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">Next milestone</p>
      {children}
    </section>
  );
}

/** Everything after the hero, in the engine's order. The list keeps all of its information. */
function RemainingMilestones({ milestones }: { milestones: ForecastMilestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <div className="mt-5 pt-4 border-t border-border/40">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Then ({milestones.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {milestones.map((m, i) => {
          const tone = classifyMilestoneTone(m.event);
          const chip = tone === 'negative'
            ? 'bg-destructive/10 text-destructive'
            : tone === 'positive'
              ? 'bg-success/10 text-success'
              : 'bg-secondary text-muted-foreground';
          return (
            <span key={i} className={`px-2 sm:px-3 py-1 text-xs font-medium ${chip}`} style={{ borderRadius: 'var(--radius)' }}>
              {m.month}: {m.event}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ForecastHero({ milestones, emptyReason }: Props) {
  const selection = selectNextMilestone(milestones);

  if (!selection) {
    const copy = EMPTY_COPY[emptyReason];
    return (
      <HeroShell>
        <p className="text-2xl font-display font-bold text-muted-foreground tracking-tight mt-1">
          {copy.title}
        </p>
        <p className="text-sm text-muted-foreground mt-2 max-w-prose">{copy.body}</p>
        {copy.action && (
          <Link
            to={copy.action.to}
            className="inline-flex items-center gap-1.5 mt-4 bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold btn-press hover:bg-primary/90 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {copy.action.label} <ArrowUpRight size={13} />
          </Link>
        )}
      </HeroShell>
    );
  }

  const { milestone, tone, rest } = selection;
  const Icon = tone === 'negative' ? AlertTriangle : Flag;

  return (
    <HeroShell>
      <p className={`text-5xl font-display font-bold tracking-tight mt-1 ${MONTH_TONE[tone]}`}>
        {milestone.month}
      </p>
      <p className={`text-sm mt-2 flex items-start gap-1.5 ${EVENT_TONE[tone]}`}>
        <Icon size={14} className="shrink-0 mt-0.5" aria-hidden />
        <span>{milestone.event}</span>
      </p>
      <RemainingMilestones milestones={rest} />
    </HeroShell>
  );
}
