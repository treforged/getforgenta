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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const idx = items.findIndex(i => i.value === selected);
    if (idx >= 0 && ref.current) ref.current.scrollTop = idx * ITEM_H;
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const mm = String(mo).padStart(2, '0');
    const dd = String(safeDay).padStart(2, '0');
    onChange(`${yr}-${mm}-${dd}`);
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
