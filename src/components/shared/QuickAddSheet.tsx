import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X, Delete, Loader2 } from 'lucide-react';
import { useEscapeToClose } from '@/hooks/useEscapeToClose';
import { useTransactions, useAccounts } from '@/hooks/useSupabaseData';
import { CATEGORY_EMOJI } from '@/lib/types';
import CategoryOptions from './CategoryOptions';
import { SegmentedControl } from './SegmentedControl';
import { FIELD_BASE, FIELD_INPUT, FIELD_SELECT } from './field-classes';
import { toLocalDateStr } from '@/lib/scheduling';
import { getCardStartDateViolation } from '@/lib/card-start-date';
import { filterProfanity, LIMITS } from '@/lib/content-filter';
import { buildPaymentSourceOptions } from '@/lib/payment-source-options';
import {
  pressKeypad, keypadValue, formatKeypadAmount, quickAddSaveLabel,
  topExpenseCategories, lastUsedChip, lastUsedPaymentSource, quickAddPayload,
  type KeypadKey,
} from '@/lib/quick-add';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { useDemo } from '@/contexts/DemoContext';
import { recordFunnelStep } from '@/lib/signup-funnel';
import { DEMO_QUICK_ADD_ASK } from '@/lib/demo-signup-ask';

const KEYS: readonly KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * QUICK ADD (ask 661548f5) — Fincend's 5-tap entry, opened from the bottom bar's `+` and from Home.
 *
 * The amount is the hero and is typed on an IN-SHEET keypad, so no OS keyboard opens and covers the
 * form (the full form's `type=number` field did exactly that). Categories are one row of the user's
 * most-used chips, the last-used one already selected; date, account and note are one tap each and
 * none is required. The save button says the amount. `$36 Groceries` from Home is
 * `+`, Groceries, 3, 6, "Add $36" = 5 taps, and 4 when Groceries was the last category used.
 *
 * ⚠️ WRITES THE SAME ROW THE FULL FORM WRITES (`quickAddPayload`), through the same hook, with the
 * same profanity filter and card-start-date guard. It is a faster door to one action, not a second
 * kind of transaction. Repeats stay on the full form: a rule has consequences this sheet does not
 * explain.
 */
export default function QuickAddSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  useEscapeToClose(onClose);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const { data: transactions, add } = useTransactions();
  const { data: accounts } = useAccounts();
  const { isDemo } = useDemo();
  const navigate = useNavigate();
  const sourceOptions = useMemo(() => buildPaymentSourceOptions(accounts), [accounts]);
  const chips = useMemo(() => topExpenseCategories(transactions), [transactions]);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [demoAsk, setDemoAsk] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [date, setDate] = useState(() => toLocalDateStr(new Date()));
  const [source, setSource] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Defaults come from history, which may still be loading when the sheet opens. They apply until
  // the user picks something themselves, and never overwrite a pick.
  const shownCategory = category ?? lastUsedChip(transactions, chips);
  const shownSource = source ?? lastUsedPaymentSource(transactions, sourceOptions);

  const value = keypadValue(amount);
  const saving = add.isPending;

  const save = async () => {
    if (saving || value <= 0) return;
    const { clean, flagged } = filterProfanity(note.trim().slice(0, LIMITS.transactionNote));
    if (flagged) toast.warning('Note contained inappropriate language and was cleaned.');
    const payload = quickAddPayload({ type, amount, category: shownCategory ?? 'Other', date, paymentSource: shownSource, note: clean });
    if (!payload) return;
    const violation = getCardStartDateViolation(payload.date, payload.payment_source, accounts ?? []);
    if (violation) { toast.error(violation); return; }
    // /demo cannot write. Instead of the generic refusal, ask for the signup at the moment the
    // visitor has just used the feature (see demo-signup-ask.ts). INSIDE the sheet, not a toast:
    // a toast rendered under this overlay's scrim, half off the bottom of a 390x844 screen.
    if (isDemo) { setDemoAsk(true); return; }
    try {
      await add.mutateAsync(payload);
    } catch {
      // The hook's onError already said why. The sheet stays open with what they typed.
      return;
    }
    onClose();
  };

  // A hardware keyboard types into the keypad too (desktop, iPad), unless a real field has focus.
  const saveRef = useRef(save);
  useLayoutEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); setAmount(a => pressKeypad(a, e.key as KeypadKey)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setAmount(a => pressKeypad(a, 'back')); }
      else if (e.key === 'Enter' && (t?.tagName !== 'BUTTON')) { e.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const moreValue = shownCategory && !chips.includes(shownCategory as (typeof chips)[number]) ? shownCategory : '';

  return createPortal((
    <div
      className="modal-overlay z-60"
      style={{ touchAction: 'none', background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="quick-add-sheet"
        className="card-forged w-full sm:max-w-sm flex flex-col rounded-(--radius) overflow-y-auto"
        style={{ maxHeight: '100%', touchAction: 'pan-y' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-1 very-short:pt-0 very-short:pb-0 shrink-0">
          <h2 id={titleId} className="font-display font-semibold text-sm">Quick add</h2>
          <button aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={16} /></button>
        </div>

        <div className="px-4 pb-4 space-y-3 very-short:space-y-2">
          <div className="flex justify-center">
            <SegmentedControl
              label="Expense or income"
              size="sm"
              options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
              value={type}
              onSelect={next => setType(next)}
            />
          </div>

          <p
            data-testid="quick-add-amount"
            aria-live="polite"
            className={`text-center font-display font-bold text-4xl very-short:text-3xl tabular-nums leading-tight ${value > 0 ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {type === 'expense' && value > 0 ? '-' : ''}{formatKeypadAmount(amount)}
          </p>

          {type === 'expense' && (
            // ONE ROW that scrolls sideways, not a wrapped block: wrapped, the chips took three rows
            // and pushed "Add $36" below the fold on a 375x667 phone (check:quick-add HEIGHT=667).
            // The app's one pill row (SegmentedControl), so the chips look and announce like every
            // other filter row. A category picked from More joins the row, selected, so the choice is
            // never invisible.
            <div className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5" style={{ scrollbarWidth: 'none', touchAction: 'pan-x' }}>
              <SegmentedControl
                label="Category"
                wrap={false}
                gap="tight"
                options={[...chips, ...(moreValue ? [moreValue] : [])].map(c => ({
                  value: c,
                  label: <span className="flex items-center gap-1"><span aria-hidden="true">{CATEGORY_EMOJI[c]}</span>{c}</span>,
                }))}
                value={shownCategory ?? ''}
                onSelect={c => setCategory(c)}
              />
              <select
                aria-label="More categories"
                value=""
                onChange={e => { if (e.target.value) setCategory(e.target.value); }}
                className={`${FIELD_SELECT} w-auto! shrink-0`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                <option value="" disabled>More…</option>
                <CategoryOptions exclude={['Income']} />
              </select>
            </div>
          )}

          {/* The account gets a row of its own: beside the date it was cut to "North" at 320. */}
          <select
            aria-label={type === 'income' ? 'Deposited to' : 'Paid with'}
            value={shownSource}
            onChange={e => setSource(e.target.value)}
            className={FIELD_INPUT}
            style={{ borderRadius: 'var(--radius)' }}
          >
            <option value="">{type === 'income' ? 'Deposited to…' : 'Paid with…'}</option>
            {sourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Date"
              value={date}
              onChange={e => { if (e.target.value) setDate(e.target.value); }}
              className={`${FIELD_BASE} w-[8.75rem] shrink-0 text-xs text-foreground`}
              style={{ borderRadius: 'var(--radius)' }}
            />
            <input
              type="text"
              aria-label="Note"
              value={note}
              maxLength={LIMITS.transactionNote}
              onChange={e => setNote(e.target.value)}
              placeholder="Note"
              className={`${FIELD_BASE} flex-1 min-w-0 text-xs text-foreground`}
              style={{ borderRadius: 'var(--radius)' }}
            />
          </div>

          {demoAsk ? (
            // Replaces the keypad AND the save button: the visitor is done typing, and at 320x568
            // the ask did not fit in the save button's slot alone (cut off by the sheet's edge).
            <div
              role="status"
              data-testid="demo-signup-ask"
              className="flex flex-col gap-3 border border-primary/40 bg-primary/5 p-4"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <p className="text-sm text-foreground leading-snug">
                <strong>{DEMO_QUICK_ADD_ASK.title}</strong> {DEMO_QUICK_ADD_ASK.description}
              </p>
              <button
                type="button"
                onClick={() => {
                  recordFunnelStep('demo_signup_tap', { detail: DEMO_QUICK_ADD_ASK.funnelDetail });
                  navigate('/auth');
                }}
                className="w-full min-h-[44px] bg-primary text-primary-foreground px-4 text-sm font-semibold btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {DEMO_QUICK_ADD_ASK.action}
              </button>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-3 gap-1.5 very-short:gap-1" role="group" aria-label="Amount keypad">
            {KEYS.map(k => (
              <button
                key={k}
                type="button"
                aria-label={k === 'back' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
                onClick={() => setAmount(a => pressKeypad(a, k))}
                className="h-11 short:h-10 very-short:h-8 bg-secondary border border-border text-lg font-semibold tabular-nums btn-press flex items-center justify-center hover:border-primary/40"
                style={{ borderRadius: 'var(--radius)' }}
              >
                {k === 'back' ? <Delete size={18} /> : k}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void save()}
            disabled={value <= 0 || saving}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold btn-press disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {quickAddSaveLabel(amount)}
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
