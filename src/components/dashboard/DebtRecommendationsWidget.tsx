import { useNavigate } from 'react-router';
import { AlertTriangle, CalendarDays, CheckCircle2, ArrowRight, Car, Landmark } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { formatNextDue, NEXT_PAYMENT_UNKNOWN, NEXT_DUE_UNKNOWN } from '@/lib/next-card-payment';
import type { MonthlyDebtBreakdown } from '@/lib/credit-card-engine';

type Props = {
  debtBreakdown: MonthlyDebtBreakdown;
};

export default function DebtRecommendationsWidget({ debtBreakdown }: Props) {
  const navigate = useNavigate();
  const {
    recommendations,
    totalMinimumsDue,
    totalRecommended,
    totalAvailableCash,
    strategyLabel,
    cashWarning,
  } = debtBreakdown;
  // Optional on the type only because the deprecated one-shot path never builds it; this widget
  // is fed by useMonth0DebtBreakdown, which always does.
  const loanRecommendations = debtBreakdown.loanRecommendations ?? [];
  const otherDebtRecommendations = debtBreakdown.otherDebtRecommendations ?? [];

  const hasRecs = recommendations.length > 0;
  const hasLoans = loanRecommendations.length > 0;
  // ⚠️ PART OF THE EMPTY-STATE GATE BELOW, not just of the list. A user with a student loan and
  // no cards and no vehicle is the entire population of the bug this closes: the rows were built,
  // and "No active debt recommendations this month" printed above the payment that was due.
  const hasOtherDebts = otherDebtRecommendations.length > 0;

  return (
    <div className="card-forged p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Debt — Recommended This Month
          </h3>
          {hasRecs && (
            <span className="text-[9px] px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 font-medium" style={{ borderRadius: 'var(--radius)' }}>
              {strategyLabel}
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('/debt')}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          Full details <ArrowRight size={11} />
        </button>
      </div>

      {!hasRecs && !hasLoans && !hasOtherDebts && (
        <p className="text-xs text-muted-foreground py-4 text-center">No active debt recommendations this month.</p>
      )}

      {(hasRecs || hasLoans || hasOtherDebts) && (
        <>
          {/* Two intros, because the two states show different KINDS of number. With cards
              present this is the /debt panel's claim, caveat included, so the two surfaces say
              the same thing. With only loans and other debts, nothing here was recommended: the
              payment is fixed by the debt, and the cash-flow caveat has nothing to qualify. */}
          <p className="text-[10px] text-muted-foreground mb-3">
            {hasRecs ? (
              <>
                A recommended payment based on your current cash flow. Not adjusted for bills
                further out than this month. Each row leads with its next payment and the date it
                is due.
              </>
            ) : (
              <>
                Your scheduled loan and debt payments. Each amount is fixed by the debt, not
                recommended from your cash flow. Each row leads with its next payment and the date
                it is due.
              </>
            )}
          </p>

          {hasRecs && cashWarning && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 px-3 py-2 mb-4 text-[10px] text-destructive" style={{ borderRadius: 'var(--radius)' }}>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>Safe to Pay ({formatCurrency(totalAvailableCash, false)}) is less than minimums due ({formatCurrency(totalMinimumsDue, false)}). Review cash flow.</span>
            </div>
          )}

          {/* Summary tiles — card-only figures. Loan money is not in Safe to Pay: the cash floor
              already holds it, so summing loans in here would double-count. */}
          {hasRecs && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-2 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-[9px] text-muted-foreground uppercase">Safe to Pay</p>
                <p className="text-xs font-display font-bold text-primary">{formatCurrency(totalAvailableCash, false)}</p>
              </div>
              <div className="p-2 bg-muted/30 border border-border text-center" style={{ borderRadius: 'var(--radius)' }}>
                <p className="text-[9px] text-muted-foreground uppercase">Minimums Due</p>
                <p className="text-xs font-display font-bold text-destructive">{formatCurrency(totalMinimumsDue, false)}</p>
              </div>
            </div>
          )}

          {/* Per-card rows — the /debt panel's A.2 layout, from the same `buildCardRecRows` rows:
              headline next payment + due date, badge and reason judged against that same figure. */}
          <div className="space-y-1.5">
            {recommendations.map(r => (
              <div
                key={r.cardId}
                className="flex items-center justify-between py-2 px-3 border border-border bg-muted/10 flex-wrap gap-1"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                  <span className="text-[10px] font-medium">{r.cardName}</span>
                  {r.reason === 'Autopay Full Balance' ? (
                    <span className="text-[9px] text-success bg-success/10 px-1.5 py-0.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius)' }}>
                      <CheckCircle2 size={9} /> autopay
                    </span>
                  ) : r.pastDue ? (
                    <span className="text-[9px] text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>saving</span>
                  ) : r.nextPayment == null ? (
                    // No badge: with no modelled payment there is nothing to classify, and
                    // "priority" would be a confident claim about an amount the row itself
                    // reports as unknown.
                    null
                  ) : r.isMinimumOnly ? (
                    <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>min</span>
                  ) : (
                    <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>priority</span>
                  )}
                  <span className="text-[9px] text-muted-foreground italic truncate">{r.reason}</span>
                </div>
                {/* The next payment and the date it is due, together, because apart they lied:
                    a "$0" beside a left-hand "Due 1st" chip read as "nothing to pay on the 1st".
                    This month's figure is DEMOTED rather than dropped whenever the next payment
                    is next month's. */}
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span className="flex items-baseline gap-1">
                    {r.nextPayMonth === 1 && (
                      <span className="text-[8px] uppercase tracking-wider text-muted-foreground">next</span>
                    )}
                    {r.nextPayment != null ? (
                      <span className="text-sm font-display font-bold text-primary">{formatCurrency(r.nextPayment, false)}</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{NEXT_PAYMENT_UNKNOWN}</span>
                    )}
                  </span>
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays size={8} /> {r.nextDueDate ? formatNextDue(r.nextDueDate) : NEXT_DUE_UNKNOWN}
                  </span>
                  {r.nextPayMonth === 1 && (
                    // Demoted, not deleted. A this-month amount that is still owed is the
                    // actionable number and stays legible; a $0 stays quiet, because there is
                    // nothing to act on and the row above already carries the claim.
                    <span className={r.payment > 0
                      ? 'text-[10px] text-foreground'
                      : 'text-[9px] text-muted-foreground/70'}>
                      {formatCurrency(r.payment, false)} due this month
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Loan rows — no demoted "due this month" sub-line, unlike the cards: whether a
                past-due-day loan payment was already made is not something this model can verify,
                and claiming either way would be dishonest. */}
            {loanRecommendations.map(l => (
              <div
                key={l.carFundId}
                className="flex items-center justify-between py-2 px-3 border border-border bg-muted/10 flex-wrap gap-1"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Car size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-medium">{l.name}</span>
                  <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>loan</span>
                  <span className="text-[9px] text-muted-foreground italic truncate">{l.isFinalPayment ? 'Final payment' : 'Scheduled payment'}</span>
                </div>
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span className="flex items-baseline gap-1">
                    {l.nextPayMonth === 1 && (
                      <span className="text-[8px] uppercase tracking-wider text-muted-foreground">next</span>
                    )}
                    <span className="text-sm font-display font-bold text-primary">{formatCurrency(l.nextPayment, false)}</span>
                  </span>
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays size={8} /> {l.nextDueDate ? formatNextDue(l.nextDueDate) : NEXT_DUE_UNKNOWN}
                  </span>
                </div>
              </div>
            ))}

            {/* Non-CC debt rows — a student loan, a mortgage, an `other_liability` paired to a
                `debts` row. A THIRD list rather than rows appended to the loans above, for the
                reason `otherDebtRecommendations` gives: a student loan has no `carFundId`, and a
                Car icon beside it would be a picture of the wrong thing. Same no-sub-line rule as
                the loans: whether a past-due-day payment was already made is not knowable here. */}
            {otherDebtRecommendations.map(o => (
              <div
                key={o.accountId}
                className="flex items-center justify-between py-2 px-3 border border-border bg-muted/10 flex-wrap gap-1"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Landmark size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-medium">{o.name}</span>
                  <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
                    {o.accountType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[9px] text-muted-foreground italic truncate">{o.isFinalPayment ? 'Final payment' : 'Scheduled payment'}</span>
                  {/* Said out loud rather than hidden: the debt is real either way, and a row that
                      vanished for users who set up an expense rule would look like the app had
                      lost the loan. It also explains why this money is not in the card totals. */}
                  {o.paidByExpenseRule && (
                    <span className="text-[9px] text-muted-foreground italic truncate">Paid by your expense rule</span>
                  )}
                </div>
                <div className="flex flex-col items-end leading-tight shrink-0">
                  <span className="flex items-baseline gap-1">
                    {o.nextPayMonth === 1 && (
                      <span className="text-[8px] uppercase tracking-wider text-muted-foreground">next</span>
                    )}
                    <span className="text-sm font-display font-bold text-primary">{formatCurrency(o.nextPayment, false)}</span>
                  </span>
                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                    <CalendarDays size={8} /> {o.nextDueDate ? formatNextDue(o.nextDueDate) : NEXT_DUE_UNKNOWN}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {(hasLoans || hasOtherDebts) && (
            <p className="text-[9px] text-muted-foreground mt-2">
              Loan and other debt payments are already taken out of your cash before Safe to Pay,
              not counted in the card totals.
            </p>
          )}

          {/* Total — card-only, matching Safe to Pay above. */}
          {hasRecs && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40 text-xs">
              <span className="text-muted-foreground font-medium">Total recommended</span>
              <span className="font-display font-bold text-primary">{formatCurrency(totalRecommended, false)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
