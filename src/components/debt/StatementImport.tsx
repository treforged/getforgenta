// Paste a statement, see what was read off it, decide whether to take it.
//
// Tre, 2026-09-12: "make a feature where users can add or upload a statement that can be auto
// scanned for pulling statement balance, interest saving balance, any payment plans, or anything
// like that that can be auto added into their account for them."
//
// ⚠️ IT SHOWS BEFORE IT WRITES, AND THAT IS THE WHOLE INTERACTION. Every figure here lands on a
// money row that the payoff engine then plans against, so the person sees what the statement said
// NEXT TO what their card currently holds, and presses once. "Auto added" means they do not have to
// type four numbers — not that the app changes their balances behind them.
//
// ⚠️ NO MODEL. `@/lib/statement-parse` is a parser over labelled text; see its header for why that
// is his instruction rather than my preference.
//
// ⚠️ UPLOAD AND PASTE ARE TWO DOORS INTO ONE PARSER, not two features. A chosen PDF is turned into
// text by `@/lib/pdf-text` and then dropped into the SAME textarea the person could have pasted
// into — so what they confirm is always text they can see and correct. A reader that went straight
// from a file to a set of figures would be asking them to trust an extraction they never saw.
//
// ⚠️ pdf.js IS LOADED ONLY WHEN A FILE IS PICKED. It is ~350KB in an app that shipped no PDF
// dependency; a dynamic import keeps it out of the main bundle so it costs nothing to everybody who
// never opens this. That is what made the dependency affordable — see `pdf-text.ts`.
import { useMemo, useRef, useState } from 'react';
import { FileText, X, Upload, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { parseStatement, statementPatch, isEmptyParse } from '@/lib/statement-parse';
import { extractPdfText, PdfReadError } from '@/lib/pdf-text';
import { parseStatementPlans } from '@/lib/statement-plans';
import { proposePlanTranches, toTranchePayload, type PlanChange } from '@/lib/statement-plan-tranches';
import { parseTranches } from '@/lib/balance-tranches';
import type { TranchePayload } from '@/lib/tranche-form';

interface CardLike {
  id: string;
  name: string;
  statement_balance?: number | null;
  min_payment?: number | null;
  installment_balance?: number | null;
  installment_monthly_payment?: number | null;
  balance_tranches?: unknown;
  payment_due_day?: number | null;
}

/** The columns Apply writes: the summary figures, plus the plan tranches when a plan changed. */
export type StatementApplyPatch = ReturnType<typeof statementPatch> & { balance_tranches?: TranchePayload[] };

interface Props {
  card: CardLike;
  /** Applies the confirmed columns. Resolves when the write has landed. */
  onApply: (patch: StatementApplyPatch) => Promise<unknown>;
  onClose: () => void;
}

/** One proposed change, with what it is replacing so nothing is swapped silently. */
interface Row {
  key: keyof ReturnType<typeof statementPatch>;
  label: string;
  current: number | null;
  next: number;
}

export function StatementImport({ card, onApply, onClose }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setReadError(null);
    try {
      // Straight into the textarea, deliberately: the person sees exactly what was extracted and
      // can fix it before anything is proposed.
      setText(await extractPdfText(file));
    } catch (e) {
      setReadError(e instanceof PdfReadError ? e.message : 'That file could not be read.');
    } finally {
      setReading(false);
      // Cleared so picking the SAME file again re-runs; without this a retry after an error is
      // silently ignored, which reads as the button being dead.
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const figures = useMemo(() => parseStatement(text), [text]);
  const patch = useMemo(() => statementPatch(figures), [figures]);

  const rows: Row[] = useMemo(() => {
    const current: Record<string, number | null> = {
      statement_balance: card.statement_balance ?? null,
      min_payment: card.min_payment ?? null,
      installment_balance: card.installment_balance ?? null,
      installment_monthly_payment: card.installment_monthly_payment ?? null,
    };
    const labels: Record<string, string> = {
      statement_balance: 'Interest-saving balance',
      min_payment: 'Minimum payment',
      installment_balance: 'In payment plans',
      installment_monthly_payment: 'Plans payment due',
    };
    return (Object.keys(patch) as Row['key'][]).map(key => ({
      key,
      label: labels[key],
      current: current[key],
      next: patch[key] as number,
    }));
  }, [patch, card]);

  // Ask baee397e: the plan tables become the card's tranches. Only plans that would CHANGE count
  // toward Apply; an unchanged plan is listed so the person can see it was read, and written as is.
  const proposal = useMemo(() => {
    const plans = parseStatementPlans(text);
    return plans.length === 0
      ? null
      : proposePlanTranches(parseTranches(card.balance_tranches), plans, card.payment_due_day ?? null);
  }, [text, card.balance_tranches, card.payment_due_day]);
  const planEdits: PlanChange[] = proposal?.changes.filter(c => c.status !== 'unchanged') ?? [];
  const applyCount = rows.length + planEdits.length;

  const nothingFound = text.trim() !== '' && isEmptyParse(figures) && proposal === null;

  const apply = async () => {
    if (applyCount === 0) return;
    setSaving(true);
    try {
      // ONE write, so the figures and the plans cannot land half applied.
      await onApply(planEdits.length > 0 && proposal ? { ...patch, balance_tranches: proposal.next.map(toTranchePayload) } : patch);
      onClose();
    } catch {
      // ⚠️ CAUGHT, AND THE DIALOG STAYS OPEN. The first version had `finally` without `catch`, so a
      // failed write became an unhandled rejection — the test that asserts "stays open when the
      // write fails" passed while the runner reported an error beside it. The account hook already
      // says what went wrong in the user's language; what this must do is not lose the text they
      // pasted, and not report success by closing.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 p-4"
      role="dialog" aria-modal="true" aria-label={`Read a statement for ${card.name}`}>
      <div className="card-forged w-full max-w-md p-5 space-y-3" style={{ borderRadius: 'var(--radius)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold line-clamp-2">Read a statement — {card.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 min-w-[44px] min-h-[44px] -my-3 -mr-3 flex items-center justify-center text-muted-foreground hover:text-foreground btn-press">
            <X size={14} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Upload your statement PDF, or paste its text. Nothing is sent anywhere — it is read here on
          your device, and nothing changes until you press Apply.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          aria-label="Statement PDF"
          onChange={e => void pickFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          className="btn btn-sm btn-ghost w-full"
        >
          {reading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}{' '}
          {reading ? 'Reading your statement…' : 'Choose a PDF'}
        </button>

        {/* Said out loud. A file that could not be read must not look like a file that said nothing. */}
        {readError && <p role="alert" className="text-xs text-destructive-text">{readError}</p>}

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={6}
          aria-label="Statement text"
          placeholder="Paste your statement text here"
          className="w-full bg-secondary border border-border px-3 py-2 text-xs text-foreground font-mono focus:outline-hidden focus:ring-1 focus:ring-ring"
          style={{ borderRadius: 'var(--radius)' }}
        />

        {/* ⚠️ SAID OUT LOUD WHEN NOTHING MATCHED. A silent empty list reads as "there was nothing on
            the statement" rather than "this did not recognise it", and those need different actions
            from the person. */}
        {nothingFound && (
          <p className="text-xs text-muted-foreground italic">
            Nothing recognisable found in that text. Your card is unchanged — check you pasted the
            summary section, or enter the figures yourself.
          </p>
        )}

        {rows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Found on this statement</p>
            {rows.map(r => (
              <div key={r.key}
                className="flex items-center justify-between gap-3 bg-secondary/40 border border-border px-3 py-2"
                style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-xs text-muted-foreground min-w-0 truncate">{r.label}</span>
                <span className="text-xs shrink-0 whitespace-nowrap">
                  {/* BOTH FIGURES, BEFORE THE PRESS — the same rule the ledger link follows. A row
                      that shows only the new number has not said what it is replacing. */}
                  {r.current !== null && (
                    <span className="text-muted-foreground line-through mr-1.5">
                      {formatCurrency(r.current)}
                    </span>
                  )}
                  <span className="font-semibold">{formatCurrency(r.next)}</span>
                </span>
              </div>
            ))}
            {/* Hidden once the plan tables were read: those plans ARE applied, below, so saying promos
                are "not applied automatically" would contradict the list under it. */}
            {figures.promoRates.length > 0 && proposal === null && (
              <p className="text-xs text-muted-foreground">
                Also seen: {figures.promoRates.map(p => `${p.label} at ${p.aprPercent}%`).join(', ')}.
                Promotional rates are not applied automatically.
              </p>
            )}
          </div>
        )}

        {proposal && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Payment plans on this statement</p>
            {proposal.changes.map((c, i) => (
              <div key={`${c.after.id}-${i}`}
                className="flex items-center justify-between gap-3 bg-secondary/40 border border-border px-3 py-2"
                style={{ borderRadius: 'var(--radius)' }}>
                <span className="text-xs min-w-0 truncate">
                  <span className="text-muted-foreground mr-1.5">
                    {c.status === 'new' ? 'New' : c.status === 'update' ? 'Update' : 'Same'}
                  </span>
                  {c.label}
                </span>
                <span className="text-xs shrink-0 whitespace-nowrap">
                  {c.status === 'update' && c.before && (
                    <span className="text-muted-foreground line-through mr-1.5">{formatCurrency(c.before.balance)}</span>
                  )}
                  <span className="font-semibold">{formatCurrency(c.after.balance)}</span>
                  <span className="text-muted-foreground"> · {formatCurrency(c.after.min_payment ?? 0)}/mo</span>
                </span>
              </div>
            ))}
            {proposal.notOnStatement.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Not on this statement, kept as they are: {proposal.notOnStatement.map(t => t.label).join(', ')}.
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => void apply()}
          disabled={applyCount === 0 || saving}
          className="btn btn-md btn-primary w-full"
        >
          {saving ? 'Applying…' : applyCount === 0 ? 'Nothing to apply yet' : planEdits.length === 0
            ? `Apply ${rows.length} ${rows.length === 1 ? 'figure' : 'figures'}`
            : `Apply ${applyCount} ${applyCount === 1 ? 'change' : 'changes'}`}
        </button>
      </div>
    </div>
  );
}
