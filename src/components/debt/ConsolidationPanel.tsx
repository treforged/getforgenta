// Debt Payoff's "Would a consolidation loan help?" panel (ask fee53760), for Tre's 2026-08-20
// question about a preapproved personal loan. Collapsed by default, and it never invents a rate:
// the APR field starts empty and nothing is priced until the user types the one on their offer.
// Interest and utilization stay in two separate blocks - consolidation.ts forbids one verdict.
import { useMemo, useState } from 'react';
import { formatCurrency } from '@/lib/calculations';
import { toLocalDateStr } from '@/lib/scheduling';
import { FIELD_INPUT } from '@/components/shared/field-classes';
import { ChevronDown } from 'lucide-react';
import {
  buildConsolidationView,
  UTILIZATION_TARGET_PCT,
  type ConsolidationOffer,
} from '@/lib/consolidation-view';
import type {
  ConsolidationAccountRow,
  ConsolidationPlanRow,
} from '@/lib/consolidation-adapter';

interface Props {
  accounts: readonly ConsolidationAccountRow[];
  plans: readonly ConsolidationPlanRow[];
}

export default function ConsolidationPanel({ accounts, plans }: Props) {
  const [open, setOpen] = useState(false);
  const [apr, setApr] = useState('');
  const [term, setTerm] = useState('36');
  const [amount, setAmount] = useState('');

  const asOf = useMemo(() => toLocalDateStr(new Date()), []);

  const parsedApr = Number(apr);
  const parsedTerm = Number(term);
  // A 0% promotional loan is a real offer, so 0 is valid; only an empty or unparseable APR is not.
  const validOffer =
    apr.trim() !== '' && Number.isFinite(parsedApr) && parsedApr >= 0 && Number.isFinite(parsedTerm) && parsedTerm > 0;

  const offer: ConsolidationOffer = useMemo(
    () => ({
      aprPct: validOffer ? parsedApr : 0,
      termMonths: validOffer ? Math.round(parsedTerm) : 36,
      originationFeePct: 0,
      principal: amount.trim() === '' ? null : Number(amount),
    }),
    [validOffer, parsedApr, parsedTerm, amount],
  );

  const view = useMemo(
    () => buildConsolidationView(accounts, plans, offer, asOf),
    [accounts, plans, offer, asOf],
  );

  if (!view.hasCardDebt) {
    return null;
  }

  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);

  return (
    <section className="card-forged p-4 sm:p-5 space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="consolidation-panel-body"
        className="w-full flex items-center justify-between text-xs font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        Would a consolidation loan help?
        <ChevronDown
          size={14}
          className={open ? 'transform rotate-180 transition-transform' : 'transition-transform'}
        />
      </button>

      {open && (
        <div id="consolidation-panel-body" className="text-xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-[11px] text-muted-foreground space-y-1 block">
              Loan APR (%)
              <input
                type="number"
                inputMode="decimal"
                className={FIELD_INPUT}
                value={apr}
                onChange={(e) => setApr(e.target.value)}
              />
            </label>

            <label className="text-[11px] text-muted-foreground space-y-1 block">
              Term (months)
              <input
                type="number"
                inputMode="decimal"
                className={FIELD_INPUT}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </label>

            <label className="text-[11px] text-muted-foreground space-y-1 block">
              Loan amount
              <input
                type="number"
                inputMode="decimal"
                className={FIELD_INPUT}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={formatCurrency(
                  view.suggestedPrincipal || view.totalCardDebt,
                  false,
                )}
              />
            </label>
          </div>

          {view.suggestedPrincipal === 0 ? (
            <p className="text-muted-foreground">
              Every open card already stays at or under {UTILIZATION_TARGET_PCT}%.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Smallest loan that keeps every card at or under {UTILIZATION_TARGET_PCT}%,
              including payment plans still landing:{' '}
              {formatCurrency(view.suggestedPrincipal, false)}
            </p>
          )}

          {!validOffer && (
            <p className="text-muted-foreground">
              Enter the APR from your loan offer to compare.
            </p>
          )}

          {validOffer && (
            <>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Interest
                </p>
                <p className="text-muted-foreground">
                  Loan payment {formatCurrency(view.monthlyPayment, false)}/mo. Loan interest{' '}
                  {formatCurrency(view.interest.loanTotal, false)}.
                </p>
                <p className="text-muted-foreground">
                  {view.interest.cardsTotal === null
                    ? 'Paying the same amount on your cards, they would not pay off.'
                    : `Paying the same amount on your cards: ${formatCurrency(
                        view.interest.cardsTotal,
                        false,
                      )} interest.`}
                </p>
                {view.interest.delta !== null && (
                  <p
                    className={
                      view.interest.delta < 0
                        ? 'text-primary'
                        : view.interest.delta > 0
                        ? 'text-destructive-text'
                        : 'text-muted-foreground'
                    }
                  >
                    {view.interest.delta < 0
                      ? `The loan saves ${formatCurrency(-view.interest.delta, false)} in interest.`
                      : view.interest.delta > 0
                      ? `The loan costs ${formatCurrency(view.interest.delta, false)} more in interest.`
                      : 'Same interest either way.'}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Utilization
                </p>
                <p className="text-muted-foreground">
                  Highest card {pct(view.utilization.beforeWorstPct)} now,{' '}
                  {pct(view.utilization.afterWorstPct)} after, once your payment plans land.
                </p>
              </div>

              {view.shortfall > 0.005 && (
                <p className="text-muted-foreground">
                  This loan leaves {formatCurrency(view.shortfall, false)} on your cards.
                </p>
              )}
            </>
          )}

          {view.notes.length > 0 && (
            <ul className="list-disc pl-5 text-[11px] text-muted-foreground space-y-1">
              {view.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
