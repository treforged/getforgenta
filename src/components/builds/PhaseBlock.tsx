import { useState, useRef } from 'react';
import { ChevronDown, GripVertical, ArrowUp, ArrowDown, Pencil, EyeOff, Eye, Trash2, Plus, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { CarBuildPhase, CarBuildItem } from '@/lib/types';

function isValidUrl(val: string): boolean {
  if (!val.trim()) return true;
  try {
    const u = new URL(val.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const PHASE_COLORS = [
  '#c8a84b', '#ba4a4a', '#4a8cba', '#8a5ba3', '#3a8a5a',
  '#c87a3a', '#8aaa3a', '#5a7ab8', '#c84b8a', '#4bb8c8',
  '#c84b4b', '#7ab85a', '#b8a84b', '#7a5ab8', '#4ba8b8',
];

function itemLabel(phaseIndex: number, itemIndex: number, total: number): string {
  if (total === 1) return String(phaseIndex + 1);
  return `${phaseIndex + 1}${String.fromCharCode(97 + itemIndex)}`;
}

interface ItemEditState {
  name: string;
  brand: string;
  price: string;
  link: string;
  moveToPhaseId: string;
}

interface PhaseBlockProps {
  phase: CarBuildPhase;
  phaseIndex: number;
  items: CarBuildItem[];
  allPhases: CarBuildPhase[];
  isMobile: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dragItemId: string | null;
  dragOverItemId: string | null;
  itemDropBelow: boolean;
  onUpdatePhase: (id: string, data: Partial<CarBuildPhase>) => void;
  onDeletePhase: (id: string) => void;
  onAddItem: (phaseId: string, buildId: string) => void;
  onUpdateItem: (id: string, data: Partial<CarBuildItem & { phase_id?: string }>) => void;
  onDeleteItem: (id: string) => void;
  onToggleItem: (id: string, completed: boolean) => void;
  onMovePhase: (direction: 'up' | 'down') => void;
  onMoveItemArrow: (itemId: string, phaseId: string, direction: 'up' | 'down') => void;
  onPhaseDragStart: (e: React.DragEvent, phaseId: string) => void;
  onPhaseDragOver: (e: React.DragEvent, phaseId: string) => void;
  onPhaseDragEnd: () => void;
  onPhaseDrop: (e: React.DragEvent, phaseId: string) => void;
  onItemDragStart: (e: React.DragEvent, itemId: string) => void;
  onItemDragOver: (e: React.DragEvent, itemId: string, phaseId: string) => void;
  onItemDragEnd: () => void;
  onItemDrop: (e: React.DragEvent, itemId: string, phaseId: string) => void;
}

export default function PhaseBlock({
  phase, phaseIndex, items, allPhases, isMobile,
  isFirst, isLast, isDragging, isDragOver, dragItemId, dragOverItemId, itemDropBelow,
  onUpdatePhase, onDeletePhase, onAddItem, onUpdateItem, onDeleteItem, onToggleItem,
  onMovePhase, onMoveItemArrow,
  onPhaseDragStart, onPhaseDragOver, onPhaseDragEnd, onPhaseDrop,
  onItemDragStart, onItemDragOver, onItemDragEnd, onItemDrop,
}: PhaseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(phase.title);
  const [openItemEdit, setOpenItemEdit] = useState<string | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEditState>>({});
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
    const t = titleInput.trim();
    if (!t) return;
    if (t !== phase.title) onUpdatePhase(phase.id, { title: t });
    setEditingTitle(false);
  }

  function openItemEditPanel(item: CarBuildItem, e: React.MouseEvent) {
    e.stopPropagation();
    if (openItemEdit === item.id) { setOpenItemEdit(null); return; }
    setItemEdits(prev => ({
      ...prev,
      [item.id]: {
        name: item.name,
        brand: item.brand ?? '',
        price: item.price !== null ? String(item.price) : '',
        link: item.link ?? '',
        moveToPhaseId: item.phase_id,
      },
    }));
    setOpenItemEdit(item.id);
  }

  function saveItemEdit(item: CarBuildItem) {
    const ed = itemEdits[item.id];
    if (!ed) return;
    if (!isValidUrl(ed.link)) {
      toast.error('Invalid URL — must start with http:// or https://');
      return;
    }
    const parsedPrice = ed.price.trim() ? parseFloat(ed.price) : null;
    const updates: Partial<CarBuildItem & { phase_id?: string }> = {
      name: ed.name.trim() || item.name,
      brand: ed.brand.trim() || null,
      price: parsedPrice !== null && !isNaN(parsedPrice) ? parsedPrice : null,
      link: ed.link.trim() || null,
    };
    if (ed.moveToPhaseId !== item.phase_id) {
      updates.phase_id = ed.moveToPhaseId;
    }
    onUpdateItem(item.id, updates);
    setOpenItemEdit(null);
  }

  function updateItemEdit(itemId: string, field: keyof ItemEditState, value: string) {
    setItemEdits(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  }

  const inputCls = 'w-full bg-[#1a1a1a] border border-border text-foreground text-sm px-3 py-[5px] rounded focus:outline-none focus:border-[#c8a84b] font-sans';
  const monoInput = 'w-full bg-[#1a1a1a] border border-border text-foreground text-sm px-3 py-[5px] rounded focus:outline-none focus:border-[#c8a84b] font-mono';

  return (
    <div
      className={cn(
        'border border-border rounded overflow-hidden mb-2 transition-all duration-150',
        phase.hidden && 'opacity-40',
        isDragging && 'opacity-40',
        isDragOver && 'border-[#c8a84b] shadow-[0_0_0_1px_#c8a84b]',
      )}
      onDragOver={e => !isMobile && onPhaseDragOver(e, phase.id)}
      onDrop={e => !isMobile && onPhaseDrop(e, phase.id)}
    >
      {/* Phase Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-card cursor-pointer hover:bg-card/80 select-none"
        onClick={() => !phase.hidden && setExpanded(e => !e)}
      >
        {/* Drag handle (desktop) / Arrow buttons (mobile) */}
        {!isMobile ? (
          <div
            draggable
            onDragStart={e => onPhaseDragStart(e, phase.id)}
            onDragEnd={onPhaseDragEnd}
            onClick={e => e.stopPropagation()}
            className="cursor-grab text-muted-foreground opacity-30 hover:opacity-70 flex-shrink-0"
            title="Drag to reorder"
          >
            <GripVertical size={16} />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button
              disabled={isFirst}
              onClick={() => onMovePhase('up')}
              className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"
            >
              <ArrowUp size={12} />
            </button>
            <button
              disabled={isLast}
              onClick={() => onMovePhase('down')}
              className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"
            >
              <ArrowDown size={12} />
            </button>
          </div>
        )}

        {/* Phase number + dot */}
        <div className="text-2xl font-display font-bold leading-none flex-shrink-0" style={{ color }}>
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 mb-0.5 align-middle" style={{ background: color }} />
          {phaseIndex + 1}
        </div>

        {/* Title + subtitle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={openTitleEdit}
              className="text-muted-foreground opacity-40 hover:opacity-100 hover:text-[#c8a84b] transition-all flex-shrink-0"
              title="Rename phase"
            >
              <Pencil size={12} />
            </button>
            <span className={cn('text-sm font-semibold uppercase tracking-wide text-foreground break-words', phase.hidden && 'line-through')}>
              {phase.title}
            </span>
            {allDone && (
              <span className="ml-1 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0"
                style={{ color: '#3a8a5a', borderColor: '#3a8a5a' }}>
                ✓ Done
              </span>
            )}
          </div>
          <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{subtitle}</div>
        </div>

        {/* Phase total */}
        <div className="font-mono text-base font-medium text-right flex-shrink-0" style={{ color: '#c8a84b' }}>
          {phaseTotal > 0 ? `$${phaseTotal.toLocaleString()}` : <span className="text-[13px] text-muted-foreground">TBD</span>}
        </div>

        {/* Hide/show */}
        <button
          onClick={e => { e.stopPropagation(); onUpdatePhase(phase.id, { hidden: !phase.hidden }); }}
          title={phase.hidden ? 'Show phase' : 'Hide phase'}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {phase.hidden ? <Eye size={14} style={{ color: '#c8a84b' }} /> : <EyeOff size={14} />}
        </button>

        {/* Delete */}
        <button
          onClick={e => { e.stopPropagation(); onDeletePhase(phase.id); }}
          title="Delete phase"
          className="flex-shrink-0 text-muted-foreground opacity-35 hover:opacity-100 hover:text-red-400 transition-all"
        >
          <Trash2 size={13} />
        </button>

        {/* Chevron */}
        {!phase.hidden && (
          <ChevronDown
            size={14}
            className={cn('flex-shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')}
          />
        )}
      </div>

      {/* Inline title edit panel */}
      {editingTitle && (
        <div className="bg-[#0e0e0e] border-t border-border px-4 py-3" onClick={e => e.stopPropagation()}>
          <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1.5">
            Phase Title
          </label>
          <input
            ref={titleRef}
            className={inputCls}
            value={titleInput}
            onChange={e => setTitleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitle(false); }}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={saveTitleEdit}
              className="px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider rounded"
              style={{ background: '#c8a84b', color: '#000' }}
            >
              Save
            </button>
            <button
              onClick={() => setEditingTitle(false)}
              className="px-3 py-1 text-[11px] font-mono text-muted-foreground border border-border rounded hover:border-muted-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Items list */}
      {expanded && !phase.hidden && (
        <div className="border-t border-border">
          {items.map((item, ii) => {
            const isItemTarget = dragOverItemId === item.id && !isMobile;
            return (
            <div key={item.id}>
              {isItemTarget && !itemDropBelow && (
                <div className="h-0.5 rounded mx-4" style={{ background: '#c8a84b' }} />
              )}
              {/* Item Row */}
              <div
                className={cn(
                  'flex items-center gap-2.5 px-4 py-3 border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors',
                  item.completed && 'opacity-50',
                  dragItemId === item.id && 'opacity-40',
                )}
                onDragOver={e => !isMobile && onItemDragOver(e, item.id, phase.id)}
                onDrop={e => !isMobile && onItemDrop(e, item.id, phase.id)}
              >
                {/* Item drag handle / arrows */}
                {!isMobile ? (
                  <div
                    draggable
                    onDragStart={e => onItemDragStart(e, item.id)}
                    onDragEnd={onItemDragEnd}
                    onClick={e => e.stopPropagation()}
                    className="cursor-grab text-muted-foreground opacity-30 hover:opacity-70 flex-shrink-0"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button
                      disabled={ii === 0}
                      onClick={() => onMoveItemArrow(item.id, phase.id, 'up')}
                      className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"
                    >
                      <ArrowUp size={10} />
                    </button>
                    <button
                      disabled={ii === items.length - 1}
                      onClick={() => onMoveItemArrow(item.id, phase.id, 'down')}
                      className="text-muted-foreground disabled:opacity-20 hover:text-foreground transition-colors p-0.5"
                    >
                      <ArrowDown size={10} />
                    </button>
                  </div>
                )}

                {/* Complete toggle */}
                <button
                  onClick={() => onToggleItem(item.id, !item.completed)}
                  className={cn(
                    'w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200',
                    item.completed
                      ? 'border-[#3a8a5a] bg-[#3a8a5a] text-white'
                      : 'border-border bg-transparent hover:border-[#3a8a5a]',
                  )}
                >
                  {item.completed && <Check size={11} strokeWidth={3} />}
                </button>

                {/* Item label */}
                <div className="text-[13px] font-mono text-muted-foreground flex-shrink-0 w-7 text-center">
                  {itemLabel(phaseIndex, ii, items.length)}
                </div>

                {/* Name + brand + link */}
                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm text-[#c8c2b8] leading-snug', item.completed && 'line-through')}>
                    {item.name}
                  </div>
                  {item.brand && (
                    <div className="text-[12px] font-mono text-muted-foreground mt-0.5 break-words">{item.brand}</div>
                  )}
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-mono mt-0.5 transition-colors hover:underline"
                      style={{ color: '#6a90c0' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink size={10} /> VIEW LISTING
                    </a>
                  )}
                </div>

                {/* Price + edit */}
                <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                  {item.price !== null
                    ? <span className="font-mono text-sm text-foreground">${item.price.toLocaleString()}</span>
                    : <span className="font-mono text-[12px] text-muted-foreground">TBD</span>
                  }
                  <button
                    onClick={e => openItemEditPanel(item, e)}
                    className="text-[11px] font-mono px-2 py-0.5 border border-border rounded text-muted-foreground hover:border-[#c8a84b] hover:text-[#c8a84b] transition-colors"
                  >
                    EDIT
                  </button>
                </div>

                {/* Delete */}
                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="flex-shrink-0 text-muted-foreground opacity-35 hover:opacity-100 hover:text-red-400 transition-all ml-0.5"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Inline item edit panel */}
              {openItemEdit === item.id && itemEdits[item.id] && (
                <div className="bg-[#0e0e0e] border-b border-border px-4 py-3 pl-[4.5rem]" onClick={e => e.stopPropagation()}>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1">Item Name</label>
                        <input
                          className={inputCls}
                          value={itemEdits[item.id].name}
                          onChange={e => updateItemEdit(item.id, 'name', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') setOpenItemEdit(null); }}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1">Brand / Description</label>
                        <input
                          className={inputCls}
                          value={itemEdits[item.id].brand}
                          onChange={e => updateItemEdit(item.id, 'brand', e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveItemEdit(item); if (e.key === 'Escape') setOpenItemEdit(null); }}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1">Product Link (URL)</label>
                        <input
                          className={monoInput}
                          type="url"
                          value={itemEdits[item.id].link}
                          onChange={e => updateItemEdit(item.id, 'link', e.target.value)}
                          placeholder="https://..."
                          style={{
                            color: '#8ab0e0',
                            borderColor: !isValidUrl(itemEdits[item.id].link) ? '#e05a5a' : undefined,
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1">Move to Phase</label>
                        <select
                          className={inputCls}
                          value={itemEdits[item.id].moveToPhaseId}
                          onChange={e => updateItemEdit(item.id, 'moveToPhaseId', e.target.value)}
                        >
                          {allPhases.map((ph, i) => (
                            <option key={ph.id} value={ph.id}>{i + 1}. {ph.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-muted-foreground uppercase tracking-[0.1em] mb-1">Price ($)</label>
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
                      onClick={() => saveItemEdit(item)}
                      className="px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider rounded"
                      style={{ background: '#c8a84b', color: '#000' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setOpenItemEdit(null)}
                      className="px-3 py-1 text-[11px] font-mono text-muted-foreground border border-border rounded hover:border-muted-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {isItemTarget && itemDropBelow && (
                <div className="h-0.5 rounded mx-4" style={{ background: '#c8a84b' }} />
              )}
            </div>
            );
          })}

          {/* Add item button */}
          <button
            onClick={() => onAddItem(phase.id, phase.build_id)}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-[12px] font-mono uppercase tracking-[0.1em] text-muted-foreground hover:text-[#c8a84b] hover:bg-[#0d0d0d] transition-colors border-t border-dashed border-[#1e1e1e]"
          >
            <Plus size={14} /> Add Item
          </button>
        </div>
      )}
    </div>
  );
}
