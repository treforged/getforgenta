import { useState, useEffect, useCallback, useRef } from 'react';
import { useProfile } from './useSupabaseData';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LAYOUT, WIDGET_META, type WidgetConfig, type WidgetId } from '@/lib/dashboard-widgets';

function parseLayout(raw: unknown): WidgetConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT;

  const validIds = new Set<WidgetId>(WIDGET_META.map(w => w.id));
  const saved: WidgetConfig[] = raw
    .filter((w): w is { id: WidgetId; visible: boolean } =>
      typeof w === 'object' && w !== null && typeof (w as any).id === 'string' && validIds.has((w as any).id),
    )
    .map(w => ({ id: w.id, visible: Boolean(w.visible) }));

  const savedIds = new Set(saved.map(w => w.id));
  DEFAULT_LAYOUT.forEach(def => {
    if (!savedIds.has(def.id)) saved.push({ ...def });
  });

  return saved;
}

export function useDashboardLayout() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { data: profile, loading } = useProfile();
  const [layout, setLayoutState] = useState<WidgetConfig[]>(DEFAULT_LAYOUT);
  const [isCustomizing, setCustomizing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    const raw = (profile as any)?.dashboard_layout;
    setLayoutState(parseLayout(raw));
  }, [profile, loading]);

  const persist = useCallback(
    (newLayout: WidgetConfig[]) => {
      if (isDemo || !user) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await supabase
          .from('profiles')
          .update({ dashboard_layout: newLayout } as any)
          .eq('user_id', user.id);
      }, 800);
    },
    [isDemo, user],
  );

  const setLayout = useCallback(
    (newLayout: WidgetConfig[]) => {
      setLayoutState(newLayout);
      persist(newLayout);
    },
    [persist],
  );

  const resetLayout = useCallback(() => {
    initialized.current = false;
    setLayout(DEFAULT_LAYOUT);
  }, [setLayout]);

  const visibleWidgets = layout.filter(w => w.visible).map(w => w.id);

  return { layout, setLayout, visibleWidgets, isCustomizing, setCustomizing, resetLayout };
}
