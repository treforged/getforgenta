import { useState, useRef } from 'react';
import { ChevronDown, GripVertical, ArrowUp, ArrowDown, Pencil, EyeOff, Eye, Trash2, Plus, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { filterProfanity, isSafeUrl, LIMITS } from '@/lib/content-filter';
import { getCardStartDateViolation, type CardStartDateAccount } from '@/lib/card-start-date';
import type { CarBuildPhase, CarBuildItem } from '@/lib/types';
import type { PaymentPlan } from '@/lib/payment-plan-generator';
import type { TransactionRow } from '@/hooks/useSupabaseData';
import DateScrollPicker from '@/components/shared/DateScrollPicker';

// eslint-disable-next-line react-refresh/only-export-components -- small shared constant, not worth a separate file
export const PHASE_COLORS = [
  '#c8a84b', '#ba4a4a', '#4a8cba', '#8a5ba3', '#3a8a5a',
  '#c87a3a', '#8aaa3a', '#5a7ab8', '#c84b8a', '#4bb8c8',
  '#c84b4b', '#7ab85a', '#b8a84b', '#7a5ab8', '#4ba8b8',
];

function itemLabel(phaseIndex: number, itemIndex: number, total: number): string {
  if (total === 1) return String(phaseIndex + 1);
  return `${phaseIndex + 1}${String.fromCharCode(97 + itemIndex)}`;
}

type LinkMode = 'none' | 'transaction' | 'plan';
type PlanFreq = 'weekly' | 'biweekly' | 'monthly';

interface ItemEditState {
  name: string;
  brand: string;
  price: string;
  link: string;
  moveToPhaseId: string;
  // financing
  linkMode: LinkMode;
  // transaction
  linkedTransactionId: string;
  txDate: string;
  txAmount: string;
  txNote: string;
  txPaymentSource: string;
  isNewTransaction: boolean;
  // plan
  linkedPlanId: string;
  isNewPlan: boolean;
  newPlanName: string;
  newPlanTotal: string;
  newPlanPayment: string;
  newPlanFrequency: PlanFreq;
  newPlanStartDate: string;
  newPlanTotalPayments: string;
  newPlanPaymentSource: string;
}

interface PhaseBlockProps {
  phase: CarBuildPhase;
  phaseIndex: number;
  items: CarBuildItem[];
  allPhases: CarBuildPhase[];
  isTouch: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dragItemId: string | null;
  dragOverItemId: string | null;
  itemDropBelow: boolean;
  onUpdatePhase: (id: string, data: Partial<CarBuildPhase>) => void;
  onDeletePhase: (id: string) => void;
  onAddItem: (phaseId: string, buildId: string) => Promise<string | null>;
  onUpdateItem: (id: string, data: Partial<CarBuildItem & { phase_id?: string }>) => void;
  onDeleteItem: (id: string) => void;
  onToggleItem: (id: string, completed: boolean) => void;
  onMovePhase: (direction: 'up' | 'down') => void;
  onMoveItemArrow: (itemId: string, phaseId: string, direction: 'up' | 'down') => void;
  onPhaseDragStart: (e: React.DragEvent, phaseId: string) => void;
  onPhaseDragOver: (e: React.DragEvent, phaseId: string) => void;
  onPhaseDragEnd: () => void;
  onPhaseDrop: (e: React.DragEvent, phaseId: string) => void;
  isExpanded: boolean;
  onSetExpanded: (val: boolean) => void;
  onItemDragEnterPhase: (phaseId: string) => void;
  onItemDragStart: (e: React.DragEvent, itemId: string) => void;
  onItemDragOver: (e: React.DragEvent, itemId: string, phaseId: string) => void;
  onItemDragEnd: () => void;
  onItemDrop: (e: React.DragEvent, itemId: string, phaseId: string) => void;
  onItemDropAtEnd: (e: React.DragEvent, phaseId: string) => void;
  paymentPlans: PaymentPlan[];
  transactions: TransactionRow[];
  accounts: CardStartDateAccount[];
  paymentSourceOptions: { value: string; label: string }[];
  onLinkTransaction: (itemId: string, prevTxId: string | null, newTxId: string | null) => Promise<void>;
  onCreateTransactionForItem: (itemId: string, prevTxId: string | null, tx: { date: string; amount: number; note: string; payment_source?: string }) => Promise<void>;
  onUpdateLinkedTransaction: (txId: string, updates: { date: string; amount: number; payment_source?: string }) => Promise<void>;
  onCreatePlanForItem: (itemId: string, plan: Omit<PaymentPlan, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
}

export default function PhaseBlock({
  phase, phaseIndex, items, allPhases, isTouch,
  isFirst, isLast, isDragging, isDragOver, dragItemId, dragOverItemId, itemDropBelow,
  onUpdatePhase, onDeletePhase, onAddItem, onUpdateItem, onDeleteItem, onToggleItem,
  onMovePhase, onMoveItemArrow,
  onPhaseDragStart, onPhaseDragOver, onPhaseDragEnd, onPhaseDrop,
  onItemDragEnterPhase,
  onItemDragStart, onItemDragOver, onItemDragEnd, onItemDrop, onItemDropAtEnd,
  isExpanded, onSetExpanded,
  paymentPlans, transactions, accounts, paymentSourceOptions,
  onLinkTransaction, onCreateTransactionForItem, onUpdateLinkedTransaction, onCreatePlanForItem,
}: PhaseBlockProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(phase.title);
  const [openItemEdit, setOpenItemEdit] = useState<string | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEditState>>({});
  const [dragOverBottom, setDragOverBottom] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const color = PHASE_COLORS[phaseIndex % PHASE_COLORS.length];
  const doneCount = items.filter(it => it.completed).length;
  const allDone = items.length > 0 && doneCount === items.length;
  const phaseTotal = items.reduce((s, it) => s + (it.price ?? 0), 0);
  const subtitle = doneCount > 0
    ? `${doneCount} / ${items.length} complete`
    : `${items.length} item${items.length !== 1 ? 's' : ''}`;

  function openTitleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setTitleInput(phase.title);
    setEditingTitle(true);
    setTimeout(() => titleRef.current?.select(), 0);
  }

  function saveTitleEdit() {
    const raw = titleInput.trim().slice(0, LIMITS.phaseTitle);
    if (!raw) return;
    const { clean, flagged } = filterProfanity(raw);
    if (flagged) toast.warning('Phase title contained inappropriate language and was cleaned.');
    if (clean !== phase.title) onUpdatePhase(phase.id, { title: clean });
    setEditingTitle(false);
  }

  function openItemEditPanel(item: CarBuildItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (openItemEdit === item.id) { setOpenItemEdit(null); return; }
    const linkedTx = transactions.find(t => t.car_build_item_id === item.id);
    const today = new Date().toISOString().split('T')[0];
    const mode: LinkMode = linkedTx ? 'transaction' : (item.payment_plan_id ? 'plan' : 'none');
    setItemEdits(prev => ({
      ...prev,
      [item.id]: {
        name: item.name,
        brand: item.brand ?? '',
        price: item.price !== null ? String(item.price) : '',
        link: item.link ?? '',
        moveToPhaseId: item.phase_id,
        linkMode: mode,
        linkedTransactionId: linkedTx?.id ?? '',
        txDate: linkedTx?.date ?? today,
        txAmount: linkedTx ? String(linkedTx.amount) : (item.price !== null ? String(item.price) : ''),
        txNote: linkedTx?.note ?? item.name,
        txPaymentSource: linkedTx?.payment_source ?? '',
        isNewTransaction: false,
        linkedPlanId: item.payment_plan_id ?? '',
        isNewPlan: false,
        newPlanName: item.name,
        newPlanTotal: item.price !== null ? String(item.price) : '',
        newPlanPayment: '',
        newPlanFrequency: 'monthly',
        newPlanStartDate: today,
        newPlanTotalPayments: '4',
        newPlanPaymentSource: '',
      },
    }));
    setOpenItemEdit(item.id);
  }

  async function saveItemEdit(item: CarBuildItem) {
    const ed = itemEdits[item.id];
    if (!ed) return;

    const urlCheck = isSafeUrl(ed.link);
    if (!urlCheck.safe) { toast.error(urlCheck.reason ?? 'Link not allowed'); return; }

    const nameResult = filterProfanity(ed.name.trim().slice(0, LIMITS.itemName));
    const brandResult = filterProfanity(ed.brand.trim().slice(0, LIMITS.itemBrand));
    if (nameResult.flagged) toast.warning('Item name contained inappropriate language and was cleaned.');
    if (brandResult.flagged) toast.warning('Description contained inappropriate language and was cleaned.');

    const parsedPrice = ed.price.trim() ? parseFloat(ed.price) : null;
    const updates: Partial<CarBuildItem & { phase_id?: string }> = {
      name: nameResult.clean || item.name,
      brand: brandResult.clean || null,
      price: parsedPrice !== null && !isNaN(parsedPrice) ? parsedPrice : null,
      link: ed.link.trim() ? ed.link.trim().slice(0, LIMITS.itemLink) : null,
    };
    if (ed.moveToPhaseId !== item.phase_id) updates.phase_id = ed.moveToPhaseId;

    const prevLinkedTx = transactions.find(t => t.car_build_item_id === item.id);
    const prevTxId = prevLinkedTx?.id ?? null;

    setSavingItemId(item.id);
    try {
      if (ed.linkMode === 'none') {
        updates.payment_plan_id = null;
        if (prevTxId) await onLinkTransaction(item.id, prevTxId, null);

      } else if (ed.linkMode === 'transaction') {
        updates.payment_plan_id = null;
        if (ed.isNewTransaction) {
          const amount = parseFloat(ed.txAmount);
          if (!ed.txDate || isNaN(amount) || amount <= 0) {
            toast.error('Date and amount are required');
            return;
          }
          const txViolation = getCardStartDateViolation(ed.txDate, ed.txPaymentSource, accounts);
          if (txViolation) { toast.error(txViolation); return; }
          await onCreateTransactionForItem(item.id, prevTxId, { date: ed.txDate, amount, note: ed.txNote, payment_source: ed.txPaymentSource || undefined });
        } else if (ed.linkedTransactionId) {
          const amount = parseFloat(ed.txAmount);
          if (ed.txDate && !isNaN(amount) && amount > 0) {
            const linkViolation = getCardStartDateViolation(ed.txDate, ed.txPaymentSource, accounts);
            if (linkViolation) { toast.error(linkViolation); return; }
            await onUpdateLinkedTransaction(ed.linkedTransactionId, { date: ed.txDate, amount, payment_source: ed.txPaymentSource || undefined });
          }
          if (ed.linkedTransactionId !== prevTxId) {
            await onLinkTransaction(item.id, prevTxId, ed.linkedTransactionId);
          }
        }

      } else if (ed.linkMode === 'plan') {
        if (prevTxId) await onLinkTransaction(item.id, prevTxId, null);
        if (ed.isNewPlan) {
          const total = parseFloat(ed.newPlanTotal);
          const payment = parseFloat(ed.newPlanPayment);
          const totalPmts = parseInt(ed.newPlanTotalPayments, 10);
          if (!ed.newPlanName || isNaN(total) || isNaN(payment) || isNaN(totalPmts) || totalPmts <= 0) {
            toast.error('Fill in all payment plan fields');
            return;
          }
          const planViolation = getCardStartDateViolation(ed.newPlanStartDate, ed.newPlanPaymentSource, accounts);
          if (planViolation) { toast.error(planViolation); return; }
          await onCreatePlanForItem(item.id, {
            name: ed.newPlanName,
            provider: null,
            total_amount: total,
            payment_amount: payment,
            frequency: ed.newPlanFrequency,
            start_date: ed.newPlanStartDate,
            total_payments: totalPmts,
            category: 'Car',
            payment_source: ed.newPlanPaymentSource || null,
            plan_type: 'upfront',
            notes: null,
            active: true,
          });
        } else if (ed.linkedPlanId) {
          updates.payment_plan_id = ed.linkedPlanId;
        }
      }

      onUpdateItem(item.id, updates);
      setOpenItemEdit(null);
    } finally {
      setSavingItemId(null);
    }
  }

  function updateItemEdit<K extends keyof ItemEditState>(itemId: string, field: K, value: ItemEditState[K]) {
    setItemEdits(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  }

  function setFinancingField(itemId: string, fields: Partial<ItemEditState>) {
    setItemEdits(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...fields } }));
  }

  const inputCls = 'w-full bg-secondary border border-border text-foreground text-sm px-3 py-[5px] rounded focus:outline-hidden focus:border-primary font-sans';
  const monoInput = 'w-full bg-secondary border border-border text-foreground text-sm px-3 py-[5px] rounded focus:outline-hidden focus:border-primary font-mono';
  const labelCls = 'block text-[11px] font-mono text-muted-foreground uppercase tracking-widest mb-1';
  const modeBtnCls = (active: boolean) => cn(
    'px-2.5 py-[3px] text-[10px] font-mono uppercase tracking-wider rounded border transition-colors',
    active ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground',
  );

  return (
    <div
      className={cn(
        'border border-border rounded overflow-hidden mb-2 transition-all duration-150',
        phase.hidden && 'opacity-80',
        isDragging && 'opacity-40',
        isDragOver && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
      )}
      onDragOver={e => !isTouch && onPhaseDragOver(e, phase.id)}
      onDrop={e => !isTouch && onPhaseDrop(e, phase.id)}
      onDragEnter={e => {
        if (!isTouch && dragItemId && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onItemDragEnterPhase(phase.id);
        }
      }}
    >
      {/* Phase Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-card cursor-pointer hover:bg-card/80 select-none"
        onClick={() => onSetExpanded(!isExpanded)}
      >
        {!isTouch ? (
          <div
            draggable
            onDragStart={e => onPhaseDragStart(e, phase.id)}
            onDragEnd={onPhaseDragEnd}
            onClick={e => e.stopPropagation()}
            className="cursor-grab text-muted-foreground opacity-30 hover:opacity-70 shrink-0"
            title="Drag to reorder"
          >
            <GripVertical size={16} />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
            <button disabled={isFirst} onClick={() => onMovePhase('up')} className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"><ArrowUp size={12} /></button>
            <button disabled={isLast} onClick={() => onMovePhase('down')} className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"><ArrowDown size={12} /></button>
          </div>
        )}

        <div className="text-2xl font-display font-bold leading-none shrink-0" style={{ color }}>
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 mb-0.5 align-middle" style={{ background: color }} />
          {phaseIndex + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 min-w-0">
            <button onClick={openTitleEdit} className="text-muted-foreground opacity-40 hover:opacity-100 hover:text-primary transition-all shrink-0 mt-0.5" title="Rename phase">
              <Pencil size={12} />
            </button>
            <span className="text-sm font-semibold uppercase tracking-wide text-foreground wrap-break-word flex-1 min-w-0">{phase.title}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {allDone && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0" style={{ color: 'hsl(var(--success))', borderColor: 'hsl(var(--success))' }}>✓ Done</span>
            )}
            <span className="text-[12px] font-mono text-muted-foreground">{phase.hidden ? `planned · ${subtitle}` : subtitle}</span>
          </div>
        </div>

        <div className="font-mono text-base font-medium text-right shrink-0" style={{ color: 'hsl(var(--primary))' }}>
          {phaseTotal > 0 ? `$${phaseTotal.toLocaleString()}` : <span className="text-[13px] text-muted-foreground">TBD</span>}
        </div>

        <button onClick={e => { e.stopPropagation(); onUpdatePhase(phase.id, { hidden: !phase.hidden }); }} title={phase.hidden ? 'Phase hidden (planned) — click to show' : 'Hide phase (mark as planned)'} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          {phase.hidden ? <EyeOff size={14} style={{ color: 'hsl(var(--primary))' }} /> : <Eye size={14} />}
        </button>

        <button onClick={e => { e.stopPropagation(); onDeletePhase(phase.id); }} title="Delete phase" className="shrink-0 text-muted-foreground opacity-35 hover:opacity-100 hover:text-destructive transition-all">
          <Trash2 size={13} />
        </button>

        <ChevronDown size={14} className={cn('shrink-0 text-muted-foreground transition-transform duration-200', isExpanded && 'rotate-180')} />
      </div>

      {/* Inline title edit */}
      {editingTitle && (
        <div className="bg-card border-t border-border px-4 py-3" onClick={e => e.stopPropagation()}>
          <label className={labelCls}>Phase Title</label>
          <input
            ref={titleRef}
            className={inputCls}
            value={titleInput}
            onChange={e => setTitleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitle(false); }}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={saveTitleEdit} className="px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider rounded" style={{ background: 'hsl(var(--primary))', color: '#000' }}>Save</button>
            <button onClick={() => setEditingTitle(false)} className="px-3 py-1 text-[11px] font-mono text-muted-foreground border border-border rounded hover:border-muted-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* Items list */}
      {isExpanded && (
        <div className="border-t border-border">
          {items.map((item, ii) => {
            const isItemTarget = dragOverItemId === item.id && !isTouch;
            const linkedTx = transactions.find(t => t.car_build_item_id === item.id);
            const linkedPlan = item.payment_plan_id ? paymentPlans.find(p => p.id === item.payment_plan_id) : null;
            return (
              <div key={item.id}>
                {isItemTarget && !itemDropBelow && (
                  <div className="h-0.5 rounded mx-4" style={{ background: 'hsl(var(--primary))' }} />
                )}

                {/* Item Row */}
                <div
                  className={cn(
                    'flex items-start gap-2.5 px-4 py-3 border-b border-border hover:bg-accent transition-colors',
                    item.completed && 'opacity-50',
                    dragItemId === item.id && 'opacity-40',
                  )}
                  onDragOver={e => !isTouch && onItemDragOver(e, item.id, phase.id)}
                  onDrop={e => !isTouch && onItemDrop(e, item.id, phase.id)}
                >
                  {!isTouch ? (
                    <div draggable onDragStart={e => onItemDragStart(e, item.id)} onDragEnd={onItemDragEnd} onClick={e => e.stopPropagation()} className="cursor-grab text-muted-foreground opacity-30 hover:opacity-70 shrink-0" title="Drag to reorder">
                      <GripVertical size={14} />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button disabled={ii === 0} onClick={() => onMoveItemArrow(item.id, phase.id, 'up')} className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"><ArrowUp size={10} /></button>
                      <button disabled={ii === items.length - 1} onClick={() => onMoveItemArrow(item.id, phase.id, 'down')} className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"><ArrowDown size={10} /></button>
                    </div>
                  )}

                  <button
                    onClick={() => onToggleItem(item.id, !item.completed)}
                    className={cn(
                      'w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-200 mt-0.5',
                      item.completed ? 'border-success bg-success text-white' : 'border-border bg-transparent hover:border-success',
                    )}
                  >
                    {item.completed && <Check size={11} strokeWidth={3} />}
                  </button>

                  <div className="text-[13px] font-mono text-muted-foreground shrink-0 w-7 text-center mt-0.5">
                    {itemLabel(phaseIndex, ii, items.length)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm text-foreground leading-snug wrap-break-word', item.completed && 'line-through')}>
                      {item.name}
                    </div>
                    {item.brand && (
                      <div className="text-[12px] font-mono text-muted-foreground mt-0.5 wrap-break-word">{item.brand}</div>
                    )}
                    {(linkedPlan || linkedTx) && (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {linkedPlan && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-primary/40 text-primary/80">
                            {linkedPlan.name}
                          </span>
                        )}
                        {linkedTx && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-success/40 text-success/80">
                            ✓ ${Number(linkedTx.amount).toLocaleString()} · {linkedTx.date}
                          </span>
                        )}
                      </div>
                    )}
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono mt-0.5 transition-colors hover:underline" style={{ color: 'hsl(var(--primary))' }} onClick={e => e.stopPropagation()}>
                        <ExternalLink size={10} /> VIEW LISTING
                      </a>
                    )}
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    {item.price !== null
                      ? <span className="font-mono text-sm text-foreground">${item.price.toLocaleString()}</span>
                      : <span className="font-mono text-[12px] text-muted-foreground">TBD</span>
                    }
                    <button onClick={e => openItemEditPanel(item, e)} className="text-[11px] font-mono px-2 py-0.5 border border-border rounded text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      EDIT
                    </button>
                  </div>

                  <button onClick={() => onDeleteItem(item.id)} className="shrink-0 text-muted-foreground opacity-35 hover:opacity-100 hover:text-destructive transition-all ml-0.5">
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* Inline item edit panel */}
                {openItemEdit === item.id && itemEdits[item.id] && (
                  <div className="bg-card border-b border-border px-4 py-3 pl-18" onClick={e => e.stopPropagation()}>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                      {/* Left column */}
                      <div className="space-y-2.5">
                        <div>
                          <label className={labelCls}>Item Name</label>
                          <input
                            className={inputCls}
                            value={itemEdits[item.id].name}
                            maxLength={LIMITS.itemName}
                            onChange={e => updateItemEdit(item.id, 'name', e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') setOpenItemEdit(null); }}
                            autoFocus
                          />
                          <span className="text-[10px] text-muted-foreground text-right block mt-0.5">{itemEdits[item.id].name.length}/{LIMITS.itemName}</span>
                        </div>
                        <div>
                          <label className={labelCls}>Brand / Description</label>
                          <input
                            className={inputCls}
                            value={itemEdits[item.id].brand}
                            maxLength={LIMITS.itemBrand}
                            onChange={e => updateItemEdit(item.id, 'brand', e.target.value)}
                          />
                          <span className="text-[10px] text-muted-foreground text-right block mt-0.5">{itemEdits[item.id].brand.length}/{LIMITS.itemBrand}</span>
                        </div>
                        <div>
                          <label className={labelCls}>Product Link (URL)</label>
                          <input
                            className={monoInput}
                            type="url"
                            value={itemEdits[item.id].link}
                            maxLength={LIMITS.itemLink}
                            onChange={e => updateItemEdit(item.id, 'link', e.target.value)}
                            placeholder="https://..."
                            style={{ color: 'hsl(var(--primary))', borderColor: !isSafeUrl(itemEdits[item.id].link).safe ? 'hsl(var(--destructive))' : undefined }}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Move to Phase</label>
                          <select className={inputCls} value={itemEdits[item.id].moveToPhaseId} onChange={e => updateItemEdit(item.id, 'moveToPhaseId', e.target.value)}>
                            {allPhases.map((ph, i) => (
                              <option key={ph.id} value={ph.id}>{i + 1}. {ph.title}</option>
                            ))}
                          </select>
                        </div>

                        {/* ── Financing section ─────────────────────────── */}
                        <div className="pt-1 border-t border-border">
                          <label className={labelCls}>Financing</label>
                          <div className="flex gap-1 mb-2">
                            {(['none', 'transaction', 'plan'] as LinkMode[]).map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setFinancingField(item.id, { linkMode: m })}
                                className={modeBtnCls(itemEdits[item.id].linkMode === m)}
                              >
                                {m === 'none' ? 'None' : m === 'transaction' ? 'Transaction' : 'Plan'}
                              </button>
                            ))}
                          </div>

                          {/* Transaction mode */}
                          {itemEdits[item.id].linkMode === 'transaction' && (
                            <div className="space-y-2">
                              <div className="flex gap-1.5 mb-1.5">
                                <button type="button" className={modeBtnCls(!itemEdits[item.id].isNewTransaction)} onClick={() => setFinancingField(item.id, { isNewTransaction: false })}>Existing</button>
                                <button type="button" className={modeBtnCls(itemEdits[item.id].isNewTransaction)} onClick={() => setFinancingField(item.id, { isNewTransaction: true, linkedTransactionId: '' })}>＋ New</button>
                              </div>

                              {!itemEdits[item.id].isNewTransaction ? (
                                <>
                                  <select
                                    className={inputCls}
                                    value={itemEdits[item.id].linkedTransactionId}
                                    onChange={e => {
                                      const txId = e.target.value;
                                      const tx = transactions.find(t => t.id === txId);
                                      setFinancingField(item.id, {
                                        linkedTransactionId: txId,
                                        txDate: tx?.date ?? itemEdits[item.id].txDate,
                                        txAmount: tx ? String(tx.amount) : itemEdits[item.id].txAmount,
                                        txPaymentSource: tx?.payment_source ?? itemEdits[item.id].txPaymentSource,
                                      });
                                    }}
                                  >
                                    <option value="">Select transaction…</option>
                                    {transactions
                                      .filter(t => t.type === 'expense')
                                      .slice(0, 100)
                                      .map(t => (
                                        <option key={t.id} value={t.id}>
                                          {t.date} · ${Number(t.amount).toLocaleString()} · {t.note || t.category}
                                        </option>
                                      ))}
                                  </select>
                                  {itemEdits[item.id].linkedTransactionId && (
                                    <div className="space-y-2">
                                      <div>
                                        <label className={labelCls}>Date</label>
                                        <DateScrollPicker value={itemEdits[item.id].txDate} onChange={v => updateItemEdit(item.id, 'txDate', v)} />
                                      </div>
                                      <div>
                                        <label className={labelCls}>Amount ($)</label>
                                        <input type="number" className={`${inputCls} text-right`} value={itemEdits[item.id].txAmount} onChange={e => updateItemEdit(item.id, 'txAmount', e.target.value)} min="0" step="0.01" />
                                      </div>
                                      <div>
                                        <label className={labelCls}>Payment Method</label>
                                        <select className={inputCls} value={itemEdits[item.id].txPaymentSource} onChange={e => updateItemEdit(item.id, 'txPaymentSource', e.target.value)}>
                                          <option value="">Unassigned</option>
                                          {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="space-y-2">
                                  <div>
                                    <label className={labelCls}>Date</label>
                                    <DateScrollPicker value={itemEdits[item.id].txDate} onChange={v => updateItemEdit(item.id, 'txDate', v)} />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Amount ($)</label>
                                    <input type="number" className={`${inputCls} text-right`} value={itemEdits[item.id].txAmount} onChange={e => updateItemEdit(item.id, 'txAmount', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Payment Method</label>
                                    <select className={inputCls} value={itemEdits[item.id].txPaymentSource} onChange={e => updateItemEdit(item.id, 'txPaymentSource', e.target.value)}>
                                      <option value="">Unassigned</option>
                                      {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className={labelCls}>Note (optional)</label>
                                    <input className={inputCls} value={itemEdits[item.id].txNote} onChange={e => updateItemEdit(item.id, 'txNote', e.target.value)} placeholder="e.g. Bought from Summit Racing" />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Plan mode */}
                          {itemEdits[item.id].linkMode === 'plan' && (
                            <div className="space-y-2">
                              <div className="flex gap-1.5 mb-1.5">
                                <button type="button" className={modeBtnCls(!itemEdits[item.id].isNewPlan)} onClick={() => setFinancingField(item.id, { isNewPlan: false })}>Existing</button>
                                <button type="button" className={modeBtnCls(itemEdits[item.id].isNewPlan)} onClick={() => setFinancingField(item.id, { isNewPlan: true, linkedPlanId: '' })}>＋ New</button>
                              </div>

                              {!itemEdits[item.id].isNewPlan ? (
                                <select
                                  className={inputCls}
                                  value={itemEdits[item.id].linkedPlanId}
                                  onChange={e => updateItemEdit(item.id, 'linkedPlanId', e.target.value)}
                                >
                                  <option value="">Select plan…</option>
                                  {paymentPlans.filter(p => p.active).map(p => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} — ${p.total_amount.toLocaleString()} ({p.total_payments}× ${p.payment_amount})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="space-y-2">
                                  <div>
                                    <label className={labelCls}>Plan Name</label>
                                    <input className={inputCls} value={itemEdits[item.id].newPlanName} onChange={e => updateItemEdit(item.id, 'newPlanName', e.target.value)} placeholder="e.g. Exhaust system" />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className={labelCls}>Total ($)</label>
                                      <input type="number" className={`${inputCls} text-right`} value={itemEdits[item.id].newPlanTotal} onChange={e => updateItemEdit(item.id, 'newPlanTotal', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                                    </div>
                                    <div>
                                      <label className={labelCls}>Payment ($)</label>
                                      <input type="number" className={`${inputCls} text-right`} value={itemEdits[item.id].newPlanPayment} onChange={e => updateItemEdit(item.id, 'newPlanPayment', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                                    </div>
                                  </div>
                                  <div>
                                    <label className={labelCls}>Frequency</label>
                                    <select className={inputCls} value={itemEdits[item.id].newPlanFrequency} onChange={e => updateItemEdit(item.id, 'newPlanFrequency', e.target.value as PlanFreq)}>
                                      <option value="weekly">Weekly</option>
                                      <option value="biweekly">Biweekly</option>
                                      <option value="monthly">Monthly</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className={labelCls}>Start Date</label>
                                    <DateScrollPicker value={itemEdits[item.id].newPlanStartDate} onChange={v => updateItemEdit(item.id, 'newPlanStartDate', v)} />
                                  </div>
                                  <div>
                                    <label className={labelCls}># Payments</label>
                                    <input type="number" className={inputCls} value={itemEdits[item.id].newPlanTotalPayments} onChange={e => updateItemEdit(item.id, 'newPlanTotalPayments', e.target.value)} placeholder="4" min="1" step="1" />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Payment Method</label>
                                    <select className={inputCls} value={itemEdits[item.id].newPlanPaymentSource} onChange={e => updateItemEdit(item.id, 'newPlanPaymentSource', e.target.value)}>
                                      <option value="">Unassigned</option>
                                      {paymentSourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {/* ── end Financing ─────────────────────────────── */}
                      </div>

                      {/* Right column — Price */}
                      <div>
                        <label className={labelCls}>Price ($)</label>
                        <input
                          className={`${inputCls} text-right`}
                          type="number"
                          value={itemEdits[item.id].price}
                          onChange={e => updateItemEdit(item.id, 'price', e.target.value)}
                          placeholder="TBD"
                          min="0"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { void saveItemEdit(item); }}
                        disabled={savingItemId === item.id}
                        className="px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider rounded disabled:opacity-40"
                        style={{ background: 'hsl(var(--primary))', color: '#000' }}
                      >
                        {savingItemId === item.id ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setOpenItemEdit(null)} className="px-3 py-1 text-[11px] font-mono text-muted-foreground border border-border rounded hover:border-muted-foreground transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isItemTarget && itemDropBelow && (
                  <div className="h-0.5 rounded mx-4" style={{ background: 'hsl(var(--primary))' }} />
                )}
              </div>
            );
          })}

          {/* Bottom drop zone */}
          {!isTouch && dragItemId && (
            <div
              className="h-4 w-full"
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverBottom(true); }}
              onDragLeave={() => setDragOverBottom(false)}
              onDrop={e => { setDragOverBottom(false); onItemDropAtEnd(e, phase.id); }}
            >
              {dragOverBottom && (
                <div className="h-0.5 rounded mx-4 mt-1.5" style={{ background: 'hsl(var(--primary))' }} />
              )}
            </div>
          )}

          {/* Add item button */}
          <button
            onClick={async () => {
              if (!isExpanded) onSetExpanded(true);
              const newId = await onAddItem(phase.id, phase.build_id);
              if (!newId) return;
              const today = new Date().toISOString().split('T')[0];
              setItemEdits(prev => ({
                ...prev,
                [newId]: {
                  name: 'New Item', brand: '', price: '', link: '',
                  moveToPhaseId: phase.id,
                  linkMode: 'none',
                  linkedTransactionId: '', txDate: today, txAmount: '', txNote: '', isNewTransaction: false,
                  txPaymentSource: '',
                  linkedPlanId: '', isNewPlan: false,
                  newPlanName: 'New Item', newPlanTotal: '', newPlanPayment: '',
                  newPlanFrequency: 'monthly', newPlanStartDate: today, newPlanTotalPayments: '4',
                  newPlanPaymentSource: '',
                },
              }));
              setOpenItemEdit(newId);
            }}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-[12px] font-mono uppercase tracking-widest text-muted-foreground hover:text-primary hover:bg-accent transition-colors border-t border-dashed border-border"
          >
            <Plus size={14} /> Add Item
          </button>
        </div>
      )}
    </div>
  );
}
