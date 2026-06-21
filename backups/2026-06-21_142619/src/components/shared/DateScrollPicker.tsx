import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';

function ScrollColumn({ items, selected, onSelect }: {
  items: { value: number; label: string }[];
  selected: number;
  onSelect: (v: number) => void;
}) {
  const ITEM_H = 32;
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isInternal = useRef(false);
  const wheelLocked = useRef(false);

  useLayoutEffect(() => {
    const idx = items.findIndex(i => i.value === selected);
    if (idx >= 0 && ref.current) ref.current.scrollTop = idx * ITEM_H;
    // Intentionally mount-only: positions instantly with no animation on first
    // render. The useEffect below handles animated scrolling on later changes -
    // including items/selected here would double-fire both on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInternal.current) { isInternal.current = false; return; }
    const idx = items.findIndex(i => i.value === selected);
    if (idx >= 0) ref.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' });
  }, [selected, items]);

  const handleScroll = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.round(ref.current.scrollTop / ITEM_H);
      const item = items[Math.max(0, Math.min(idx, items.length - 1))];
      if (item && item.value !== selected) {
        isInternal.current = true;
        onSelect(item.value);
      }
    }, 100);
  };

  // Native wheel scroll moves by the browser's own line/pixel delta (often 100+ px, i.e.
  // 3-4 rows at once for a single notch). Intercept it so one wheel tick = one row. React
  // attaches onWheel as a passive listener, so preventDefault() there is a silent no-op
  // (logs "Unable to preventDefault inside passive event listener invocation") — the native
  // scroll wins anyway. Has to be a real listener attached with passive: false.
  const itemsRef = useRef(items);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  itemsRef.current = items;
  selectedRef.current = selected;
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelLocked.current) return;
      wheelLocked.current = true;
      setTimeout(() => { wheelLocked.current = false; }, 120);

      const currentItems = itemsRef.current;
      const currentSelected = selectedRef.current;
      const idx = currentItems.findIndex(i => i.value === currentSelected);
      const dir = e.deltaY > 0 ? 1 : -1;
      const nextIdx = Math.max(0, Math.min(idx + dir, currentItems.length - 1));
      const item = currentItems[nextIdx];
      if (item && item.value !== currentSelected) {
        isInternal.current = true;
        onSelectRef.current(item.value);
        el.scrollTo({ top: nextIdx * ITEM_H, behavior: 'smooth' });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="relative flex-1">
      <div
        className="absolute inset-x-0 pointer-events-none z-10 bg-primary/10 border-y border-border/50"
        style={{ top: ITEM_H * 2, height: ITEM_H }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        style={{
          height: ITEM_H * 5,
          overflowY: 'scroll',
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
        } as React.CSSProperties}
        className="[&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: ITEM_H * 2 }} />
        {items.map((item) => (
          <div
            key={item.value}
            style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
            className={`flex items-center justify-center text-[11px] cursor-pointer select-none ${
              item.value === selected ? 'text-foreground font-semibold' : 'text-muted-foreground'
            }`}
            onClick={() => {
              const idx = items.findIndex(i => i.value === item.value);
              isInternal.current = true;
              onSelect(item.value);
              ref.current?.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' });
            }}
          >
            {item.label}
          </div>
        ))}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
    </div>
  );
}

export default function DateScrollPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const init = value
    ? { y: +value.slice(0, 4), m: +value.slice(5, 7), d: +value.slice(8, 10) }
    : { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };

  const [yr, setYr] = useState(init.y);
  const [mo, setMo] = useState(init.m);
  const [dy, setDy] = useState(init.d);

  const maxDay = new Date(yr, mo, 0).getDate();
  const safeDay = Math.min(dy, maxDay);

  useEffect(() => {
    if (dy !== safeDay) setDy(safeDay);
  }, [dy, safeDay]);

  useEffect(() => {
    const mm = String(mo).padStart(2, '0');
    const dd = String(safeDay).padStart(2, '0');
    onChange(`${yr}-${mm}-${dd}`);
    // Intentionally excludes onChange: the parent typically passes a fresh
    // inline callback every render, and this should only fire when the actual
    // date value changes, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yr, mo, safeDay]);

  const MONTHS = useMemo(() => [
    { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
    { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
    { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
    { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
  ], []);

  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [maxDay]
  );

  const years = useMemo(
    () => Array.from({ length: 16 }, (_, i) => ({ value: today.getFullYear() + i, label: String(today.getFullYear() + i) })),
    [today]
  );

  return (
    <div
      className="flex bg-secondary border border-border overflow-hidden"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <ScrollColumn items={MONTHS} selected={mo} onSelect={setMo} />
      <div className="w-px bg-border/30 self-stretch" />
      <ScrollColumn items={days} selected={safeDay} onSelect={setDy} />
      <div className="w-px bg-border/30 self-stretch" />
      <ScrollColumn items={years} selected={yr} onSelect={setYr} />
    </div>
  );
}
