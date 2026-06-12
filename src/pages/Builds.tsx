import { useState, useRef, useEffect, useMemo } from 'react';
import { Plus, Edit2, Trash2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useCarBuilds, useCarBuildPhases, useCarBuildItems } from '@/hooks/useSupabaseData';
import BuildHeader from '@/components/builds/BuildHeader';
import BuildSummary from '@/components/builds/BuildSummary';
import PhaseBlock from '@/components/builds/PhaseBlock';
import BuildFormModal from '@/components/builds/BuildFormModal';
import { C5_PHASES } from '@/lib/builds-c5-data';
import { supabase } from '@/integrations/supabase/client';
import type { CarBuild, CarBuildPhase, CarBuildItem } from '@/lib/types';

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

  // ── Seed C5 data on first build ─────────────────────────
  async function seedC5Data(buildId: string) {
    if (!user) return;
    const seedKey = `forgenta:builds_seeded_${user.id}`;
    if (localStorage.getItem(seedKey)) return;
    // Also check DB — if phases already exist (e.g. seeded directly), skip and mark done
    const { data: existing } = await supabase
      .from('car_build_phases' as any)
      .select('id')
      .eq('user_id', user.id)
      .limit(1);
    if (existing && existing.length > 0) {
      localStorage.setItem(seedKey, '1');
      return;
    }
    try {
      for (let pi = 0; pi < C5_PHASES.length; pi++) {
        const ph = C5_PHASES[pi];
        const { data: phRow, error: phErr } = await supabase
          .from('car_build_phases' as any)
          .insert({ build_id: buildId, user_id: user.id, title: ph.title, sort_order: pi })
          .select()
          .single();
        if (phErr || !phRow) continue;
        const phaseId = (phRow as any).id;
        const itemRows = ph.items.map((it, ii) => ({
          phase_id: phaseId,
          build_id: buildId,
          user_id: user.id,
          name: it.name,
          brand: it.brand,
          price: it.price,
          sort_order: ii,
        }));
        if (itemRows.length > 0) {
          await supabase.from('car_build_items' as any).insert(itemRows);
        }
      }
      localStorage.setItem(seedKey, '1');
    } catch {
      // Non-fatal
    }
  }

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
        await seedC5Data(newBuild.id);
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

  function onItemDragOver(e: React.DragEvent, _itemId: string, _phaseId: string) {
    if (!dragItemIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }

  function onItemDragEnd() {
    dragItemIdRef.current = null;
    setDraggingItemId(null);
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
          <p className="text-[11px] font-mono text-muted-foreground mt-3">
            Your first build will be pre-loaded with the C5 Corvette template
          </p>
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
              {displayPhases.map((ph, i) => (
                <PhaseBlock
                  key={ph.id}
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
              ))}

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
