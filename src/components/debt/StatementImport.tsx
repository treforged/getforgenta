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
// ⚠️ PASTE, NOT PDF UPLOAD, AND THE GAP IS NAMED RATHER THAN PAPERED OVER. He asked for "add or
// upload". Reading a PDF in the browser needs a new dependency (pdf.js, ~350KB) in an app that
// currently ships none, which is a decision worth taking deliberately rather than as a side effect
// of this slice. Pasting the text works today, needs nothing, and exercises the same parser the
// upload path would use — so the upload becomes a different way IN, not a different feature.
import { useMemo, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { parseStatement, statementPatch, isEmptyParse } from '@/lib/statement-parse';

interface CardLike {
  id: string;
  name: string;
  statement_balance?: number | null;
  min_payment?: number | null;
  installment_balance?: number | null;
  installment_monthly_payment?: number | null;
}

interface Props {
  card: CardLike;
  /** Applies the confirmed columns. Resolves when the write has landed. */
  onApply: (patch: ReturnType<typeof statementPatch>) => Promise<unknown>;
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

  const nothingFound = text.trim() !== '' && isEmptyParse(figures);

  const apply = async () => {
    if (rows.length === 0) return;
    setSaving(true);
    try {
      await onApply(patch);
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
            <h2 className="text-sm font-semibold truncate">Read a statement — {card.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-muted-foreground hover:text-foreground btn-press">
            <X size={14} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Paste the text of your statement. Nothing is sent anywhere — it is read here on your device,
          and nothing changes until you press Apply.
        </p>

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
            {figures.promoRates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Also seen: {figures.promoRates.map(p => `${p.label} at ${p.aprPercent}%`).join(', ')}.
                Promotional rates are not applied automatically.
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => void apply()}
          disabled={rows.length === 0 || saving}
          className="btn btn-md btn-primary w-full"
        >
          {saving ? 'Applying…' : rows.length === 0 ? 'Nothing to apply yet' : `Apply ${rows.length} ${rows.length === 1 ? 'figure' : 'figures'}`}
        </button>
      </div>
    </div>
  );
}
