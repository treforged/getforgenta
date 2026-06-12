import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import { Plus, Edit2, Trash2, ChevronDown, Share2, Copy, Check as CheckIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useCarBuilds, useCarBuildPhases, useCarBuildItems } from '@/hooks/useSupabaseData';
import BuildHeader from '@/components/builds/BuildHeader';
import BuildSummary from '@/components/builds/BuildSummary';
import PhaseBlock from '@/components/builds/PhaseBlock';
import BuildFormModal from '@/components/builds/BuildFormModal';
import BuildSharePreviewModal from '@/components/builds/BuildSharePreviewModal';
import type { CarBuild, CarBuildPhase, CarBuildItem } from '@/lib/types';

const SHARE_BASE = 'https://getforgenta.com';

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(hover: none)');
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

export default function Builds() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

  const { data: builds, loading: buildsLoading, add: addBuild, update: updateBuild, remove: removeBuild } = useCarBuilds();

  // Track which build is selected; fall back to first when unset
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const activeBuild: CarBuild | undefined = useMemo(
    () => (activeBuildId ? builds.find((b: CarBuild) => b.id === activeBuildId) : builds[0]),
    [builds, activeBuildId]
  );
  const resolvedBuildId = activeBuild?.id ?? null;

  // Auto-select first build (runs only once after builds load)
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && builds.length > 0) {
      didAutoSelect.current = true;
      setActiveBuildId(builds[0].id);
    }
  }, [builds]);

  const { data: phases, loading: phasesLoading, add: addPhase, update: updatePhase, remove: removePhase, reorder: reorderPhases } = useCarBuildPhases(resolvedBuildId);
  const { data: items, loading: itemsLoading, add: addItem, update: updateItem, remove: removeItem, reorder: reorderItems } = useCarBuildItems(resolvedBuildId);

  // Optimistic order state — only used during/after drag before server confirms
  // null = use server data (phases/items from hooks)
  const [dragPhaseOrder, setDragPhaseOrder] = useState<CarBuildPhase[] | null>(null);
  const [dragItemOrder, setDragItemOrder] = useState<CarBuildItem[] | null>(null);

  // Reset optimistic state when server data updates
  const prevBuildId = useRef<string | null>(null);
  useEffect(() => {
    if (resolvedBuildId !== prevBuildId.current) {
      prevBuildId.current = resolvedBuildId;
      setDragPhaseOrder(null);
      setDragItemOrder(null);
    }
  }, [resolvedBuildId]);

  const displayPhases: CarBuildPhase[] = dragPhaseOrder ?? phases;
  const displayItems: CarBuildItem[] = dragItemOrder ?? items;

  // Build form modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingBuild, setEditingBuild] = useState<CarBuild | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Drag refs (no state — avoid re-renders mid-drag)
  const dragPhaseIdRef = useRef<string | null>(null);
  const dragItemIdRef = useRef<string | null>(null);
  const [draggingPhaseId, setDraggingPhaseId] = useState<string | null>(null);
  const [dragOverPhaseId, setDragOverPhaseId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  // Share UI
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);

  // ── Build CRUD ───────────────────────────────────────────
  async function handleSaveBuild(data: { name: string; year: number | null; make: string | null; model: string | null; notes: string | null }) {
    setFormSaving(true);
    try {
      if (editingBuild) {
        await updateBuild.mutateAsync({ id: editingBuild.id, ...data });
        toast.success('Build updated');
      } else {
        const newBuild = await addBuild.mutateAsync({ ...data, sort_order: builds.length });
        setActiveBuildId(newBuild.id);
        toast.success('Build created');
      }
      setFormOpen(false);
      setEditingBuild(null);
    } catch {
      // errors handled by hook
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDeleteBuild(build: CarBuild) {
    if (!confirm(`Delete "${build.name}" and all its phases and items?`)) return;
    await removeBuild.mutateAsync(build.id);
    didAutoSelect.current = false;
    setActiveBuildId(null);
    toast.success('Build deleted');
  }

  // ── Phase CRUD ───────────────────────────────────────────
  async function handleAddPhase() {
    if (!resolvedBuildId) return;
    await addPhase.mutateAsync({ build_id: resolvedBuildId, title: 'New Phase', sort_order: displayPhases.length });
  }

  async function handleUpdatePhase(id: string, data: Partial<CarBuildPhase>) {
    if ('hidden' in data) {
      setDragPhaseOrder(prev => (prev ?? phases).map(p => p.id === id ? { ...p, ...data } : p));
    }
    await updatePhase.mutateAsync({ id, ...data });
  }

  async function handleDeletePhase(id: string) {
    const ph = displayPhases.find(p => p.id === id);
    const count = displayItems.filter(it => it.phase_id === id).length;
    const msg = count > 0
      ? `Delete "${ph?.title}" and its ${count} item${count !== 1 ? 's' : ''}?`
      : `Delete phase "${ph?.title}"?`;
    if (!confirm(msg)) return;
    await removePhase.mutateAsync(id);
  }

  // ── Item CRUD ────────────────────────────────────────────
  async function handleAddItem(phaseId: string, buildId: string) {
    const phaseItems = displayItems.filter(it => it.phase_id === phaseId);
    await addItem.mutateAsync({ phase_id: phaseId, build_id: buildId, name: 'New Item', sort_order: phaseItems.length });
  }

  async function handleUpdateItem(id: string, data: Partial<CarBuildItem & { phase_id?: string }>) {
    await updateItem.mutateAsync({ id, ...data });
  }

  async function handleDeleteItem(id: string) {
    await removeItem.mutateAsync(id);
  }

  async function handleToggleItem(id: string, completed: boolean) {
    // Optimistic local update for instant feedback
    setDragItemOrder(prev => (prev ?? items).map(it => it.id === id ? { ...it, completed } : it));
    await updateItem.mutateAsync({ id, completed });
  }

  // ── Share ────────────────────────────────────────────────
  async function handleEnableShare() {
    if (!activeBuild) return;
    setShareLoading(true);
    try {
      const token = crypto.randomUUID();
      await updateBuild.mutateAsync({ id: activeBuild.id, share_token: token });
      toast.success('Share link created');
    } finally {
      setShareLoading(false);
    }
  }

  async function handleDisableShare() {
    if (!activeBuild) return;
    setShareLoading(true);
    try {
      await updateBuild.mutateAsync({ id: activeBuild.id, share_token: null });
      toast.success('Share link disabled');
    } finally {
      setShareLoading(false);
    }
  }

  function shareUrl() {
    if (!activeBuild?.share_token) return '';
    return `${SHARE_BASE}/builds/share/${activeBuild.share_token}`;
  }

  function handleOpenShareLink() {
    const url = shareUrl();
    if (!url) return;
    if (isMobile) {
      setSharePreviewOpen(true);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async function handleCopyLink() {
    const url = shareUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success('Link copied!');
  }

  // ── Phase drag (desktop) ─────────────────────────────────
  function onPhaseDragStart(e: React.DragEvent, phaseId: string) {
    dragPhaseIdRef.current = phaseId;
    dragItemIdRef.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('phase-id', phaseId);
    setDraggingPhaseId(phaseId);
  }

  function onPhaseDragOver(e: React.DragEvent, phaseId: string) {
    if (!dragPhaseIdRef.current || dragPhaseIdRef.current === phaseId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPhaseId(phaseId);
  }

  function onPhaseDragEnd() {
    dragPhaseIdRef.current = null;
    setDraggingPhaseId(null);
    setDragOverPhaseId(null);
  }

  function onPhaseDrop(e: React.DragEvent, toPhaseId: string) {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('phase-id');
    if (!fromId || fromId === toPhaseId) return;
    const src = displayPhases;
    const from = src.findIndex(p => p.id === fromId);
    const to = src.findIndex(p => p.id === toPhaseId);
    if (from < 0 || to < 0) return;
    const reordered = [...src];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const withOrders = reordered.map((p, i) => ({ ...p, sort_order: i }));
    setDragPhaseOrder(withOrders);
    setDragOverPhaseId(null);
    setDraggingPhaseId(null);
    dragPhaseIdRef.current = null;
    reorderPhases.mutate(withOrders.map(p => ({ id: p.id, sort_order: p.sort_order })));
  }

  // ── Item drag (desktop) ──────────────────────────────────
  function onItemDragStart(e: React.DragEvent, itemId: string) {
    dragItemIdRef.current = itemId;
    dragPhaseIdRef.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('item-id', itemId);
    setDraggingItemId(itemId);
  }

  function onItemDragOver(e: React.DragEvent, itemId: string, _phaseId: string) {
    if (!dragItemIdRef.current || dragItemIdRef.current === itemId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverItemId(itemId);
  }

  function onItemDragEnd() {
    dragItemIdRef.current = null;
    setDraggingItemId(null);
    setDragOverItemId(null);
  }

  function onItemDrop(e: React.DragEvent, toItemId: string, toPhaseId: string) {
    e.preventDefault();
    e.stopPropagation();
    const fromId = e.dataTransfer.getData('item-id');
    if (!fromId || fromId === toItemId) return;
    const src = displayItems;
    const fromItem = src.find(it => it.id === fromId);
    if (!fromItem) return;
    const without = src.filter(it => it.id !== fromId);
    const toIdx = without.findIndex(it => it.id === toItemId);
    without.splice(toIdx, 0, { ...fromItem, phase_id: toPhaseId });
    const withOrders = without.map((it, i) => ({ ...it, sort_order: i }));
    setDragItemOrder(withOrders);
    setDraggingItemId(null);
    setDragOverItemId(null);
    dragItemIdRef.current = null;
    reorderItems.mutate(withOrders.map(it => ({ id: it.id, sort_order: it.sort_order, phase_id: it.phase_id })));
  }

  // ── Mobile arrow reorder ─────────────────────────────────
  function handleMovePhase(phaseId: string, direction: 'up' | 'down') {
    const src = displayPhases;
    const idx = src.findIndex(p => p.id === phaseId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= src.length) return;
    const reordered = [...src];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const withOrders = reordered.map((p, i) => ({ ...p, sort_order: i }));
    setDragPhaseOrder(withOrders);
    reorderPhases.mutate(withOrders.map(p => ({ id: p.id, sort_order: p.sort_order })));
  }

  function handleMoveItemArrow(itemId: string, phaseId: string, direction: 'up' | 'down') {
    const src = displayItems;
    const phaseItems = src.filter(it => it.phase_id === phaseId);
    const idx = phaseItems.findIndex(it => it.id === itemId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= phaseItems.length) return;
    const reordered = [...phaseItems];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const updated = src.map(it => {
      const pos = reordered.findIndex(r => r.id === it.id);
      return pos >= 0 ? { ...it, sort_order: pos } : it;
    });
    setDragItemOrder(updated);
    reorderItems.mutate(reordered.map((it, i) => ({ id: it.id, sort_order: i, phase_id: it.phase_id })));
  }

  // Drag direction: compare source index vs target index to decide line placement
  const draggingPhaseIdx = draggingPhaseId ? displayPhases.findIndex(p => p.id === draggingPhaseId) : -1;
  const dragOverPhaseIdx = dragOverPhaseId ? displayPhases.findIndex(p => p.id === dragOverPhaseId) : -1;
  const phaseDropBelow = draggingPhaseIdx >= 0 && dragOverPhaseIdx >= 0 && draggingPhaseIdx < dragOverPhaseIdx;

  const draggingItemIdx = draggingItemId ? displayItems.findIndex(it => it.id === draggingItemId) : -1;
  const dragOverItemIdx = dragOverItemId ? displayItems.findIndex(it => it.id === dragOverItemId) : -1;
  const itemDropBelow = draggingItemIdx >= 0 && dragOverItemIdx >= 0 && draggingItemIdx < dragOverItemIdx;

  // Items grouped by phase for rendering
  const itemsByPhase = useMemo(() => {
    const map: Record<string, CarBuildItem[]> = {};
    for (const ph of displayPhases) map[ph.id] = [];
    for (const it of displayItems) {
      if (map[it.phase_id]) map[it.phase_id].push(it);
      else map[it.phase_id] = [it];
    }
    return map;
  }, [displayPhases, displayItems]);

  if (buildsLoading) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-2 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-2 sm:py-4">
      {/* Build Switcher */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {builds.length > 0 ? (
          <div className="relative flex-1 min-w-0">
            <select
              value={activeBuild?.id ?? ''}
              onChange={e => { setActiveBuildId(e.target.value); setDragPhaseOrder(null); setDragItemOrder(null); }}
              className="w-full appearance-none bg-card border border-border text-foreground text-sm font-mono px-3 py-2 pr-8 rounded focus:outline-none focus:border-[#c8a84b] cursor-pointer"
            >
              {builds.map((b: CarBuild) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        ) : (
          <div className="flex-1 text-sm text-muted-foreground font-mono">No builds yet</div>
        )}

        {activeBuild && (
          <button
            onClick={() => { setEditingBuild(activeBuild); setFormOpen(true); }}
            title="Edit build"
            className="p-2 text-muted-foreground hover:text-foreground border border-border rounded hover:border-muted-foreground transition-colors"
          >
            <Edit2 size={14} />
          </button>
        )}
        {activeBuild && (
          <button
            onClick={() => setShareOpen(o => !o)}
            title="Share build"
            className={`p-2 border rounded transition-colors ${shareOpen ? 'text-[#c8a84b] border-[#c8a84b]' : 'text-muted-foreground hover:text-[#c8a84b] border-border hover:border-[#c8a84b]'}`}
          >
            <Share2 size={14} />
          </button>
        )}
        {activeBuild && (
          <button
            onClick={() => handleDeleteBuild(activeBuild)}
            title="Delete build"
            className="p-2 text-muted-foreground hover:text-red-400 border border-border rounded hover:border-red-400/50 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        )}
        <button
          onClick={() => { setEditingBuild(null); setFormOpen(true); }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded transition-colors flex-shrink-0"
          style={{ background: '#c8a84b', color: '#000' }}
        >
          <Plus size={13} /> New Build
        </button>
      </div>

      {/* Share panel */}
      {shareOpen && activeBuild && (
        <div className="mb-4 bg-card border border-border rounded p-4 font-mono text-sm space-y-3">
          <div className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Share Build</div>
          {activeBuild.share_token ? (
            <>
              <div className="text-[12px] text-muted-foreground">Anyone with this link can view your build — read only.</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl()}
                  className="flex-1 bg-[#111] border border-border rounded px-3 py-1.5 text-[12px] text-[#8ab0e0] focus:outline-none select-all"
                  onFocus={e => e.target.select()}
                />
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-colors"
                  style={{ background: '#c8a84b', color: '#000' }}
                >
                  <Copy size={12} /> Copy
                </button>
                <button
                  onClick={handleOpenShareLink}
                  title={isMobile ? 'Preview' : 'Open in new tab'}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded transition-colors border"
                  style={{ color: '#c8a84b', borderColor: '#c8a84b', background: 'transparent' }}
                >
                  <ExternalLink size={12} />
                  {isMobile ? 'Preview' : 'Open'}
                </button>
              </div>
              <button
                onClick={handleDisableShare}
                disabled={shareLoading}
                className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Disable share link
              </button>
            </>
          ) : (
            <>
              <div className="text-[12px] text-muted-foreground">Generate a public link so friends can view your plan and progress.</div>
              <button
                onClick={handleEnableShare}
                disabled={shareLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-40"
                style={{ background: '#c8a84b', color: '#000' }}
              >
                <Share2 size={12} /> {shareLoading ? 'Creating…' : 'Create Share Link'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Empty state */}
      {builds.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border rounded">
          <div className="text-muted-foreground text-sm font-mono mb-4">No builds yet</div>
          <button
            onClick={() => { setEditingBuild(null); setFormOpen(true); }}
            className="px-5 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded"
            style={{ background: '#c8a84b', color: '#000' }}
          >
            Create Your First Build
          </button>
        </div>
      )}

      {/* Active build content */}
      {activeBuild && (
        <>
          <BuildHeader build={activeBuild} phases={displayPhases} items={displayItems} />

          {phasesLoading || itemsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}
            </div>
          ) : (
            <>
              {displayPhases.map((ph, i) => {
                const isPhaseTarget = dragOverPhaseId === ph.id && !isMobile;
                return (
                  <Fragment key={ph.id}>
                    {isPhaseTarget && !phaseDropBelow && (
                      <div className="h-0.5 rounded mx-0.5 mb-1" style={{ background: '#c8a84b' }} />
                    )}
                    <PhaseBlock
                      phase={ph}
                      phaseIndex={i}
                      items={itemsByPhase[ph.id] ?? []}
                      allPhases={displayPhases}
                      isMobile={isMobile}
                      isFirst={i === 0}
                      isLast={i === displayPhases.length - 1}
                      isDragging={draggingPhaseId === ph.id}
                      isDragOver={dragOverPhaseId === ph.id}
                      dragItemId={draggingItemId}
                      dragOverItemId={dragOverItemId}
                      itemDropBelow={itemDropBelow}
                      onUpdatePhase={handleUpdatePhase}
                      onDeletePhase={handleDeletePhase}
                      onAddItem={handleAddItem}
                      onUpdateItem={handleUpdateItem}
                      onDeleteItem={handleDeleteItem}
                      onToggleItem={handleToggleItem}
                      onMovePhase={dir => handleMovePhase(ph.id, dir)}
                      onMoveItemArrow={handleMoveItemArrow}
                      onPhaseDragStart={onPhaseDragStart}
                      onPhaseDragOver={onPhaseDragOver}
                      onPhaseDragEnd={onPhaseDragEnd}
                      onPhaseDrop={onPhaseDrop}
                      onItemDragStart={onItemDragStart}
                      onItemDragOver={onItemDragOver}
                      onItemDragEnd={onItemDragEnd}
                      onItemDrop={onItemDrop}
                    />
                    {isPhaseTarget && phaseDropBelow && (
                      <div className="h-0.5 rounded mx-0.5 mt-1" style={{ background: '#c8a84b' }} />
                    )}
                  </Fragment>
                );
              })}

              <button
                onClick={handleAddPhase}
                className="flex items-center justify-center gap-2.5 w-full mt-3 px-5 py-3.5 text-[13px] font-mono uppercase tracking-[0.12em] text-muted-foreground border border-dashed border-[#2a2a2a] rounded hover:text-[#c8a84b] hover:border-[#c8a84b] hover:bg-[#0d0d0d] transition-colors"
              >
                <Plus size={16} /> Add Phase
              </button>
            </>
          )}

          <BuildSummary phases={displayPhases} items={displayItems} />
        </>
      )}

      {sharePreviewOpen && activeBuild && (
        <BuildSharePreviewModal
          build={activeBuild}
          phases={displayPhases}
          items={displayItems}
          shareUrl={shareUrl()}
          onClose={() => setSharePreviewOpen(false)}
        />
      )}

      <BuildFormModal
        open={formOpen}
        build={editingBuild}
        onClose={() => { setFormOpen(false); setEditingBuild(null); }}
        onSave={handleSaveBuild}
        saving={formSaving}
      />
    </div>
  );
}
