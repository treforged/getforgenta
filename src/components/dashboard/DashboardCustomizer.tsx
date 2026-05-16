import { ChevronUp, ChevronDown, Eye, EyeOff, X, RotateCcw } from 'lucide-react';
import { WIDGET_META, type WidgetConfig } from '@/lib/dashboard-widgets';

interface Props {
  layout: WidgetConfig[];
  onLayoutChange: (layout: WidgetConfig[]) => void;
  onClose: () => void;
  onReset: () => void;
}

export default function DashboardCustomizer({ layout, onLayoutChange, onClose, onReset }: Props) {
  const metaMap = Object.fromEntries(WIDGET_META.map(w => [w.id, w]));

  const toggle = (index: number) => {
    onLayoutChange(layout.map((w, i) => (i === index ? { ...w, visible: !w.visible } : w)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout];
    [next[index], next[target]] = [next[target], next[index]];
    onLayoutChange(next);
  };

  const visibleCount = layout.filter(w => w.visible).length;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Panel — bottom sheet on mobile, right slide-out on sm+ */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-card border-t border-border shadow-2xl rounded-t-2xl sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-80 sm:border-t-0 sm:border-l sm:rounded-none"
        style={{
          maxHeight: '85dvh',
          paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
        }}
      >
        {/* Mobile drag handle pill */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <div>
            <h2 className="font-display font-semibold text-sm">Customize Dashboard</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{visibleCount} of {layout.length} widgets shown</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Instructions */}
        <p className="px-4 py-2.5 text-xs text-muted-foreground border-b border-border/50 shrink-0">
          Use arrows to reorder &bull; Toggle eye to show/hide
        </p>

        {/* Widget list */}
        <div className="flex-1 overflow-y-auto py-2">
          {layout.map((widget, index) => {
            const meta = metaMap[widget.id];
            return (
              <div
                key={widget.id}
                className={`flex items-center gap-2 px-3 py-2 mx-2 transition-colors ${!widget.visible ? 'opacity-50' : 'hover:bg-muted/40'}`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                {/* Up / Down buttons */}
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="p-1 min-w-[32px] min-h-[32px] flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => move(index, 1)}
                    disabled={index === layout.length - 1}
                    className="p-1 min-w-[32px] min-h-[32px] flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0 py-1">
                  <p className="text-xs font-medium truncate">{meta?.label ?? widget.id}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed truncate">{meta?.description}</p>
                </div>

                {/* Visibility toggle */}
                <button
                  onClick={() => toggle(index)}
                  className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 transition-colors"
                  title={widget.visible ? 'Hide widget' : 'Show widget'}
                >
                  {widget.visible
                    ? <Eye size={14} className="text-primary" />
                    : <EyeOff size={14} className="text-muted-foreground" />
                  }
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0 space-y-2">
          <button
            onClick={onReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <RotateCcw size={12} /> Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
